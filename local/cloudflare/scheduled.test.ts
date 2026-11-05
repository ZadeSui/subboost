import { describe, expect, it, vi } from "vitest";
import { runScheduledJobs } from "./scheduled";

describe("Cloudflare scheduled jobs", () => {
  it.each([
    ["*/6 * * * *", "/api/cron/update-subscriptions"],
    ["3 * * * *", "/api/cron/update-rule-index"],
  ])("dispatches %s with cron authentication", async (cron, path) => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    await runScheduledJobs({ cron }, {
      APP_URL: "https://subboost.example", CRON_SECRET: "secret", WORKER_SELF_REFERENCE: { fetch },
    });
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe(`https://subboost.example${path}`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("Authorization")).toBe("Bearer secret");
  });

  it("reports failed jobs and missing secrets", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(runScheduledJobs({ cron: "*/6 * * * *" }, {
      APP_URL: "https://subboost.example", CRON_SECRET: "secret", WORKER_SELF_REFERENCE: { fetch },
    })).rejects.toThrow("HTTP 503");
    fetch.mockClear();
    await expect(runScheduledJobs({ cron: "*/6 * * * *" }, {
      WORKER_SELF_REFERENCE: { fetch },
    })).rejects.toThrow("APP_URL and CRON_SECRET");
    expect(fetch).not.toHaveBeenCalled();
  });
});
