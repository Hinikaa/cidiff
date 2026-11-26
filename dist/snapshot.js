import { readFileSync } from "node:fs";
import { parseBuildkitLog, parseTestFile } from "./parsers/index.js";
function readTests(paths, format) {
    if (!paths || paths.length === 0) {
        return [];
    }
    const all = [];
    for (const filePath of paths) {
        const content = readFileSync(filePath, "utf8");
        all.push(...parseTestFile(format, content, filePath));
    }
    return all;
}
export function buildSnapshot(opts) {
    const tests = [
        ...readTests(opts.junitPaths, "junit"),
        ...readTests(opts.gotestPaths, "gotest"),
        ...readTests(opts.vitestPaths, "vitest"),
    ];
    let dockerLayers = [];
    if (opts.buildkitLogPath) {
        const content = readFileSync(opts.buildkitLogPath, "utf8");
        dockerLayers = parseBuildkitLog(content);
    }
    const snapshot = {
        version: 1,
        createdAt: new Date().toISOString(),
        steps: opts.steps ?? [],
        dockerLayers,
        tests,
    };
    if (opts.commit) {
        snapshot.commit = opts.commit;
    }
    if (opts.branch) {
        snapshot.branch = opts.branch;
    }
    return snapshot;
}
export function loadSnapshot(filePath) {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
        throw new Error(`Invalid snapshot JSON in ${filePath}`);
    }
    return {
        version: 1,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
        commit: parsed.commit,
        branch: parsed.branch,
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        dockerLayers: Array.isArray(parsed.dockerLayers) ? parsed.dockerLayers : [],
        tests: Array.isArray(parsed.tests) ? parsed.tests : [],
    };
}
