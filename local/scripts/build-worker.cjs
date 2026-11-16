const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const cli = path.resolve(path.dirname(require.resolve("@opennextjs/cloudflare")), "../cli/index.js");
const result = spawnSync(process.execPath, [cli, "build"], {
  stdio: "inherit",
  env: { ...process.env, SUBBOOST_CLOUDFLARE: "true" },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const manifest = JSON.parse(fs.readFileSync(".next/prerender-manifest.json", "utf8"));
const assetDirectory = ".open-next/assets/_subboost-pages";
const staticPages = {};
fs.mkdirSync(assetDirectory, { recursive: true });
for (const [route, metadata] of Object.entries(manifest.routes)) {
  if (metadata.routeType !== "page" || metadata.response !== "complete" ||
      metadata.initialRevalidateSeconds !== false || metadata.srcRoute !== route) continue;
  if (!/^\/(?:[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*)?$/.test(route)) continue;
  const filename = route === "/" ? "index" : route.slice(1);
  const source = path.join(".next/server/app", `${filename}.html`);
  if (!fs.existsSync(source)) continue;
  const asset = `${route === "/" ? "_root" : filename}.html`;
  const destination = path.join(assetDirectory, asset);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  staticPages[route] = `/_subboost-pages/${asset}`;
}
fs.writeFileSync(".open-next/static-pages.json", JSON.stringify(staticPages));
