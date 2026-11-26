import type { TestTiming } from "../types.js";
export type TestParser = (content: string, filePath?: string) => TestTiming[];
export declare function registerTestParser(format: string, parser: TestParser): void;
export declare function parseTestFile(format: string, content: string, filePath?: string): TestTiming[];
export declare function supportedFormats(): string[];
export { parseBuildkitLog } from "./buildkit.js";
export { parseGoTestJson } from "./gotest.js";
export { parseJunitXml } from "./junit.js";
export { parseVitestJson } from "./vitest.js";
