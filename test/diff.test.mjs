import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { computeDiff } from "../dist/diff.js";
import { parseBuildkitLog, parseJunitXml } from "../dist/parsers/index.js";

describe("computeDiff", () => {
  it("detects step regressions, Docker CACHED->MISS flips, slow tests, and improvements", () => {
    const baseSteps = JSON.parse(readFileSync("test/fixtures/steps-base.json", "utf8"));
    const headSteps = JSON.parse(readFileSync("test/fixtures/steps-head.json", "utf8"));
    const baseLayers = parseBuildkitLog(readFileSync("test/fixtures/buildkit-base.log", "utf8"));
    const headLayers = parseBuildkitLog(readFileSync("test/fixtures/buildkit-head.log", "utf8"));
    const baseTests = parseJunitXml(readFileSync("test/fixtures/junit-base.xml", "utf8"));
    const headTests = parseJunitXml(readFileSync("test/fixtures/junit-head.xml", "utf8"));

    const diff = computeDiff(
      { version: 1, createdAt: "2026-01-01T00:00:00Z", steps: baseSteps, dockerLayers: baseLayers, tests: baseTests },
      { version: 1, createdAt: "2026-01-02T00:00:00Z", steps: headSteps, dockerLayers: headLayers, tests: headTests },
      { stepThresholdSec: 5, testThresholdSec: 1 }
    );

    assert.equal(diff.totalBaseSec, 25);
    assert.equal(diff.totalHeadSec, 63.8);
    assert.equal(diff.totalDeltaSec, 38.8);
    assert.equal(diff.hasRegressions, true);

    // Only "Docker build" (+34.2s) exceeds 5s step threshold; "Run tests" (+4.7s) does not.
    assert.equal(diff.regressedSteps.length, 1);
    assert.equal(diff.regressedSteps[0].name, "Docker build");

    // Two layers flipped from CACHED to MISS: COPY package*.json (+0.1s) and RUN npm ci (+34.2s).
    assert.equal(diff.cacheMisses.length, 2);
    assert.equal(diff.cacheMisses[0].instruction, "RUN npm ci --ignore-scripts");
    assert.equal(diff.cacheMisses[0].deltaSec, 34.2);

    assert.equal(diff.regressedTests.length, 1);
    assert.equal(diff.regressedTests[0].name, "validates JWT & scopes");
    assert.equal(diff.regressedTests[0].deltaSec, 2.4);

    assert.equal(diff.slowNewTests.length, 1);
    assert.equal(diff.slowNewTests[0].name, "rotates signing keys");
    assert.equal(diff.slowNewTests[0].headSec, 1.8);

    assert.equal(diff.fastestImprovements.length, 2);
    assert.equal(diff.fastestImprovements[0].deltaSec, -0.05);
  });

  it("falls back to normalized Docker instruction pairing when whitespace changes", () => {
    const diff = computeDiff(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        steps: [],
        dockerLayers: [
          { index: 1, stage: "build", instruction: "RUN  apt-get   update", cached: true, durationSec: 0 },
        ],
        tests: [],
      },
      {
        version: 1,
        createdAt: "2026-01-02T00:00:00Z",
        steps: [],
        dockerLayers: [
          { index: 1, stage: "build", instruction: "RUN apt-get update", cached: false, durationSec: 8.5 },
        ],
        tests: [],
      },
      { stepThresholdSec: 5, testThresholdSec: 1 }
    );

    assert.equal(diff.cacheMisses.length, 1);
    assert.equal(diff.cacheMisses[0].cacheFlip, "CACHED_TO_MISS");
    assert.equal(diff.cacheMisses[0].deltaSec, 8.5);
  });

  it("reports no regressions when deltas remain within thresholds", () => {
    const diff = computeDiff(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        steps: [{ name: "test", durationSec: 10 }],
        dockerLayers: [],
        tests: [{ suite: "s", name: "t", durationSec: 1, status: "pass" }],
      },
      {
        version: 1,
        createdAt: "2026-01-02T00:00:00Z",
        steps: [{ name: "test", durationSec: 14 }],
        dockerLayers: [],
        tests: [{ suite: "s", name: "t", durationSec: 1.8, status: "pass" }],
      },
      { stepThresholdSec: 5, testThresholdSec: 1 }
    );

    assert.equal(diff.hasRegressions, false);
    assert.equal(diff.regressionCount, 0);
  });
});
