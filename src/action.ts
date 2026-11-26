import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { computeDiff } from "./diff.js";
import { fetchLatestBaseBranchSteps, fetchRunStepTimings, upsertPrComment } from "./github.js";
import { renderHtml, renderMarkdown } from "./report.js";
import { buildSnapshot, loadSnapshot } from "./snapshot.js";
import type { BaselineSnapshot, DiffSummary } from "./types.js";

function getInput(env: NodeJS.ProcessEnv, name: string): string {
  const exactKey = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const altKey = `INPUT_${name.replace(/[ -]/g, "_").toUpperCase()}`;
  return (env[exactKey] ?? env[altKey] ?? "").trim();
}

function parseBool(value: string, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`Invalid boolean value: "${value}"`);
}

function parseNum(value: string, defaultValue: number, name: string): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${name}: "${value}"`);
  }
  return parsed;
}

function parsePathList(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\r\n,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function writeGithubOutput(outputPath: string, key: string, value: string): void {
  const delimiter = `cidiff_EOF_${randomBytes(8).toString("hex")}`;
  const block = `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
  appendFileSync(outputPath, block, "utf8");
}

function readPrNumber(eventPath: string | undefined): number | undefined {
  if (!eventPath || !existsSync(eventPath)) {
    return undefined;
  }
  const raw = readFileSync(eventPath, "utf8");
  const payload = JSON.parse(raw) as {
    pull_request?: { number?: number };
    issue?: { number?: number };
    number?: number;
  };
  const num = payload.pull_request?.number ?? payload.issue?.number ?? payload.number;
  return typeof num === "number" && Number.isInteger(num) ? num : undefined;
}

function parseRepo(rawRepo: string | undefined): { owner: string; repo: string } | undefined {
  if (!rawRepo || !rawRepo.includes("/")) {
    return undefined;
  }
  const [owner, repo] = rawRepo.split("/", 2);
  if (!owner || !repo) {
    return undefined;
  }
  return { owner, repo };
}

export interface ActionResult {
  diff: DiffSummary;
  markdown: string;
  exitCode: number;
}

export async function runAction(env: NodeJS.ProcessEnv = process.env): Promise<ActionResult> {
  const baselineFile = getInput(env, "baseline-file");
  const junitPaths = parsePathList(getInput(env, "junit-paths"));
  const gotestPaths = parsePathList(getInput(env, "gotest-paths"));
  const vitestPaths = parsePathList(getInput(env, "vitest-paths"));
  const buildkitLogPath = getInput(env, "buildkit-log") || undefined;
  const token = getInput(env, "github-token") || env.GITHUB_TOKEN || "";
  const shouldComment = parseBool(getInput(env, "comment"), true);
  const stepThresholdSec = parseNum(getInput(env, "step-threshold-sec"), 5, "step-threshold-sec");
  const testThresholdSec = parseNum(getInput(env, "test-threshold-sec"), 1, "test-threshold-sec");
  const failOnRegression = parseBool(getInput(env, "fail-on-regression"), false);
  const htmlReportPath = getInput(env, "html-report-path");

  const repoInfo = parseRepo(env.GITHUB_REPOSITORY);
  const runIdRaw = env.GITHUB_RUN_ID ? Number.parseInt(env.GITHUB_RUN_ID, 10) : NaN;
  const runId = Number.isInteger(runIdRaw) ? runIdRaw : undefined;
  const baseBranch = env.GITHUB_BASE_REF || "";
  const apiBase = env.GITHUB_API_URL;

  const headSnapshot = buildSnapshot({
    junitPaths,
    gotestPaths,
    vitestPaths,
    buildkitLogPath,
    commit: env.GITHUB_SHA,
    branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
  });

  if (token && repoInfo && runId !== undefined) {
    headSnapshot.steps = await fetchRunStepTimings({
      apiBase,
      token,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      runId,
    });
  }

  let baseSnapshot: BaselineSnapshot;
  if (baselineFile && existsSync(baselineFile)) {
    baseSnapshot = loadSnapshot(baselineFile);
  } else {
    baseSnapshot = {
      version: 1,
      createdAt: new Date(0).toISOString(),
      steps: [],
      dockerLayers: [],
      tests: [],
    };
  }

  if (baseSnapshot.steps.length === 0 && token && repoInfo && baseBranch) {
    baseSnapshot.steps = await fetchLatestBaseBranchSteps({
      apiBase,
      token,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      branch: baseBranch,
      currentRunId: runId,
    });
  }

  const diff = computeDiff(baseSnapshot, headSnapshot, {
    stepThresholdSec,
    testThresholdSec,
  });
  const markdown = renderMarkdown(diff);

  if (htmlReportPath) {
    mkdirSync(dirname(htmlReportPath), { recursive: true });
    writeFileSync(htmlReportPath, renderHtml(diff), "utf8");
  }

  if (env.GITHUB_OUTPUT) {
    writeGithubOutput(env.GITHUB_OUTPUT, "total-delta-sec", String(diff.totalDeltaSec));
    writeGithubOutput(env.GITHUB_OUTPUT, "regression-count", String(diff.regressionCount));
    writeGithubOutput(env.GITHUB_OUTPUT, "report-markdown", markdown);
  }

  if (shouldComment && token && repoInfo) {
    const prNumber = readPrNumber(env.GITHUB_EVENT_PATH);
    if (prNumber !== undefined) {
      await upsertPrComment({
        apiBase,
        token,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        prNumber,
        body: markdown,
      });
    }
  }

  process.stdout.write(markdown);
  const exitCode = failOnRegression && diff.hasRegressions ? 1 : 0;
  return { diff, markdown, exitCode };
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  runAction()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      process.exitCode = 2;
    });
}
