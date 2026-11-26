export interface StepTiming {
    job?: string;
    name: string;
    durationSec: number;
    status?: string;
}
export type TestStatus = "pass" | "fail" | "skip";
export interface TestTiming {
    suite: string;
    name: string;
    durationSec: number;
    status: TestStatus;
}
export interface DockerLayer {
    index: number;
    stage: string;
    instruction: string;
    cached: boolean;
    durationSec: number;
    error?: string;
}
export interface BaselineSnapshot {
    version: 1;
    createdAt: string;
    commit?: string;
    branch?: string;
    steps: StepTiming[];
    dockerLayers: DockerLayer[];
    tests: TestTiming[];
}
export type DeltaStatus = "regressed" | "improved" | "unchanged" | "added" | "removed";
export interface StepDelta {
    job?: string;
    name: string;
    baseSec: number;
    headSec: number;
    deltaSec: number;
    deltaPct: number | null;
    status: DeltaStatus;
    regressed: boolean;
}
export interface TestDelta {
    suite: string;
    name: string;
    baseSec: number | null;
    headSec: number | null;
    deltaSec: number;
    deltaPct: number | null;
    status: DeltaStatus;
    regressed: boolean;
    slowNew: boolean;
}
export type CacheFlip = "CACHED_TO_MISS" | "MISS_TO_CACHED" | "NONE";
export interface DockerLayerDelta {
    stage: string;
    instruction: string;
    baseCached: boolean | null;
    headCached: boolean | null;
    baseSec: number;
    headSec: number;
    deltaSec: number;
    cacheFlip: CacheFlip;
    regressed: boolean;
}
export interface DiffThresholds {
    stepThresholdSec: number;
    testThresholdSec: number;
    layerThresholdSec?: number;
}
export interface DiffSummary {
    totalBaseSec: number;
    totalHeadSec: number;
    totalDeltaSec: number;
    totalDeltaPct: number | null;
    stepDeltas: StepDelta[];
    dockerDeltas: DockerLayerDelta[];
    testDeltas: TestDelta[];
    regressedSteps: StepDelta[];
    cacheMisses: DockerLayerDelta[];
    regressedTests: TestDelta[];
    slowNewTests: TestDelta[];
    fastestImprovements: TestDelta[];
    regressionCount: number;
    hasRegressions: boolean;
    thresholds: DiffThresholds;
}
