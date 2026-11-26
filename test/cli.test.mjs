import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
  });
}

describe("CLI end-to-end", () => {
  it("records base and head snapshots and compares in markdown, json, and html", () => {
    const dir = mkdtempSync(join(tmpdir(), "cidiff-cli-"));
    try {
      const baseJson = join(dir, "base.json");
      const headJson = join(dir, "head.json");
      const htmlOut = join(dir, "report.html");

      const recBase = runCli([
        "record",
        "--out",
        baseJson,
        "--junit",
        "test/fixtures/junit-base.xml",
        "--gotest",
        "test/fixtures/gotest-base.jsonl",
        "--vitest",
        "test/fixtures/vitest-base.json",
        "--buildkit",
        "test/fixtures/buildkit-base.log",
        "--steps",
        "test/fixtures/steps-base.json",
      ]);
      assert.equal(recBase.status, 0, recBase.stderr);

      const recHead = runCli([
        "record",
        "--out",
        headJson,
        "--junit",
        "test/fixtures/junit-head.xml",
        "--gotest",
        "test/fixtures/gotest-head.jsonl",
        "--vitest",
        "test/fixtures/vitest-head.json",
        "--buildkit",
        "test/fixtures/buildkit-head.log",
        "--steps",
        "test/fixtures/steps-head.json",
      ]);
      assert.equal(recHead.status, 0, recHead.stderr);

      const cmpMd = runCli([
        "compare",
        "--base",
        baseJson,
        "--head",
        headJson,
        "--format",
        "markdown",
        "--html-out",
        htmlOut,
      ]);
      assert.equal(cmpMd.status, 0, cmpMd.stderr);
      assert.match(cmpMd.stdout, /<!-- cidiff -->/);
      assert.match(cmpMd.stdout, /CACHED -> MISS/);
      assert.ok(existsSync(htmlOut));
      assert.match(readFileSync(htmlOut, "utf8"), /<!DOCTYPE html>/);

      const cmpJson = runCli([
        "compare",
        "--base",
        baseJson,
        "--head",
        headJson,
        "--format",
        "json",
      ]);
      assert.equal(cmpJson.status, 0, cmpJson.stderr);
      const parsed = JSON.parse(cmpJson.stdout);
      assert.equal(parsed.hasRegressions, true);
      assert.ok(parsed.cacheMisses.length >= 1);

      const cmpFail = runCli([
        "compare",
        "--base",
        baseJson,
        "--head",
        headJson,
        "--step-threshold",
        "5",
        "--test-threshold",
        "1",
        "--fail-on-regression",
      ]);
      assert.equal(cmpFail.status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits with code 2 on invalid arguments or missing files", () => {
    const res = runCli(["compare", "--base", "does-not-exist.json", "--head", "missing.json"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Error:/);

    const unknown = runCli(["bogus"]);
    assert.equal(unknown.status, 2);
  });
});
