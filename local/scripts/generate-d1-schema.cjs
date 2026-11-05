const fs = require("node:fs");
const path = require("node:path");

// Keep model names and fields in sync with the existing self-hosted schema.
const prismaDir = path.resolve(__dirname, "../prisma");
const schema = fs.readFileSync(path.join(prismaDir, "schema.prisma"), "utf8")
  .replace('provider = "postgresql"', 'provider = "sqlite"')
  .replace(/\s+@db\.Text/g, "");
fs.writeFileSync(path.join(prismaDir, "schema.d1.prisma"), schema);
