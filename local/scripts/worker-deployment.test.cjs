const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDeploymentConfig, run } = require("./worker-deployment.cjs");

const placeholder = "00000000-0000-0000-0000-000000000000";
const databaseId = "11111111-2222-4333-8444-555555555555";
const template = fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8");

test("injects only the D1 ID while preserving the source template", () => {
  const result = createDeploymentConfig(template, ` ${databaseId} `);
  assert.equal(result, template.replace(placeholder, databaseId));
  assert.equal(fs.readFileSync(path.resolve(__dirname, "../wrangler.jsonc"), "utf8"), template);
});

test("requires a valid non-placeholder UUID for remote operations", () => {
  for (const value of [undefined, "", "not-a-uuid", placeholder, `${databaseId}\nextra`]) {
    assert.throws(() => createDeploymentConfig(template, value), /D1_DATABASE_ID/);
  }
  assert.throws(() => createDeploymentConfig("{}", databaseId), /placeholder/);
});

test("allows a secret-free dry run without selecting a real database", () => {
  assert.equal(createDeploymentConfig(template, undefined, true), template);
});

for (const mode of ["deploy", "migrate", "dry-run"]) {
  test(`${mode} passes a temporary config and deletes it even on a failed command`, () => {
    const previous = process.env.D1_DATABASE_ID;
    process.env.D1_DATABASE_ID = databaseId;
    let configPath;
    try {
      const status = run(mode, { spawnSync(executable, args, options) {
        configPath = args[args.indexOf("--config") + 1];
        assert.equal(path.dirname(configPath), options.cwd);
        assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).d1_databases[0].database_id, databaseId);
        assert.equal(executable, process.execPath);
        assert.ok(args.includes(mode === "migrate" ? "--remote" : mode === "dry-run" ? "--dry-run" : "deploy"));
        return { status: 1 };
      } });
      assert.equal(status, 1);
      assert.equal(fs.existsSync(configPath), false);
    } finally {
      if (previous === undefined) delete process.env.D1_DATABASE_ID;
      else process.env.D1_DATABASE_ID = previous;
    }
  });
}

test("cleans up the temporary config when the child process cannot start", () => {
  const previous = process.env.D1_DATABASE_ID;
  process.env.D1_DATABASE_ID = databaseId;
  let configPath;
  try {
    assert.throws(() => run("deploy", { spawnSync(_executable, args) {
      configPath = args[args.indexOf("--config") + 1];
      return { error: new Error("could not start") };
    } }), /could not start/);
    assert.equal(fs.existsSync(configPath), false);
  } finally {
    if (previous === undefined) delete process.env.D1_DATABASE_ID;
    else process.env.D1_DATABASE_ID = previous;
  }
});
