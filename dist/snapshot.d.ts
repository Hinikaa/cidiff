import type { BaselineSnapshot, StepTiming } from "./types.js";
export interface BuildSnapshotOptions {
    junitPaths?: string[];
    gotestPaths?: string[];
    vitestPaths?: string[];
    buildkitLogPath?: string;
    steps?: StepTiming[];
    commit?: string;
    branch?: string;
}
export declare function buildSnapshot(opts: BuildSnapshotOptions): BaselineSnapshot;
export declare function loadSnapshot(filePath: string): BaselineSnapshot;
