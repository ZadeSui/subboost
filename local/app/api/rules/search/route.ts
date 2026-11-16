import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parsePagePagination } from "@subboost/core/api/pagination";
import { RuleIndexUnavailableError, normalizeRuleSearchType } from "@subboost/server-core/rules";
import { searchRules } from "@local/lib/rule-catalog";

const CACHE_SECONDS = 60;
const CACHE_NAME = "subboost-rule-search-v1";
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

async function openRuleSearchCache() {
  if (process.env.SUBBOOST_CLOUDFLARE !== "true") return null;
  try {
    const { ctx } = getCloudflareContext();
    const cache = await caches.open(CACHE_NAME);
    return { cache, ctx };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const keyword = searchParams.get("keyword") ?? "";
  const type = normalizeRuleSearchType(searchParams.get("type"));
  const { page, pageSize: size } = parsePagePagination(searchParams, {
    sizeParam: "size",
    defaultSize: 20,
    maxPage: 5000,
    maxSize: 50,
  });

  const cacheContext = keyword.length <= 128 ? await openRuleSearchCache() : null;
  // The response echoes the original keyword, so keep it verbatim in the key.
  if (cacheContext) {
    url.search = new URLSearchParams({ keyword, type, page: String(page), size: String(size) }).toString();
  }
  const cacheKey = url.href;
  const hit = await cacheContext?.cache.match(cacheKey).catch(() => undefined);
  if (hit) {
    return new Response(hit.body, {
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Type": "application/json",
        "Server-Timing": 'rule-search-cache;desc="HIT"',
      },
    });
  }

  try {
    const response = NextResponse.json(await searchRules({ keyword, type, page, size, allowStale: true }), {
      headers: RESPONSE_HEADERS,
    });
    if (cacheContext) {
      response.headers.set("Server-Timing", 'rule-search-cache;desc="MISS"');
      const cachedResponse = response.clone();
      cachedResponse.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
      cacheContext.ctx.waitUntil(cacheContext.cache.put(cacheKey, cachedResponse).catch(() => undefined));
    }
    return response;
  } catch (error) {
    if (!(error instanceof RuleIndexUnavailableError)) throw error;
    return NextResponse.json(
      {
        items: [],
        keyword,
        type,
        page,
        size,
        totalMatched: 0,
        totalRules: 0,
        source: "unavailable",
        error: "规则库暂不可用，请稍后重试",
        code: "RULE_INDEX_UNAVAILABLE",
      },
      { status: 503 }
    );
  }
}
