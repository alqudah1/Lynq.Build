import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";
import { getToken } from "@vercel/connect";
import { Sandbox } from "@vercel/sandbox";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { getOfficeGenerationConfig } from "./models";
import { parseRestaurantResearch } from "./restaurant-research";
import { brandPackParseFailed, fingerprintBrandPack, parseBrandPack } from "./website/brand-pack";
import { generateRestaurantWebsite, type GeneratedWebsite, type WebsiteDraftGenerator } from "./website/factory";
import { renderViolations } from "./website/validation";

const CONNECTOR_ID = "github/lynq-office-github";
const DEFAULT_REPOSITORY = "alqudah1/lynq.build";
const DEFAULT_BASE_BRANCH = "main";
const MAX_TOOL_OUTPUT = 16_000;

/** A demo is only "built" when its route, its commit and its preview all exist. */
export type PreviewStatus = "ready" | "pending" | "unavailable";

export type RestaurantWebsiteDelivery = {
  designName: string;
  layout: string;
  pages: string[];
  designRationale: string;
  evidenceTable: string;
  uncertainties: string[];
  qaSummary: string;
  attempts: number;
  files: string[];
};

export type EngineeringDeliveryResult = {
  repository: string;
  branch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  previewUrl: string | null;
  previewPath?: string | null;
  /** Whether a preview deployment was actually found before this delivery returned. */
  previewStatus: PreviewStatus;
  previewCheckedAt: string;
  validationSummary: string;
  agentSummary: string;
  /** Present only for founder-approved restaurant demos built by the website factory. */
  website?: RestaurantWebsiteDelivery;
};

export class RestaurantResearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestaurantResearchUnavailableError";
  }
}

/** The evidence about to be used is not the evidence the founder approved. */
export class BrandPackApprovalMismatchError extends Error {
  readonly approvedFingerprint: string | null;
  readonly currentFingerprint: string | null;
  constructor(message: string, approvedFingerprint: string | null, currentFingerprint: string | null) {
    super(message);
    this.name = "BrandPackApprovalMismatchError";
    this.approvedFingerprint = approvedFingerprint;
    this.currentFingerprint = currentFingerprint;
  }
}

const RESTAURANT_RESEARCH_MARKER = "<!-- LYNQ_RESTAURANT_RESEARCH ";

/**
 * A demo route is identified by the organization and project it belongs
 * to, not by a project key alone. Project keys are unique inside a
 * workspace and nowhere else, so a global `/demos/{projectKey}` namespace
 * meant two tenants could claim the same route and one would silently
 * overwrite the other's live preview. The readable prefix is kept because
 * founders recognise it; the suffix is what makes the route unique.
 */
export function restaurantDemoPath(input: { organizationId: string; projectId: string; projectKey: string }): string {
  if (!input.organizationId.trim() || !input.projectId.trim()) {
    throw new Error("A demo route needs both the organization and the project it belongs to");
  }
  const slug = input.projectKey
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    .replace(/-$/, "");
  const scope = createHash("sha256").update(`${input.organizationId}:${input.projectId}`).digest("hex").slice(0, 12);
  return `/demos/${slug ? `${slug}-${scope}` : scope}`;
}

export function withPreviewPath(previewUrl: string | null, previewPath?: string | null): string | null {
  if (!previewUrl) return null;
  if (!previewPath) return previewUrl;
  return new URL(previewPath, previewUrl).toString().replace(/\/$/, "");
}

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

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the preview deployment to exist rather than reporting whatever
 * GitHub happened to know a second after the branch was pushed. A demo
 * without a preview is not a demo the founder can look at, so the result
 * says plainly whether one was found, and the caller reports that instead
 * of implying a link that does not resolve.
 */
export async function awaitPreviewUrl(input: {
  token: string;
  repository: string;
  commitSha: string;
  attempts?: number;
  delayMs?: number;
  sleep?: Sleep;
}): Promise<{ previewUrl: string | null; status: PreviewStatus }> {
  const attempts = Math.max(1, Math.min(input.attempts ?? 10, 30));
  const delayMs = Math.max(0, input.delayMs ?? 15_000);
  const sleep = input.sleep ?? realSleep;
  let sawFailure = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const found = await findPreviewUrl(input.token, input.repository, input.commitSha);
      if (found) return { previewUrl: found, status: "ready" };
    } catch {
      // A transient GitHub error is not evidence that no preview exists;
      // it is only evidence that this attempt could not tell.
      sawFailure = true;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return { previewUrl: null, status: sawFailure ? "unavailable" : "pending" };
}

/**
 * Commit, push and open the pull request. Source control is deliberately
 * the Office's job and never the agent's: whichever path produced the
 * change, publication happens here, once, with the same protections.
 */
async function publishBranch(input: {
  sandbox: Sandbox;
  root: string;
  token: string;
  repository: string;
  baseBranch: string;
  branch: string;
  projectName: string;
  objective: string;
  previewPath: string | null;
  report: string;
  summary: string;
  website?: RestaurantWebsiteDelivery;
  previewWait?: { attempts?: number; delayMs?: number; sleep?: Sleep };
}): Promise<EngineeringDeliveryResult> {
  const { sandbox, root, token, repository, branch } = input;
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
      base: input.baseBranch,
      body: `## Founder objective\n\n${input.objective}\n\n## Engineering report\n\n${input.report.slice(0, 20_000)}\n\n---\nCreated by LYNQ Office. This pull request does not merge or deploy production automatically.`,
    }),
  });
  const preview = await awaitPreviewUrl({ token, repository, commitSha, ...input.previewWait });

  return {
    repository,
    branch,
    commitSha,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url,
    previewUrl: withPreviewPath(preview.previewUrl, input.previewPath),
    previewPath: input.previewPath,
    previewStatus: preview.status,
    previewCheckedAt: new Date().toISOString(),
    validationSummary: input.report.slice(0, 20_000),
    agentSummary: input.summary.slice(0, 5_000),
    ...(input.website ? { website: input.website } : {}),
  };
}

/**
 * The single definition of "built" used by the Office artifact, by Jarvis
 * and by the QA gate. A commit with no reachable preview is honest work in
 * progress; calling it a finished demo would not be.
 */
export function demoIsBuilt(delivery: Pick<EngineeringDeliveryResult, "previewPath" | "commitSha" | "previewUrl" | "previewStatus">): boolean {
  return Boolean(delivery.previewPath) && Boolean(delivery.commitSha) && Boolean(delivery.previewUrl) && delivery.previewStatus === "ready";
}

/** What is missing, in the founder's words, when a demo is not built. */
export function missingDemoParts(delivery: Pick<EngineeringDeliveryResult, "previewPath" | "commitSha" | "previewUrl" | "previewStatus">): string[] {
  const missing: string[] = [];
  if (!delivery.previewPath) missing.push("the public demo route");
  if (!delivery.commitSha) missing.push("a commit on the feature branch");
  if (!delivery.previewUrl || delivery.previewStatus !== "ready") missing.push("a working preview link");
  return missing;
}

/**
 * Build the founder-approved restaurant website before any sandbox is
 * created. Generation is deterministic and fully validated in-process, so
 * a prospect demo that cannot be proven correct fails here — cheaply, and
 * without leaving a half-built branch behind.
 */
export async function buildApprovedRestaurantWebsite(input: {
  projectKey: string;
  route: string;
  objective: string;
  sharedContext: string;
  /** The evidence version the founder approved; the build refuses anything else. */
  approvedBrandPackFingerprint: string | null;
  /** Test seam. Production always uses the Office model configured for planning. */
  generator?: WebsiteDraftGenerator;
}): Promise<GeneratedWebsite> {
  const research = parseRestaurantResearch(input.sharedContext);
  if (!research) {
    throw new RestaurantResearchUnavailableError(
      "Engineering cannot build a restaurant demo before the founder-approved research is recorded on the project",
    );
  }
  // Approved brand material that will not parse is an error, not an
  // absence: silently shipping an image-free site would hide the fact
  // that someone's approval never reached the page.
  if (brandPackParseFailed(input.sharedContext)) {
    throw new RestaurantResearchUnavailableError("The approved brand pack on this project is malformed, so no asset, menu or service from it can be used");
  }
  // The build uses the exact evidence the founder saw, or it does not run.
  // Recomputing the fingerprint here — rather than trusting a flag set
  // upstream — is what makes "changing the evidence needs a new approval"
  // a property of the system instead of a convention.
  const brandPack = parseBrandPack(input.sharedContext);
  const currentFingerprint = brandPack ? fingerprintBrandPack(brandPack) : null;
  if (!input.approvedBrandPackFingerprint) {
    throw new BrandPackApprovalMismatchError(
      "This prospect has no approved evidence version recorded, so there is nothing to build from. Ask Jarvis to gather the evidence again and approve it.",
      null,
      currentFingerprint,
    );
  }
  if (currentFingerprint !== input.approvedBrandPackFingerprint) {
    throw new BrandPackApprovalMismatchError(
      currentFingerprint
        ? "The evidence on this project has changed since you approved it, so Jarvis stopped rather than building from something you have not seen. Approve the new evidence to continue."
        : "The approved evidence is no longer on this project, so Jarvis has nothing it is allowed to build from.",
      input.approvedBrandPackFingerprint,
      currentFingerprint,
    );
  }
  return generateRestaurantWebsite({
    projectKey: input.projectKey,
    route: input.route,
    candidate: research.recommendation,
    brandPack,
    objective: input.objective,
    researchUncertainty: research.uncertainty,
    generator: input.generator,
  });
}

/**
 * Write the generated route into the sandbox and prove that what landed on
 * disk is byte-for-byte what was validated, and that nothing else changed.
 * No model participates in this path.
 */
async function writeGeneratedWebsite(sandbox: Sandbox, root: string, website: GeneratedWebsite): Promise<string> {
  // Demo routes are keyed by project, and two projects could in principle
  // slugify to the same route. Overwriting another prospect's live demo
  // would be silent and unrecoverable, so it is refused here.
  const existing = await sandbox.readFileToBuffer({ path: safeWorkspacePath(root, `${website.routeSourceDir}/site.data.ts`) });
  const occupant = /"projectKey":\s*"([^"]+)"/.exec(existing?.toString("utf8") ?? "")?.[1];
  if (occupant && occupant !== website.spec.projectKey) {
    throw new Error(`The route ${website.spec.route} already belongs to project ${occupant}; refusing to overwrite another prospect's demo`);
  }
  for (const file of website.files) {
    const target = safeWorkspacePath(root, file.path);
    await sandbox.runCommand({ cmd: "mkdir", args: ["-p", path.posix.dirname(target)] });
    await sandbox.writeFiles([{ path: target, content: file.content }]);
  }
  for (const file of website.files) {
    const written = await sandbox.readFileToBuffer({ path: safeWorkspacePath(root, file.path) });
    if (written?.toString("utf8") !== file.content) {
      throw new Error(`The generated demo file ${file.path} did not land in the workspace intact`);
    }
  }
  const status = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd: root });
  const changedFiles = (await status.stdout())
    .trim()
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const expected = new Set(website.files.map((file) => file.path));
  if (changedFiles.length === 0) {
    throw new Error(`The regenerated site for ${website.spec.route} is identical to the base branch, so there is nothing to deliver`);
  }
  const unexpected = changedFiles.filter((file) => !expected.has(file));
  if (unexpected.length > 0) {
    throw new Error(`The restaurant demo changed files outside its own route: ${unexpected.slice(0, 5).join(", ")}`);
  }
  for (const file of expected) {
    if (!changedFiles.includes(file)) throw new Error(`The restaurant demo did not produce ${file}`);
  }
  return [
    `# ${website.spec.businessName} — generated concept website`,
    "",
    `Route: \`${website.spec.route}\``,
    `Pages: ${website.spec.pages.map((page) => `\`${website.spec.route}${page.path ? `/${page.path}` : ""}\``).join(", ")}`,
    `Generation attempts: ${website.attempts}`,
    "",
    website.designRationale,
    "",
    "## Deterministic validation",
    "",
    `Pages rendered and checked: ${website.report.checkedPages.join(", ")}`,
    `Rendered bytes: ${Object.entries(website.report.renderedBytes).map(([page, bytes]) => `${page} ${bytes}B`).join(", ")}`,
    "",
    "Every check below is a computation, not a judgement: the preview route exists as source, every page renders,",
    "every navigation target resolves, no placeholder copy survives, every visible fact resolves to the approved",
    "evidence, and no service is offered that the evidence does not establish.",
    "",
    `Violations: ${renderViolations(website.report.violations)}`,
    "",
    "## Evidence behind every visible fact",
    "",
    website.evidenceTable,
    "",
    "## Remaining uncertainty",
    "",
    website.uncertainties.length > 0 ? website.uncertainties.map((item) => `- ${item}`).join("\n") : "- None beyond the research's own caveats.",
    "",
    "## Files",
    "",
    website.files.map((file) => `- \`${file.path}\``).join("\n"),
  ].join("\n");
}

export async function executeEngineeringDelivery(input: {
  executionId: string;
  organizationId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  objective: string;
  acceptanceCriteria: string;
  sharedContext: string;
  /** The evidence version the founder approved. Required for a prospect demo. */
  approvedBrandPackFingerprint?: string | null;
  previewWait?: { attempts?: number; delayMs?: number; sleep?: Sleep };
}): Promise<EngineeringDeliveryResult> {
  const { repository, baseBranch } = await verifyOfficeRepositoryConnection();
  const token = await githubToken();
  const repoName = repository.split("/")[1];
  const branch = `office/${input.projectKey.toLowerCase()}-${input.executionId.slice(0, 8)}`;
  // A project whose shared context carries founder-approved restaurant
  // research is a prospect demo, and takes the deterministic factory path
  // below rather than the free-form engineering agent.
  const previewPath = input.sharedContext.includes(RESTAURANT_RESEARCH_MARKER)
    ? restaurantDemoPath({ organizationId: input.organizationId, projectId: input.projectId, projectKey: input.projectKey })
    : null;
  const website = previewPath
    ? await buildApprovedRestaurantWebsite({
        projectKey: input.projectKey,
        route: previewPath,
        objective: input.objective,
        sharedContext: input.sharedContext,
        approvedBrandPackFingerprint: input.approvedBrandPackFingerprint ?? null,
      })
    : null;
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

    // A founder-approved restaurant demo is generated deterministically and
    // validated in-process, so no model writes files here. The sandbox
    // agent remains the path for ordinary product features.
    if (website) {
      const websiteReport = await writeGeneratedWebsite(sandbox, root, website);
      return await publishBranch({
        sandbox,
        root,
        token,
        repository,
        baseBranch,
        branch,
        projectName: input.projectName,
        objective: input.objective,
        previewPath,
        report: websiteReport,
        previewWait: input.previewWait,
        summary: `Generated a ${website.design.layout} concept website for ${website.spec.businessName} across ${website.spec.pages.length} page(s) and proved it against ${website.report.checkedPages.length} rendered page(s) with no outstanding violations.`,
        website: {
          designName: website.design.name,
          layout: website.design.layout,
          pages: website.spec.pages.map((page) => (page.path ? `${website.spec.route}/${page.path}` : website.spec.route)),
          designRationale: website.designRationale,
          evidenceTable: website.evidenceTable,
          uncertainties: website.uncertainties,
          qaSummary: renderViolations(website.report.violations),
          attempts: website.attempts,
          files: website.files.map((file) => file.path),
        },
      });
    }

    const allowedCommands = new Set(["ls", "find", "rg", "sed", "pwd", "node", "npm", "npx", "pnpm", "yarn", "git"]);
    const engineeringAgent = new ToolLoopAgent({
      ...getOfficeGenerationConfig("engineering"),
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
        deliveryProfile: { kind: "product_feature" },
      }),
    });

    const status = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd: root });
    const changed = (await status.stdout()).trim();
    if (!changed) throw new Error("Engineering completed without producing repository changes");
    if (changed.split("\n").some((line) => /(?:^|\/)\.env(?:\.|$)/.test(line.slice(3)))) throw new Error("Engineering attempted to modify a protected environment file");
    return await publishBranch({
      sandbox,
      root,
      token,
      repository,
      baseBranch,
      branch,
      projectName: input.projectName,
      objective: input.objective,
      previewPath,
      report: result.text,
      summary: result.text.slice(0, 5_000),
      previewWait: input.previewWait,
    });
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function inspectEngineeringDelivery(input: { repository: string; commitSha: string; pullRequestUrl: string; previewPath?: string | null }): Promise<{ previewUrl: string | null; checks: string }> {
  const { repository } = await verifyOfficeRepositoryConnection();
  if (repository !== input.repository) throw new Error("Engineering delivery repository is outside the approved scope");
  const token = await githubToken();
  const [status, checks] = await Promise.all([
    githubFetch<{ state: string; statuses: Array<{ context: string; state: string; description: string | null }> }>(token, `/repos/${repository}/commits/${input.commitSha}/status`),
    githubFetch<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; details_url: string | null }> }>(token, `/repos/${repository}/commits/${input.commitSha}/check-runs`),
  ]);
  const previewUrl = withPreviewPath(await findPreviewUrl(token, repository, input.commitSha), input.previewPath);
  const lines = [
    `Combined status: ${status.state}`,
    ...status.statuses.map((item) => `${item.context}: ${item.state}${item.description ? ` — ${item.description}` : ""}`),
    ...checks.check_runs.map((item) => `${item.name}: ${item.conclusion ?? item.status}`),
  ];
  return { previewUrl, checks: lines.join("\n").slice(0, 20_000) };
}
