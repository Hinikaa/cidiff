import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import {
  fetchLatestBaseBranchSteps,
  fetchRunStepTimings,
  upsertPrComment,
} from "../dist/github.js";

function withMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
    server.on("error", reject);
  });
}

describe("github client", () => {
  it("fetches job step timings and latest base branch run steps", async () => {
    const server = await withMockServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/repos/Hinikaa/cidiff/actions/runs?branch=main")) {
        res.end(JSON.stringify({ workflow_runs: [{ id: 999 }, { id: 888 }] }));
        return;
      }
      if (req.url.startsWith("/repos/Hinikaa/cidiff/actions/runs/888/jobs")) {
        res.end(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                name: "build",
                steps: [
                  {
                    name: "Test",
                    conclusion: "success",
                    started_at: "2026-11-26T10:00:00.000Z",
                    completed_at: "2026-11-26T10:00:12.500Z",
                  },
                ],
              },
            ],
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
    });

    try {
      const steps = await fetchRunStepTimings({
        apiBase: server.baseUrl,
        token: "tok",
        owner: "Hinikaa",
        repo: "cidiff",
        runId: 888,
      });
      assert.deepEqual(steps, [
        { job: "build", name: "Test", durationSec: 12.5, status: "success" },
      ]);

      const baseSteps = await fetchLatestBaseBranchSteps({
        apiBase: server.baseUrl,
        token: "tok",
        owner: "Hinikaa",
        repo: "cidiff",
        branch: "main",
        currentRunId: 999,
      });
      assert.deepEqual(baseSteps, steps);
    } finally {
      await server.close();
    }
  });

  it("creates a PR comment when absent and updates when <!-- cidiff --> exists", async () => {
    const comments = [];
    const requests = [];

    const server = await withMockServer((req, res, body) => {
      requests.push({ method: req.method, url: req.url });
      res.setHeader("Content-Type", "application/json");

      if (req.method === "GET" && req.url.includes("/issues/42/comments")) {
        res.end(JSON.stringify(comments));
        return;
      }
      if (req.method === "POST" && req.url.includes("/issues/42/comments")) {
        const parsed = JSON.parse(body);
        const created = { id: 101, body: parsed.body, html_url: "http://example/101" };
        comments.push(created);
        res.statusCode = 201;
        res.end(JSON.stringify(created));
        return;
      }
      if (req.method === "PATCH" && req.url.includes("/issues/comments/101")) {
        const parsed = JSON.parse(body);
        comments[0].body = parsed.body;
        res.end(JSON.stringify(comments[0]));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });

    try {
      const first = await upsertPrComment({
        apiBase: server.baseUrl,
        token: "tok",
        owner: "Hinikaa",
        repo: "cidiff",
        prNumber: 42,
        body: "<!-- cidiff -->\nfirst",
      });
      assert.equal(first.action, "created");
      assert.equal(first.id, 101);

      const second = await upsertPrComment({
        apiBase: server.baseUrl,
        token: "tok",
        owner: "Hinikaa",
        repo: "cidiff",
        prNumber: 42,
        body: "<!-- cidiff -->\nsecond",
      });
      assert.equal(second.action, "updated");
      assert.equal(second.id, 101);
      assert.equal(comments.length, 1);
      assert.equal(comments[0].body, "<!-- cidiff -->\nsecond");
    } finally {
      await server.close();
    }
  });
});
