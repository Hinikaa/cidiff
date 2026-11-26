import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseBuildkitLog,
  parseGoTestJson,
  parseJunitXml,
  parseTestFile,
  parseVitestJson,
  registerTestParser,
  supportedFormats,
} from "../dist/parsers/index.js";

describe("parsers", () => {
  it("parses JUnit XML with attribute ordering, nested tags, and XML entities", () => {
    const xml = readFileSync("test/fixtures/junit-head.xml", "utf8");
    const tests = parseJunitXml(xml);
    assert.equal(tests.length, 5);

    assert.deepEqual(tests[0], {
      suite: "auth.spec",
      name: "validates JWT & scopes",
      durationSec: 2.65,
      status: "pass",
    });
    assert.deepEqual(tests[1], {
      suite: "auth.spec",
      name: "issues refresh token <v2>",
      durationSec: 0.55,
      status: "pass",
    });
    assert.equal(tests[2].status, "skip");
    assert.deepEqual(tests[3], {
      suite: "auth.spec",
      name: "rotates signing keys",
      durationSec: 1.8,
      status: "fail",
    });
    assert.deepEqual(tests[4], {
      suite: "billing.spec",
      name: 'calculates tax "EU"',
      durationSec: 0.15,
      status: "pass",
    });
  });

  it("parses JUnit XML numeric entities and comments without double unescaping", () => {
    const xml = `<!-- <testcase name="ignored" /> -->
    <testsuite name="edge">
      <testcase name="&amp;lt;tag&amp;gt; &#65; &#x42;" time="1.25" />
    </testsuite>`;
    const tests = parseJunitXml(xml);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].name, "&lt;tag&gt; A B");
    assert.equal(tests[0].durationSec, 1.25);
  });

  it("parses go test -json NDJSON lines and skips package summary lines", () => {
    const ndjson = readFileSync("test/fixtures/gotest-head.jsonl", "utf8");
    const tests = parseGoTestJson(ndjson);
    assert.equal(tests.length, 2);
    assert.deepEqual(tests[0], {
      suite: "github.com/hinikaa/svc/cache",
      name: "TestCacheLookup",
      durationSec: 1.92,
      status: "pass",
    });
    assert.deepEqual(tests[1], {
      suite: "github.com/hinikaa/svc/cache",
      name: "TestCacheCluster",
      durationSec: 0.01,
      status: "skip",
    });
  });

  it("parses Vitest/Jest JSON output and converts ms to seconds", () => {
    const json = readFileSync("test/fixtures/vitest-head.json", "utf8");
    const tests = parseVitestJson(json);
    assert.equal(tests.length, 2);
    assert.deepEqual(tests[0], {
      suite: "src/search.test.ts",
      name: "search indexes 10k docs",
      durationSec: 1.92,
      status: "pass",
    });
    assert.equal(tests[1].durationSec, 0.21);
  });

  it("parses BuildKit plain logs including CACHED, DONE, and ERROR", () => {
    const log = readFileSync("test/fixtures/buildkit-head.log", "utf8");
    const layers = parseBuildkitLog(log);
    assert.equal(layers.length, 5);
    assert.deepEqual(layers[0], {
      index: 3,
      stage: "builder",
      instruction: "FROM docker.io/library/node:20-alpine",
      cached: true,
      durationSec: 0,
    });
    assert.deepEqual(layers[3], {
      index: 6,
      stage: "builder",
      instruction: "RUN npm ci --ignore-scripts",
      cached: false,
      durationSec: 34.2,
    });

    const errLog = `#4 [builder 2/2] RUN false
#4 0.750 failing command
#4 ERROR: process "/bin/sh -c false" did not complete successfully: exit code: 1`;
    const errLayers = parseBuildkitLog(errLog);
    assert.equal(errLayers.length, 1);
    assert.equal(errLayers[0].cached, false);
    assert.equal(errLayers[0].durationSec, 0.75);
    assert.match(errLayers[0].error ?? "", /exit code: 1/);
  });

  it("supports parser registration and format lookup", () => {
    assert.ok(supportedFormats().includes("junit"));
    assert.ok(supportedFormats().includes("gotest"));
    assert.ok(supportedFormats().includes("vitest"));

    registerTestParser("custom-csv", (content) =>
      content
        .trim()
        .split("\n")
        .map((line) => {
          const [suite, name, sec] = line.split(",");
          return { suite, name, durationSec: Number(sec), status: "pass" };
        })
    );
    assert.ok(supportedFormats().includes("custom-csv"));
    const parsed = parseTestFile("custom-csv", "math,adds,0.4");
    assert.deepEqual(parsed, [
      { suite: "math", name: "adds", durationSec: 0.4, status: "pass" },
    ]);
    assert.throws(() => parseTestFile("unknown-fmt", "{}"), /Unsupported test format/);
  });
});
