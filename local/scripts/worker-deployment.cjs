const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const LOCAL_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createDeploymentConfig(template, databaseId, dryRun = false) {
  const id = databaseId?.trim() || (dryRun ? LOCAL_DATABASE_ID : "");
  if (!UUID_PATTERN.test(id) || (!dryRun && id === LOCAL_DATABASE_ID)) {
    throw new Error("Set D1_DATABASE_ID to your D1 database UUID in the build secrets or local environment.");
  }
  const placeholder = `"database_id": "${LOCAL_DATABASE_ID}"`;
  if (template.split(placeholder).length !== 2) {
    throw new Error("Expected one D1 database ID placeholder in wrangler.jsonc.");
  }
  // Keep the JSONC template and relative paths intact, without logging the ID.
  return template.replace(placeholder, `"database_id": "${id}"`);
}

function run(mode, dependencies = {}) {
  if (!["deploy", "migrate", "dry-run"].includes(mode)) throw new Error("Unknown Worker deployment command");
  const appDirectory = path.resolve(__dirname, "..");
  const template = fs.readFileSync(path.join(appDirectory, "wrangler.jsonc"), "utf8");
  const config = createDeploymentConfig(template, process.env.D1_DATABASE_ID, mode === "dry-run");
  // Same directory as the template so main/assets/migrations paths stay valid.
  // Unique filenames also allow concurrent deploy/migration commands.
  const configPath = path.join(appDirectory, `.wrangler-deploy-${require("node:crypto").randomUUID()}.jsonc`);
  const spawn = dependencies.spawnSync || spawnSync;
  try {
    fs.writeFileSync(configPath, config, { mode: 0o600, flag: "wx" });
    const openNextCli = path.resolve(path.dirname(require.resolve("@opennextjs/cloudflare")), "../cli/index.js");
    const wranglerCli = path.resolve(path.dirname(require.resolve("wrangler")), "../bin/wrangler.js");
    const args = mode === "deploy"
      ? [openNextCli, "deploy", "--config", configPath]
      : [wranglerCli, ...(mode === "migrate"
          ? ["d1", "migrations", "apply", "DB", "--remote"]
          : ["deploy", "--dry-run"]), "--config", configPath];
    const result = spawn(process.execPath, args, { cwd: appDirectory, stdio: "inherit", env: process.env });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  }
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createDeploymentConfig, run };
