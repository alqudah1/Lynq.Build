import "server-only";

import path from "node:path";
import { getToken } from "@vercel/connect";
import { Sandbox } from "@vercel/sandbox";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { getOfficeModel } from "./models";

const CONNECTOR_ID = "github/lynq-office-github";
const DEFAULT_REPOSITORY = "alqudah1/lynq.build";
const DEFAULT_BASE_BRANCH = "main";
const MAX_TOOL_OUTPUT = 16_000;

export type EngineeringDeliveryResult = {
  repository: string;
  branch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  previewUrl: string | null;
  validationSummary: string;
  agentSummary: string;
};

function repositoryConfig() {
  const repository = process.env.OFFICE_GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("OFFICE_GITHUB_REPOSITORY is invalid");
  const baseBranch = process.env.OFFICE_GITHUB_BASE_BRANCH || DEFAULT_BASE_BRANCH;
  if (!/^[A-Za-z0-9._/-]+$/.test(baseBranch) || baseBranch.includes("..")) throw new Error("OFFICE_GITHUB_BASE_BRANCH is invalid");
  return { repository, baseBranch };
}

async function githubToken(): Promise<string> {
  return getToken(CONNECTOR_ID, { subject: { type: "app" } });
}

async function githubFetch<T>(token: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return (await response.json()) as T;
}

export async function verifyOfficeRepositoryConnection(): Promise<{ repository: string; baseBranch: string }> {
  const { repository, baseBranch } = repositoryConfig();
  const token = await githubToken();
  const installations = await githubFetch<{ repositories: Array<{ full_name: string }> }>(token, "/installation/repositories?per_page=100");
  const allowed = installations.repositories.map((item) => item.full_name.toLowerCase());
  if (allowed.length !== 1 || allowed[0] !== repository.toLowerCase()) {
    throw new Error(`The Office GitHub connector must be installed on exactly the approved repository (${repository})`);
  }
  await githubFetch(token, `/repos/${repository}/branches/${encodeURIComponent(baseBranch)}`);
  return { repository, baseBranch };
}

function safeWorkspacePath(root: string, value: string): string {
  const relative = value.replace(/^\/+/, "");
  const resolved = path.posix.normalize(path.posix.join(root, relative));
  if (!resolved.startsWith(`${root}/`) || relative.includes("\0")) throw new Error("Path is outside the repository workspace");
  if (/(^|\/)(\.git|node_modules)(\/|$)/.test(relative) || /(^|\/)\.env(?:\.|$)/.test(relative)) throw new Error("That path is protected");
  return resolved;
}

function trimOutput(value: string): string {
  return value.length <= MAX_TOOL_OUTPUT ? value : `${value.slice(0, MAX_TOOL_OUTPUT)}\n[output truncated]`;
}

async function findPreviewUrl(token: string, repository: string, sha: string): Promise<string | null> {
  const [statuses, checks, deployments] = await Promise.all([
    githubFetch<{ statuses: Array<{ target_url: string | null; context: string }> }>(token, `/repos/${repository}/commits/${sha}/status`),
    githubFetch<{ check_runs: Array<{ details_url: string | null; name: string }> }>(token, `/repos/${repository}/commits/${sha}/check-runs`),
    githubFetch<Array<{ id: number }>>(token, `/repos/${repository}/deployments?sha=${encodeURIComponent(sha)}&per_page=20`),
  ]);
  const deploymentStatuses = await Promise.all(
    deployments.map((deployment) =>
      githubFetch<Array<{ environment_url: string | null; target_url: string | null }>>(token, `/repos/${repository}/deployments/${deployment.id}/statuses?per_page=20`),
    ),
  );
  const urls = [
    ...deploymentStatuses.flatMap((items) => items.flatMap((item) => [item.environment_url, item.target_url])),
    ...statuses.statuses.map((item) => item.target_url),
    ...checks.check_runs.map((item) => item.details_url),
  ].filter((value): value is string => Boolean(value));
  return urls.find((url) => /\.vercel\.app(?:\/|$)/i.test(url)) ?? null;
}

export async function executeEngineeringDelivery(input: {
  executionId: string;
  projectKey: string;
  projectName: string;
  objective: string;
  acceptanceCriteria: string;
  sharedContext: string;
}): Promise<EngineeringDeliveryResult> {
  const { repository, baseBranch } = await verifyOfficeRepositoryConnection();
  const token = await githubToken();
  const repoName = repository.split("/")[1];
  const branch = `office/${input.projectKey.toLowerCase()}-${input.executionId.slice(0, 8)}`;
  const sandbox = await Sandbox.create({
    source: {
      type: "git",
      url: `https://github.com/${repository}.git`,
      username: "x-access-token",
      password: token,
      revision: baseBranch,
      depth: 20,
    },
    resources: { vcpus: 4 },
    timeout: 40 * 60 * 1000,
    persistent: false,
    tags: { purpose: "lynq-office", project: input.projectKey.slice(0, 30) },
  });

  const root = path.posix.join(sandbox.cwd, repoName);
  try {
    await sandbox.runCommand({ cmd: "git", args: ["remote", "set-url", "origin", `https://github.com/${repository}.git`], cwd: root });
    await sandbox.runCommand({ cmd: "git", args: ["checkout", "-b", branch], cwd: root });

    const allowedCommands = new Set(["ls", "find", "rg", "sed", "pwd", "node", "npm", "npx", "pnpm", "yarn", "git"]);
    const engineeringAgent = new ToolLoopAgent({
      model: getOfficeModel("engineering"),
      instructions:
        "You are LYNQ's Software Engineering Lead working inside an isolated feature-branch sandbox. Inspect the repository before editing. Implement the objective completely but narrowly, preserve existing authentication and security, and never access production data or secrets. Use write_file for edits and run_command for inspection and validation. You may inspect git status/diff/log, but you must not commit, push, merge, deploy, alter remotes, or create credentials; the Office performs source-control actions after validation. Run the relevant lint, typecheck, tests, and build. End with a concise factual summary of changes, checks, and unresolved risks.",
      stopWhen: isStepCount(36),
      tools: {
        read_file: tool({
          description: "Read a UTF-8 repository file.",
          inputSchema: z.object({ file: z.string().min(1).max(500) }),
          execute: async ({ file }) => {
            const buffer = await sandbox.readFileToBuffer({ path: safeWorkspacePath(root, file) });
            if (!buffer) return { found: false, content: "" };
            return { found: true, content: trimOutput(buffer.toString("utf8")) };
          },
        }),
        write_file: tool({
          description: "Create or replace one UTF-8 repository file. Parent directories are created first.",
          inputSchema: z.object({ file: z.string().min(1).max(500), content: z.string().max(200_000) }),
          execute: async ({ file, content }) => {
            const target = safeWorkspacePath(root, file);
            await sandbox.runCommand({ cmd: "mkdir", args: ["-p", path.posix.dirname(target)] });
            await sandbox.writeFiles([{ path: target, content }]);
            return { written: file, bytes: Buffer.byteLength(content) };
          },
        }),
        run_command: tool({
          description: "Run one non-shell command in the repository. Git is read-only; source-control publication is handled by the Office.",
          inputSchema: z.object({ command: z.string().min(1).max(40), args: z.array(z.string().max(500)).max(30).default([]), cwd: z.string().max(500).optional() }),
          execute: async ({ command, args, cwd }) => {
            if (!allowedCommands.has(command)) throw new Error("Command is outside the engineering sandbox allowlist");
            if (command === "git" && !["status", "diff", "log", "show"].includes(args[0] ?? "")) throw new Error("Git mutation is reserved for the Office");
            const workdir = cwd ? safeWorkspacePath(root, cwd) : root;
            const result = await sandbox.runCommand({ cmd: command, args, cwd: workdir, timeoutMs: 240_000 });
            return { exitCode: result.exitCode, stdout: trimOutput(await result.stdout()), stderr: trimOutput(await result.stderr()) };
          },
        }),
      },
    });

    const result = await engineeringAgent.generate({
      prompt: JSON.stringify({
        project: { key: input.projectKey, name: input.projectName, objective: input.objective },
        acceptanceCriteria: input.acceptanceCriteria,
        sharedProjectContext: input.sharedContext.slice(0, 40_000),
        repository,
        baseBranch,
      }),
    });

    const status = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd: root });
    const changed = (await status.stdout()).trim();
    if (!changed) throw new Error("Engineering completed without producing repository changes");
    if (changed.split("\n").some((line) => /(?:^|\/)\.env(?:\.|$)/.test(line.slice(3)))) throw new Error("Engineering attempted to modify a protected environment file");

    await sandbox.runCommand({ cmd: "git", args: ["add", "--all"], cwd: root });
    await sandbox.runCommand({ cmd: "git", args: ["-c", "user.name=LYNQ Office", "-c", "user.email=office@lynq.build", "commit", "-m", `feat: ${input.projectName.slice(0, 60)}`], cwd: root });
    const shaResult = await sandbox.runCommand({ cmd: "git", args: ["rev-parse", "HEAD"], cwd: root });
    const commitSha = (await shaResult.stdout()).trim();

    await sandbox.writeFiles([{ path: "/tmp/lynq-git-askpass.sh", mode: 0o700, content: "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' x-access-token;; *) printf '%s\\n' \"$GITHUB_TOKEN\";; esac\n" }]);
    const push = await sandbox.runCommand({
      cmd: "git",
      args: ["push", "--set-upstream", "origin", branch],
      cwd: root,
      env: { GIT_ASKPASS: "/tmp/lynq-git-askpass.sh", GIT_TERMINAL_PROMPT: "0", GITHUB_TOKEN: token },
      timeoutMs: 240_000,
    });
    if (push.exitCode !== 0) throw new Error(`Feature branch push failed: ${trimOutput(await push.stderr())}`);

    const pullRequest = await githubFetch<{ number: number; html_url: string }>(token, `/repos/${repository}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `[LYNQ Office] ${input.projectName}`.slice(0, 250),
        head: branch,
        base: baseBranch,
        body: `## Founder objective\n\n${input.objective}\n\n## Engineering report\n\n${result.text.slice(0, 20_000)}\n\n---\nCreated by LYNQ Office. This pull request does not merge or deploy production automatically.`,
      }),
    });
    const previewUrl = await findPreviewUrl(token, repository, commitSha);

    return {
      repository,
      branch,
      commitSha,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.html_url,
      previewUrl,
      validationSummary: result.text.slice(0, 20_000),
      agentSummary: result.text.slice(0, 5_000),
    };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function inspectEngineeringDelivery(input: { repository: string; commitSha: string; pullRequestUrl: string }): Promise<{ previewUrl: string | null; checks: string }> {
  const { repository } = await verifyOfficeRepositoryConnection();
  if (repository !== input.repository) throw new Error("Engineering delivery repository is outside the approved scope");
  const token = await githubToken();
  const [status, checks] = await Promise.all([
    githubFetch<{ state: string; statuses: Array<{ context: string; state: string; description: string | null }> }>(token, `/repos/${repository}/commits/${input.commitSha}/status`),
    githubFetch<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; details_url: string | null }> }>(token, `/repos/${repository}/commits/${input.commitSha}/check-runs`),
  ]);
  const previewUrl = await findPreviewUrl(token, repository, input.commitSha);
  const lines = [
    `Combined status: ${status.state}`,
    ...status.statuses.map((item) => `${item.context}: ${item.state}${item.description ? ` — ${item.description}` : ""}`),
    ...checks.check_runs.map((item) => `${item.name}: ${item.conclusion ?? item.status}`),
  ];
  return { previewUrl, checks: lines.join("\n").slice(0, 20_000) };
}
