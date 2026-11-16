import type { ExecutionContext } from "@cloudflare/workers-types";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore OpenNext generates this module during build, so it may be absent.
import handler from "../.open-next/worker.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore The Worker build generates this manifest alongside the handler.
import staticPages from "../.open-next/static-pages.json";
import { runScheduledJobs } from "./scheduled";

const pageAssets: ReadonlyMap<string, string> = new Map(Object.entries(staticPages));

type WorkerEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

const worker = {
  async fetch(request: Request, env: WorkerEnvironment, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_subboost-pages/")) return new Response(null, { status: 404 });
    const assetPath = pageAssets.get(url.pathname);
    if (
      assetPath &&
      (request.method === "GET" || request.method === "HEAD") &&
      (request.headers.get("Accept") ?? "").toLowerCase().includes("text/html") &&
      !request.headers.has("RSC") &&
      !request.headers.has("Next-Router-State-Tree") &&
      !request.headers.has("Next-Router-Prefetch") &&
      !request.headers.has("Next-Router-Segment-Prefetch") &&
      !request.headers.has("Next-Action") &&
      !request.headers.has("X-Prerender-Revalidate") &&
      !request.headers.has("X-Deployment-Id") &&
      !url.searchParams.has("dpl")
    ) {
      const response = await env.ASSETS.fetch(new Request(new URL(assetPath, url), { method: request.method }));
      if (response.ok) return response;
      await response.body?.cancel();
    }
    return handler.fetch(request, env, context);
  },
  scheduled: runScheduledJobs,
};

export default worker;
