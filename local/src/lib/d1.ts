import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

export function getD1Database(): D1Database {
  const { env } = getCloudflareContext();
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("Cloudflare D1 binding DB is required");
  return database;
}

// Match PrismaD1's date encoding so optimistic comparisons use identical values.
export function d1Value(value: unknown): string | number | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().replace("Z", "+00:00");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error("Unsupported D1 field value");
}

function column(name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error("Invalid D1 column");
  return `"${name}"`;
}

// D1's batch is atomic. Prisma's callback transactions are not supported by D1.
// Update state only if the subscription still has the revision read by the caller,
// then update the subscription in the same batch, with no interleaving writers.
export async function writeD1Subscription(
  id: string,
  expectedUpdatedAt: Date,
  data: Record<string, unknown>,
  state?: Record<string, unknown>,
): Promise<boolean> {
  const db = getD1Database();
  const now = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
  const entries = Object.entries({ ...data, updatedAt: now });
  const statements = [];
  if (state) {
    const stateEntries = Object.entries(state);
    const names = ["subscriptionId", ...stateEntries.map(([name]) => name), "createdAt", "updatedAt"];
    statements.push(db.prepare(`INSERT INTO "SubscriptionAutoUpdateState" (${names.map(column).join(", ")})
      SELECT ${names.map(() => "?").join(", ")}
      WHERE EXISTS (SELECT 1 FROM "Subscription" WHERE "id" = ? AND "updatedAt" = ?)
      ON CONFLICT ("subscriptionId") DO UPDATE SET
      ${[...stateEntries.map(([name]) => `${column(name)} = excluded.${column(name)}`), '"updatedAt" = excluded."updatedAt"'].join(", ")}`)
      .bind(id, ...stateEntries.map(([, value]) => d1Value(value)), d1Value(now), d1Value(now), id, d1Value(expectedUpdatedAt)));
  }
  statements.push(db.prepare(`UPDATE "Subscription" SET ${entries.map(([name]) => `${column(name)} = ?`).join(", ")}
    WHERE "id" = ? AND "updatedAt" = ?`)
    .bind(...entries.map(([, value]) => d1Value(value)), id, d1Value(expectedUpdatedAt)));
  const results = await db.batch(statements);
  return results[results.length - 1].meta.changes === 1;
}
