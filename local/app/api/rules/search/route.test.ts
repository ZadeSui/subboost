import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuleIndexUnavailableError } from "@subboost/server-core/rules";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  waitUntil: vi.fn(),
  open: vi.fn(),
  match: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@local/lib/rule-catalog", () => ({ searchRules: mocks.search }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ ctx: { waitUntil: mocks.waitUntil } }),
}));

function search(query: string) {
  return GET(new NextRequest(`https://subboost.test/api/rules/search?${query}`));
}

describe("public rule search edge cache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SUBBOOST_CLOUDFLARE", "true");
    vi.stubGlobal("caches", { open: mocks.open });
    const stored = new Map<string, Response>();
    mocks.open.mockResolvedValue({ match: mocks.match, put: mocks.put });
    mocks.match.mockImplementation(async (key: string) => stored.get(key)?.clone());
    mocks.put.mockImplementation(async (key: string, response: Response) => stored.set(key, response));
    mocks.search.mockResolvedValue({ items: [], keyword: "Test" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shares equivalent query parameters and skips search on a hit", async () => {
    const miss = await search("keyword=Test&tracking=ignored");
    const hit = await search("page=001&size=20&type=invalid&keyword=Test");
    expect(await hit.json()).toEqual(await miss.json());
    expect(hit.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.put.mock.calls[0][1].headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("separates pages and keywords that are echoed differently", async () => {
    await search("keyword=Test");
    await search("keyword=Test&page=2");
    await search("keyword=test");
    expect(mocks.search).toHaveBeenCalledTimes(3);
  });

  it("falls back when the cache fails and skips the cache outside Workers", async () => {
    mocks.match.mockRejectedValueOnce(new Error("read failed"));
    mocks.put.mockRejectedValueOnce(new Error("write failed"));
    expect((await search("keyword=Test")).status).toBe(200);
    await expect(mocks.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();

    vi.stubEnv("SUBBOOST_CLOUDFLARE", "false");
    expect((await search("keyword=Test")).status).toBe(200);
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  it("does not store unavailable responses", async () => {
    mocks.search.mockRejectedValueOnce(new RuleIndexUnavailableError("unavailable"));
    expect((await search("keyword=Test")).status).toBe(503);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
