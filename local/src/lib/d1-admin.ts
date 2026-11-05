import { randomUUID } from "node:crypto";
import { d1Value, getD1Database } from "./d1";

export async function createFirstD1Admin(username: string, passwordHash: string) {
  const now = d1Value(new Date());
  // A single statement serializes competing setup requests in SQLite.
  return getD1Database().prepare(`INSERT INTO "LocalAdmin"
    ("id", "username", "passwordHash", "createdAt", "updatedAt", "lastLoginAt")
    SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM "LocalAdmin")
    RETURNING "id", "username"`)
    .bind(randomUUID(), username, passwordHash, now, now, now)
    .first<{ id: string; username: string }>();
}
