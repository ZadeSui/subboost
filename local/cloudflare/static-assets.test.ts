import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Worker static assets", () => {
  it("serves the public app icon without a Next.js metadata route", () => {
    const icon = fileURLToPath(new URL("../public/icon.png", import.meta.url));
    expect(readFileSync(icon).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(existsSync(fileURLToPath(new URL("../app/icon.png", import.meta.url)))).toBe(false);
  });
});
