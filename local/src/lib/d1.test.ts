import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: mocks.getCloudflareContext }));
vi.mock("./prisma", () => ({ prisma: {} }));

import { d1Value, writeD1Subscription } from "./d1";
import { createFirstD1Admin } from "./d1-admin";
import { acquireLocalJobLease, releaseLocalJobLease, renewLocalJobLease } from "./job-lease";

describe("D1 SQLite writes", () => {
  let sqlite: DatabaseSync;
  const revision = new Date("2026-11-01T00:00:00.000Z");

  beforeEach(() => {
    vi.stubEnv("SUBBOOST_CLOUDFLARE", "true");
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(readFileSync(new URL("../../prisma/d1-migrations/0001_init.sql", import.meta.url), "utf8"));
    function prepare(sql: string) {
      let values: (string | number | null)[] = [];
      return {
        bind(...args: typeof values) { values = args; return this; },
        first() { return Promise.resolve(sqlite.prepare(sql).get(...values) ?? null); },
        run() { return Promise.resolve(this.execute()); },
        execute() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      };
    }
    const DB = {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        sqlite.exec("BEGIN");
        try {
          const result = statements.map((statement) => statement.execute());
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
    mocks.getCloudflareContext.mockReturnValue({ env: { DB }, ctx: {} });
  });

  afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); });

  async function seedSubscription() {
    const admin = await createFirstD1Admin("admin", "hash");
    sqlite.prepare(`INSERT INTO "Subscription"
      (id, ownerId, name, token, encryptedUrls, encryptedNodes, encryptedConfig, updatedAt)
      VALUES ('sub', ?, 'original', 'token', '[]', '[]', '{}', ?)`)
      .run(admin!.id, d1Value(revision));
  }

  it("creates only one administrator when setup requests compete", async () => {
    const admins = await Promise.all([createFirstD1Admin("first", "hash"), createFirstD1Admin("second", "hash")]);
    expect(admins.filter(Boolean)).toHaveLength(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM "LocalAdmin"').get()?.count).toBe(1);
  });

  it("atomically saves state and rejects a stale subscription revision", async () => {
    await seedSubscription();
    expect(await writeD1Subscription("sub", revision, { name: "updated" }, { externalFailureCount: 2 })).toBe(true);
    expect(await writeD1Subscription("sub", revision, { name: "stale" }, { externalFailureCount: 9 })).toBe(false);
    expect(sqlite.prepare('SELECT name FROM "Subscription"').get()?.name).toBe("updated");
    expect(sqlite.prepare('SELECT externalFailureCount FROM "SubscriptionAutoUpdateState"').get()?.externalFailureCount).toBe(2);
  });

  it("rolls back the state write if the subscription update fails", async () => {
    await seedSubscription();
    await expect(writeD1Subscription("sub", revision, { name: null }, { externalFailureCount: 2 })).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM "SubscriptionAutoUpdateState"').get()?.count).toBe(0);
    expect(sqlite.prepare('SELECT name FROM "Subscription"').get()?.name).toBe("original");
  });

  it("reclaims expired leases without letting an old owner renew or release them", async () => {
    const now = new Date();
    const first = await acquireLocalJobLease({ name: "cron", leaseMs: 1000, now });
    expect(first).not.toBeNull();
    expect(await acquireLocalJobLease({ name: "cron", leaseMs: 1000, now })).toBeNull();
    const second = await acquireLocalJobLease({ name: "cron", leaseMs: 1000, now: new Date(now.getTime() + 1001) });
    expect(second).not.toBeNull();
    expect(await renewLocalJobLease(first!, 1000, new Date(now.getTime() + 1002))).toBe(false);
    await releaseLocalJobLease(first!);
    expect(sqlite.prepare('SELECT ownerToken FROM "JobLeaseLock"').get()?.ownerToken).toBe(second!.ownerToken);
  });
});
