import type { DiffSummary } from "./types.js";
export declare const CIDIFF_COMMENT_MARKER = "<!-- cidiff -->";
export declare function escapeHtml(value: string): string;
export declare function renderMarkdown(diff: DiffSummary): string;
export declare function renderHtml(diff: DiffSummary): string;
