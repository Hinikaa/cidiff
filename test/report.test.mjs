import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiff } from "../dist/diff.js";
import { CIDIFF_COMMENT_MARKER, renderHtml, renderMarkdown } from "../dist/report.js";

describe("report rendering", () => {
  it("renders concise markdown with marker and omits empty sections", () => {
    const diff = computeDiff(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        steps: [{ name: "test", durationSec: 10 }],
        dockerLayers: [],
        tests: [],
      },
      {
        version: 1,
        createdAt: "2026-01-02T00:00:00Z",
        steps: [{ name: "test", durationSec: 18 }],
        dockerLayers: [],
        tests: [],
      },
      { stepThresholdSec: 5, testThresholdSec: 1 }
    );

    const md = renderMarkdown(diff);
    assert.ok(md.startsWith(CIDIFF_COMMENT_MARKER));
    assert.match(md, /CI delta: \+8\.0s \(\+80\.0%\) -- 1 step regression/);
    assert.match(md, /### Workflow Steps/);
    assert.doesNotMatch(md, /### Docker BuildKit Layers/);
    assert.doesNotMatch(md, /### Slowest Test Regressions/);
    assert.doesNotMatch(md, /### Fastest Test Improvements/);
  });

  it("escapes all dynamic strings in self-contained HTML reports to prevent XSS", () => {
    const xss = `<script>alert("xss")</script>'&`;
    const diff = computeDiff(
      {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        steps: [{ job: xss, name: `step ${xss}`, durationSec: 1 }],
        dockerLayers: [{ index: 1, stage: xss, instruction: `RUN ${xss}`, cached: true, durationSec: 0 }],
        tests: [{ suite: xss, name: `test ${xss}`, durationSec: 0.1, status: "pass" }],
      },
      {
        version: 1,
        createdAt: "2026-01-02T00:00:00Z",
        steps: [{ job: xss, name: `step ${xss}`, durationSec: 10 }],
        dockerLayers: [{ index: 1, stage: xss, instruction: `RUN ${xss}`, cached: false, durationSec: 9 }],
        tests: [{ suite: xss, name: `test ${xss}`, durationSec: 3.1, status: "pass" }],
      },
      { stepThresholdSec: 5, testThresholdSec: 1 }
    );

    const html = renderHtml(diff);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.doesNotMatch(html, /<script>/);
    assert.ok(html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&#39;&amp;"));
    assert.doesNotMatch(html, /https?:\/\//);
  });
});
