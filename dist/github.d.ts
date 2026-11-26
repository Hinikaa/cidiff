import type { StepTiming } from "./types.js";
export interface GitHubRequestOpts {
    apiBase?: string;
    token: string;
    owner: string;
    repo: string;
}
export declare function fetchRunStepTimings(opts: GitHubRequestOpts & {
    runId: number;
}): Promise<StepTiming[]>;
export declare function fetchLatestBaseBranchSteps(opts: GitHubRequestOpts & {
    branch: string;
    workflowId?: number | string;
    currentRunId?: number;
}): Promise<StepTiming[]>;
export declare function upsertPrComment(opts: GitHubRequestOpts & {
    prNumber: number;
    body: string;
    marker?: string;
}): Promise<{
    action: "created" | "updated";
    id: number;
    url?: string;
}>;
