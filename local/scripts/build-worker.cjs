const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cli = path.resolve(path.dirname(require.resolve("@opennextjs/cloudflare")), "../cli/index.js");
const result = spawnSync(process.execPath, [cli, "build"], {
  stdio: "inherit",
  env: { ...process.env, SUBBOOST_CLOUDFLARE: "true" },
});
process.exit(result.status ?? 1);
