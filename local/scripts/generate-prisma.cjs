const { spawnSync } = require("node:child_process");
require("./generate-d1-schema.cjs");
const schema = process.env.SUBBOOST_CLOUDFLARE === "true" ? "prisma/schema.d1.prisma" : "prisma/schema.prisma";
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "generate", "--schema", schema], { stdio: "inherit" });
process.exit(result.status ?? 1);
