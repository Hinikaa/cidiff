import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runAction } from "../dist/action.js";

describe("GitHub Action runner", () => {
  it("reads inputs, fetches steps, posts PR comment, writes outputs and HTML", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cidiff-action-"));
    const postedBodies = [];

    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        res.setHeader("Content-Type", "application/json");
        if (req.url.includes("/actions/runs?branch=main")) {
          res.end(JSON.stringify({ workflow_runs: [{ id: 100 }] }));
          return;
        }
        if (req.url.includes("/actions/runs/100/jobs")) {
          res.end(
            JSON.stringify({
              jobs: [
                {
                  id: 1,
                  name: "ci",
                  steps: [
                    {
                      name: "Build",
                      conclusion: "success",
                      started_at: "2026-11-26T10:00:00.000Z",
                      completed_at: "2026-11-26T10:00:05.000Z",
                    },
                  ],
                },
              ],
            })
          );
          return;
        }
        if (req.url.includes("/actions/runs/200/jobs")) {
          res.end(
            JSON.stringify({
              jobs: [
                {
                  id: 2,
                  name: "ci",
                  steps: [
                    {
                      name: "Build",
                      conclusion: "success",
                      started_at: "2026-11-26T10:05:00.000Z",
                      completed_at: "2026-11-26T10:05:25.000Z",
                    },
                  ],
                },
              ],
            })
          );
          return;
        }
        if (req.method === "GET" && req.url.includes("/issues/7/comments")) {
          res.end("[]");
          return;
        }
        if (req.method === "POST" && req.url.includes("/issues/7/comments")) {
          postedBodies.push(JSON.parse(body).body);
          res.statusCode = 201;
          res.end(JSON.stringify({ id: 55, body: JSON.parse(body).body }));
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });

    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const eventPath = join(dir, "event.json");
      const outputPath = join(dir, "github_output.txt");
      const htmlPath = join(dir, "report.html");
      writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }), "utf8");
      writeFileSync(outputPath, "", "utf8");

      const result = await runAction({
        "INPUT_VITEST-PATHS": "test/fixtures/vitest-head.json",
        "INPUT_BUILDKIT-LOG": "test/fixtures/buildkit-head.log",
        "INPUT_GITHUB-TOKEN": "test-token",
        INPUT_COMMENT: "true",
        "INPUT_STEP-THRESHOLD-SEC": "5",
        "INPUT_TEST-THRESHOLD-SEC": "1",
        "INPUT_FAIL-ON-REGRESSION": "true",
        "INPUT_HTML-REPORT-PATH": htmlPath,
        GITHUB_REPOSITORY: "Hinikaa/cidiff",
        GITHUB_RUN_ID: "200",
        GITHUB_BASE_REF: "main",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.diff.totalDeltaSec, 20);
      assert.equal(postedBodies.length, 1);
      assert.match(postedBodies[0], /<!-- cidiff -->/);

      const outputs = readFileSync(outputPath, "utf8");
      assert.match(outputs, /total-delta-sec<<cidiff_EOF_/);
      assert.match(outputs, /regression-count<<cidiff_EOF_/);
      assert.match(outputs, /report-markdown<<cidiff_EOF_/);
      assert.match(readFileSync(htmlPath, "utf8"), /<!DOCTYPE html>/);
    } finally {
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
