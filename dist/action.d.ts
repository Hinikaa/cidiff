import type { DiffSummary } from "./types.js";
export interface ActionResult {
    diff: DiffSummary;
    markdown: string;
    exitCode: number;
}
export declare function runAction(env?: NodeJS.ProcessEnv): Promise<ActionResult>;
