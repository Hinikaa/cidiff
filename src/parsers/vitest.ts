import type { TestStatus, TestTiming } from "../types.js";

interface JestAssertionResult {
  fullName?: string;
  title?: string;
  status?: string;
  duration?: number | null;
}

interface JestTestResult {
  name?: string;
  assertionResults?: JestAssertionResult[];
}

interface JestReport {
  testResults?: JestTestResult[];
}

function mapStatus(raw: string | undefined): TestStatus {
  if (raw === "failed") {
    return "fail";
  }
  if (raw === "pending" || raw === "skipped" || raw === "todo" || raw === "disabled") {
    return "skip";
  }
  return "pass";
}

export function parseVitestJson(content: string): TestTiming[] {
  let report: JestReport;
  try {
    report = JSON.parse(content) as JestReport;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Vitest/Jest JSON report: ${msg}`);
  }

  if (!report || !Array.isArray(report.testResults)) {
    throw new Error("Invalid Vitest/Jest JSON report: missing testResults array");
  }

  const results: TestTiming[] = [];
  for (const suiteResult of report.testResults) {
    const suite = typeof suiteResult.name === "string" && suiteResult.name.length > 0
      ? suiteResult.name
      : "default";
    const assertions = Array.isArray(suiteResult.assertionResults)
      ? suiteResult.assertionResults
      : [];

    for (const assertion of assertions) {
      const name = assertion.fullName || assertion.title || "unnamed";
      const durationMs =
        typeof assertion.duration === "number" && Number.isFinite(assertion.duration) && assertion.duration >= 0
          ? assertion.duration
          : 0;

      results.push({
        suite,
        name,
        durationSec: durationMs / 1000,
        status: mapStatus(assertion.status),
      });
    }
  }

  return results;
}
