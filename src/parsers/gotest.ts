import type { TestStatus, TestTiming } from "../types.js";

interface GoTestEvent {
  Action?: string;
  Package?: string;
  Test?: string;
  Elapsed?: number;
}

const TERMINAL_ACTIONS = new Set<string>(["pass", "fail", "skip"]);

export function parseGoTestJson(content: string): TestTiming[] {
  const results: TestTiming[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || !trimmed.startsWith("{")) {
      continue;
    }

    let event: GoTestEvent;
    try {
      event = JSON.parse(trimmed) as GoTestEvent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid go test -json line ${i + 1}: ${msg}`);
    }

    if (!event.Action || !TERMINAL_ACTIONS.has(event.Action)) {
      continue;
    }
    if (typeof event.Test !== "string" || event.Test.length === 0) {
      continue;
    }

    const durationSec =
      typeof event.Elapsed === "number" && Number.isFinite(event.Elapsed) && event.Elapsed >= 0
        ? event.Elapsed
        : 0;

    results.push({
      suite: typeof event.Package === "string" && event.Package.length > 0 ? event.Package : "default",
      name: event.Test,
      durationSec,
      status: event.Action as TestStatus,
    });
  }

  return results;
}
