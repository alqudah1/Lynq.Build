import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_MANAGER_TASK_ID = "019fe7a4-73fc-77d1-a074-d14ecc754f21";
const mode = process.argv[2];
const confirmation = process.argv.slice(3).includes("--confirm-app-lynq-build");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const officeConfigPath = "platform/vercel.json";
const officeConfig = resolve(repositoryRoot, officeConfigPath);

if (mode !== "preview" && mode !== "production") {
  console.error("Usage: node scripts/vercel-release.mjs <preview|production>");
  process.exit(2);
}

if (mode === "production") {
  if (process.env.LYNQ_RELEASE_MANAGER_TASK_ID !== RELEASE_MANAGER_TASK_ID) {
    console.error("Blocked: only the LYNQ Office release-manager task can deploy production.");
    process.exit(1);
  }
  if (!confirmation) {
    console.error("Blocked: add --confirm-app-lynq-build after release verification.");
    process.exit(1);
  }
}

if (!existsSync(officeConfig)) {
  console.error(`Blocked: LYNQ Office deployment configuration is missing at ${officeConfigPath}.`);
  process.exit(1);
}

const args = ["--yes", "vercel@59.10.0", "deploy", "--yes", "--local-config", officeConfigPath];
if (mode === "production") {
  args.push("--prod");
}

const result = spawnSync("npx", args, { cwd: repositoryRoot, env: process.env, stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
