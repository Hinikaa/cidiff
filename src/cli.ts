#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { computeDiff } from "./diff.js";
import { renderHtml, renderMarkdown } from "./report.js";
import { buildSnapshot, loadSnapshot } from "./snapshot.js";
import type { StepTiming } from "./types.js";

const VERSION = "1.0.0";

function printHelp(): void {
  const help = [
    "cidiff - compare CI step, BuildKit layer, and test durations",
    "",
    "Usage:",
    "  cidiff record --out <file> [--junit <path>...] [--gotest <path>...] [--vitest <path>...] [--buildkit <path>] [--steps <json-or-file>] [--commit <sha>] [--branch <name>]",
    "  cidiff compare --base <file> --head <file> [--format markdown|json|html] [--html-out <file>] [--step-threshold <sec>] [--test-threshold <sec>] [--fail-on-regression]",
    "",
    "Exit codes:",
    "  0  ok",
    "  1  regression threshold exceeded with --fail-on-regression",
    "  2  error",
  ].join("\n");
  process.stdout.write(help + "\n");
}

function takeValues(args: string[], startIndex: number): { values: string[]; nextIndex: number } {
  const values: string[] = [];
  let i = startIndex;
  while (i < args.length && !args[i].startsWith("--")) {
    for (const part of args[i].split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        values.push(trimmed);
      }
    }
    i += 1;
  }
  if (values.length === 0) {
    throw new Error(`Missing value after ${args[startIndex - 1]}`);
  }
  return { values, nextIndex: i };
}

function takeSingle(args: string[], startIndex: number): { value: string; nextIndex: number } {
  if (startIndex >= args.length || args[startIndex].startsWith("--")) {
    throw new Error(`Missing value after ${args[startIndex - 1]}`);
  }
  return { value: args[startIndex], nextIndex: startIndex + 1 };
}

function parseStepsInput(raw: string): StepTiming[] {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("[") ? trimmed : readFileSync(trimmed, "utf8");
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("--steps must be a JSON array of step timing objects");
  }
  return parsed.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid step entry at index ${idx}`);
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.name !== "string" || typeof obj.durationSec !== "number") {
      throw new Error(`Step entry at index ${idx} requires string "name" and number "durationSec"`);
    }
    const step: StepTiming = {
      name: obj.name,
      durationSec: obj.durationSec,
    };
    if (typeof obj.job === "string") {
      step.job = obj.job;
    }
    if (typeof obj.status === "string") {
      step.status = obj.status;
    }
    return step;
  });
}

function writeFileWithDir(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function runRecord(args: string[]): number {
  let outPath = "";
  const junitPaths: string[] = [];
  const gotestPaths: string[] = [];
  const vitestPaths: string[] = [];
  let buildkitLogPath: string | undefined;
  let steps: StepTiming[] | undefined;
  let commit: string | undefined;
  let branch: string | undefined;

  let i = 0;
  while (i < args.length) {
    const flag = args[i];
    if (flag === "--out") {
      const res = takeSingle(args, i + 1);
      outPath = res.value;
      i = res.nextIndex;
    } else if (flag === "--junit") {
      const res = takeValues(args, i + 1);
      junitPaths.push(...res.values);
      i = res.nextIndex;
    } else if (flag === "--gotest") {
      const res = takeValues(args, i + 1);
      gotestPaths.push(...res.values);
      i = res.nextIndex;
    } else if (flag === "--vitest") {
      const res = takeValues(args, i + 1);
      vitestPaths.push(...res.values);
      i = res.nextIndex;
    } else if (flag === "--buildkit") {
      const res = takeSingle(args, i + 1);
      buildkitLogPath = res.value;
      i = res.nextIndex;
    } else if (flag === "--steps") {
      const res = takeSingle(args, i + 1);
      steps = parseStepsInput(res.value);
      i = res.nextIndex;
    } else if (flag === "--commit") {
      const res = takeSingle(args, i + 1);
      commit = res.value;
      i = res.nextIndex;
    } else if (flag === "--branch") {
      const res = takeSingle(args, i + 1);
      branch = res.value;
      i = res.nextIndex;
    } else {
      throw new Error(`Unknown flag for record: ${flag}`);
    }
  }

  if (!outPath) {
    throw new Error("Missing required --out <file> flag");
  }

  const snapshot = buildSnapshot({
    junitPaths,
    gotestPaths,
    vitestPaths,
    buildkitLogPath,
    steps,
    commit,
    branch,
  });

  writeFileWithDir(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  return 0;
}

function runCompare(args: string[]): number {
  let basePath = "";
  let headPath = "";
  let format: "markdown" | "json" | "html" = "markdown";
  let htmlOutPath: string | undefined;
  let stepThresholdSec = 5;
  let testThresholdSec = 1;
  let failOnRegression = false;

  let i = 0;
  while (i < args.length) {
    const flag = args[i];
    if (flag === "--base") {
      const res = takeSingle(args, i + 1);
      basePath = res.value;
      i = res.nextIndex;
    } else if (flag === "--head") {
      const res = takeSingle(args, i + 1);
      headPath = res.value;
      i = res.nextIndex;
    } else if (flag === "--format") {
      const res = takeSingle(args, i + 1);
      if (res.value !== "markdown" && res.value !== "json" && res.value !== "html") {
        throw new Error(`Invalid --format "${res.value}". Expected markdown, json, or html`);
      }
      format = res.value;
      i = res.nextIndex;
    } else if (flag === "--html-out") {
      const res = takeSingle(args, i + 1);
      htmlOutPath = res.value;
      i = res.nextIndex;
    } else if (flag === "--step-threshold") {
      const res = takeSingle(args, i + 1);
      const val = Number.parseFloat(res.value);
      if (!Number.isFinite(val) || val < 0) {
        throw new Error(`Invalid --step-threshold "${res.value}"`);
      }
      stepThresholdSec = val;
      i = res.nextIndex;
    } else if (flag === "--test-threshold") {
      const res = takeSingle(args, i + 1);
      const val = Number.parseFloat(res.value);
      if (!Number.isFinite(val) || val < 0) {
        throw new Error(`Invalid --test-threshold "${res.value}"`);
      }
      testThresholdSec = val;
      i = res.nextIndex;
    } else if (flag === "--fail-on-regression") {
      failOnRegression = true;
      i += 1;
    } else {
      throw new Error(`Unknown flag for compare: ${flag}`);
    }
  }

  if (!basePath || !headPath) {
    throw new Error("Both --base <file> and --head <file> are required");
  }

  const base = loadSnapshot(basePath);
  const head = loadSnapshot(headPath);
  const diff = computeDiff(base, head, { stepThresholdSec, testThresholdSec });

  let htmlContent: string | undefined;
  if (htmlOutPath || format === "html") {
    htmlContent = renderHtml(diff);
  }
  if (htmlOutPath && htmlContent !== undefined) {
    writeFileWithDir(htmlOutPath, htmlContent);
  }

  if (format === "json") {
    process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
  } else if (format === "html") {
    process.stdout.write((htmlContent ?? renderHtml(diff)) + "\n");
  } else {
    process.stdout.write(renderMarkdown(diff));
  }

  if (failOnRegression && diff.hasRegressions) {
    return 1;
  }
  return 0;
}

export function main(argv: string[]): number {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  const [cmd, ...rest] = argv;
  if (cmd === "record") {
    return runRecord(rest);
  }
  if (cmd === "compare") {
    return runCompare(rest);
  }
  throw new Error(`Unknown command "${cmd}". Expected "record" or "compare".`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exitCode = 2;
}
