import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getD1Database } from "./d1";

const globalForPrisma = globalThis as unknown as {
  localPrisma?: PrismaClient;
};

function createPrismaAdapter() {
  const connectionString =
    process.env.DATABASE_URL?.trim() || "postgresql://subboost_local_dev:subboost_local_dev_password@localhost:5432/subboost_local_dev?schema=public";
  return new PrismaPg({ connectionString });
}

// Resolve bindings lazily inside a request; build-time imports need no database.
const workerClients = new WeakMap<object, PrismaClient>();
function getWorkerPrisma(): PrismaClient {
  const { ctx } = getCloudflareContext();
  let client = workerClients.get(ctx);
  if (!client) {
    // Worker builds generate this client from the SQLite schema.
    client = new PrismaClient({ adapter: new PrismaD1(getD1Database()) });
    workerClients.set(ctx, client);
  }
  return client;
}

export const prisma = process.env.SUBBOOST_CLOUDFLARE === "true"
  ? new Proxy({} as PrismaClient, {
      get(_target, property) {
        const client = getWorkerPrisma();
        const value = Reflect.get(client, property, client);
        return typeof value === "function" ? value.bind(client) : value;
      },
    })
  : globalForPrisma.localPrisma ?? new PrismaClient({
      adapter: createPrismaAdapter(),
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

if (process.env.NODE_ENV !== "production" && process.env.SUBBOOST_CLOUDFLARE !== "true") {
  globalForPrisma.localPrisma = prisma;
}
