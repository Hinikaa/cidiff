import { parseGoTestJson } from "./gotest.js";
import { parseJunitXml } from "./junit.js";
import { parseVitestJson } from "./vitest.js";
const registry = new Map();
export function registerTestParser(format, parser) {
    const key = format.trim().toLowerCase();
    if (!key) {
        throw new Error("Test parser format name cannot be empty");
    }
    registry.set(key, parser);
}
export function parseTestFile(format, content, filePath) {
    const key = format.trim().toLowerCase();
    const parser = registry.get(key);
    if (!parser) {
        throw new Error(`Unsupported test format "${format}". Supported formats: ${supportedFormats().join(", ")}`);
    }
    return parser(content, filePath);
}
export function supportedFormats() {
    return Array.from(registry.keys());
}
registerTestParser("junit", parseJunitXml);
registerTestParser("gotest", parseGoTestJson);
registerTestParser("vitest", parseVitestJson);
registerTestParser("jest", parseVitestJson);
export { parseBuildkitLog } from "./buildkit.js";
export { parseGoTestJson } from "./gotest.js";
export { parseJunitXml } from "./junit.js";
export { parseVitestJson } from "./vitest.js";
