export const CIDIFF_COMMENT_MARKER = "<!-- cidiff -->";
export function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function escapeMdCell(value) {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function formatSec(val) {
    return `${val.toFixed(1)}s`;
}
function formatSignedSec(val) {
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}s`;
}
function formatSignedPct(val) {
    if (val === null) {
        return "n/a";
    }
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}%`;
}
function buildHeadline(diff) {
    const pctPart = diff.totalDeltaPct !== null ? ` (${formatSignedPct(diff.totalDeltaPct)})` : "";
    const reasons = [];
    if (diff.regressedSteps.length > 0) {
        const n = diff.regressedSteps.length;
        reasons.push(`${n} step regression${n === 1 ? "" : "s"}`);
    }
    if (diff.cacheMisses.length > 0) {
        const n = diff.cacheMisses.length;
        reasons.push(`${n} Docker cache miss${n === 1 ? "" : "es"}`);
    }
    const testRegCount = diff.regressedTests.length + diff.slowNewTests.length;
    if (testRegCount > 0) {
        reasons.push(`${testRegCount} test regression${testRegCount === 1 ? "" : "s"}`);
    }
    const summary = reasons.length > 0 ? reasons.join(", ") : "no regressions";
    return `CI delta: ${formatSignedSec(diff.totalDeltaSec)}${pctPart} -- ${summary}`;
}
function stepStatusLabel(d) {
    if (d.regressed) {
        return "[!] FAIL";
    }
    if (d.status === "improved") {
        return "[-] FASTER";
    }
    if (d.status === "added") {
        return "[+] ADDED";
    }
    if (d.status === "removed") {
        return "[-] REMOVED";
    }
    return "PASS";
}
function renderStepMarkdown(stepDeltas) {
    if (stepDeltas.length === 0) {
        return "";
    }
    const ordered = [...stepDeltas].sort((a, b) => {
        if (a.regressed !== b.regressed) {
            return a.regressed ? -1 : 1;
        }
        return Math.abs(b.deltaSec) - Math.abs(a.deltaSec);
    });
    const rows = ordered.slice(0, 20).map((d) => {
        const label = d.job ? `${d.job} / ${d.name}` : d.name;
        const pct = d.deltaPct !== null ? ` (${formatSignedPct(d.deltaPct)})` : "";
        return `| ${escapeMdCell(label)} | ${formatSec(d.baseSec)} | ${formatSec(d.headSec)} | ${formatSignedSec(d.deltaSec)}${pct} | ${stepStatusLabel(d)} |`;
    });
    return [
        "### Workflow Steps",
        "",
        "| Step | Base | Head | Delta | Status |",
        "| --- | ---: | ---: | ---: | --- |",
        ...rows,
    ].join("\n");
}
function renderDockerMarkdown(dockerDeltas) {
    const notable = dockerDeltas.filter((d) => d.regressed || d.cacheFlip !== "NONE" || Math.abs(d.deltaSec) >= 0.5);
    if (notable.length === 0) {
        return "";
    }
    const ordered = [...notable].sort((a, b) => {
        if (a.cacheFlip === "CACHED_TO_MISS" && b.cacheFlip !== "CACHED_TO_MISS") {
            return -1;
        }
        if (b.cacheFlip === "CACHED_TO_MISS" && a.cacheFlip !== "CACHED_TO_MISS") {
            return 1;
        }
        return b.deltaSec - a.deltaSec;
    });
    const rows = ordered.slice(0, 20).map((d) => {
        const flipLabel = d.cacheFlip === "CACHED_TO_MISS"
            ? "[!] CACHED -> MISS"
            : d.cacheFlip === "MISS_TO_CACHED"
                ? "[-] MISS -> CACHED"
                : d.regressed
                    ? "[!] SLOWER"
                    : d.baseCached === null
                        ? "[+] NEW"
                        : "PASS";
        const instr = `[${d.stage}] ${d.instruction}`;
        return `| ${escapeMdCell(instr)} | ${formatSec(d.baseSec)} | ${formatSec(d.headSec)} | ${formatSignedSec(d.deltaSec)} | ${flipLabel} |`;
    });
    return [
        "### Docker BuildKit Layers",
        "",
        "| Layer | Base | Head | Delta | Cache |",
        "| --- | ---: | ---: | ---: | --- |",
        ...rows,
    ].join("\n");
}
function renderTestRegressionsMarkdown(regressedTests, slowNewTests) {
    const combined = [...regressedTests, ...slowNewTests].sort((a, b) => b.deltaSec - a.deltaSec);
    if (combined.length === 0) {
        return "";
    }
    const rows = combined.slice(0, 15).map((t) => {
        const label = `${t.suite} :: ${t.name}`;
        const baseStr = t.baseSec !== null ? formatSec(t.baseSec) : "-";
        const headStr = t.headSec !== null ? formatSec(t.headSec) : "-";
        const note = t.slowNew ? "[+] NEW SLOW" : "[!] REGRESSED";
        return `| ${escapeMdCell(label)} | ${baseStr} | ${headStr} | ${formatSignedSec(t.deltaSec)} | ${note} |`;
    });
    return [
        "### Slowest Test Regressions",
        "",
        "| Test | Base | Head | Delta | Status |",
        "| --- | ---: | ---: | ---: | --- |",
        ...rows,
    ].join("\n");
}
function renderImprovementsMarkdown(improvements) {
    if (improvements.length === 0) {
        return "";
    }
    const rows = improvements.slice(0, 5).map((t) => {
        const label = `${t.suite} :: ${t.name}`;
        return `| ${escapeMdCell(label)} | ${formatSec(t.baseSec ?? 0)} | ${formatSec(t.headSec ?? 0)} | ${formatSignedSec(t.deltaSec)} |`;
    });
    return [
        "### Fastest Test Improvements",
        "",
        "| Test | Base | Head | Delta |",
        "| --- | ---: | ---: | ---: |",
        ...rows,
    ].join("\n");
}
export function renderMarkdown(diff) {
    const sections = [
        CIDIFF_COMMENT_MARKER,
        `**${buildHeadline(diff)}**`,
        `Total: ${formatSec(diff.totalBaseSec)} -> ${formatSec(diff.totalHeadSec)} (step threshold: ${diff.thresholds.stepThresholdSec}s, test threshold: ${diff.thresholds.testThresholdSec}s)`,
    ];
    const stepSection = renderStepMarkdown(diff.stepDeltas);
    if (stepSection) {
        sections.push(stepSection);
    }
    const dockerSection = renderDockerMarkdown(diff.dockerDeltas);
    if (dockerSection) {
        sections.push(dockerSection);
    }
    const testSection = renderTestRegressionsMarkdown(diff.regressedTests, diff.slowNewTests);
    if (testSection) {
        sections.push(testSection);
    }
    const improvSection = renderImprovementsMarkdown(diff.fastestImprovements);
    if (improvSection) {
        sections.push(improvSection);
    }
    return sections.join("\n\n") + "\n";
}
function renderHtmlBarRow(label, baseSec, headSec, deltaSec, maxSec, badgeClass, badgeText) {
    const safeScale = maxSec > 0 ? maxSec : 1;
    const baseWidth = Math.min(100, Math.max(0, (baseSec / safeScale) * 100));
    const headWidth = Math.min(100, Math.max(0, (headSec / safeScale) * 100));
    return [
        `<tr>`,
        `<td class="label">${escapeHtml(label)}</td>`,
        `<td class="bars">`,
        `<div class="bar-line"><span class="bar-tag">base</span><div class="bar-track"><div class="bar-fill base" style="width:${baseWidth.toFixed(1)}%"></div></div><span class="val">${escapeHtml(formatSec(baseSec))}</span></div>`,
        `<div class="bar-line"><span class="bar-tag">head</span><div class="bar-track"><div class="bar-fill head ${badgeClass}" style="width:${headWidth.toFixed(1)}%"></div></div><span class="val">${escapeHtml(formatSec(headSec))}</span></div>`,
        `</td>`,
        `<td class="num">${escapeHtml(formatSignedSec(deltaSec))}</td>`,
        `<td><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></td>`,
        `</tr>`,
    ].join("");
}
export function renderHtml(diff) {
    const headline = buildHeadline(diff);
    const parts = [];
    if (diff.stepDeltas.length > 0) {
        const maxSec = Math.max(...diff.stepDeltas.map((d) => Math.max(d.baseSec, d.headSec)), 1);
        const rows = diff.stepDeltas
            .map((d) => {
            const label = d.job ? `${d.job} / ${d.name}` : d.name;
            const cls = d.regressed ? "fail" : d.status === "improved" ? "pass" : "warn";
            return renderHtmlBarRow(label, d.baseSec, d.headSec, d.deltaSec, maxSec, cls, stepStatusLabel(d));
        })
            .join("\n");
        parts.push(`<section><h2>Workflow Steps</h2><table><thead><tr><th>Step</th><th>Duration Comparison</th><th>Delta</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`);
    }
    if (diff.dockerDeltas.length > 0) {
        const maxSec = Math.max(...diff.dockerDeltas.map((d) => Math.max(d.baseSec, d.headSec)), 1);
        const rows = diff.dockerDeltas
            .map((d) => {
            const label = `[${d.stage}] ${d.instruction}`;
            const cls = d.regressed ? "fail" : d.cacheFlip === "MISS_TO_CACHED" ? "pass" : "warn";
            const badge = d.cacheFlip === "CACHED_TO_MISS"
                ? "[!] CACHED -> MISS"
                : d.cacheFlip === "MISS_TO_CACHED"
                    ? "[-] MISS -> CACHED"
                    : d.headCached
                        ? "CACHED"
                        : d.regressed
                            ? "[!] SLOWER"
                            : d.baseCached === null
                                ? "[+] NEW"
                                : "PASS";
            return renderHtmlBarRow(label, d.baseSec, d.headSec, d.deltaSec, maxSec, cls, badge);
        })
            .join("\n");
        parts.push(`<section><h2>Docker BuildKit Layers</h2><table><thead><tr><th>Layer</th><th>Duration Comparison</th><th>Delta</th><th>Cache</th></tr></thead><tbody>${rows}</tbody></table></section>`);
    }
    const testItems = [
        ...diff.regressedTests,
        ...diff.slowNewTests,
        ...diff.fastestImprovements,
    ];
    if (testItems.length > 0) {
        const maxSec = Math.max(...testItems.map((t) => Math.max(t.baseSec ?? 0, t.headSec ?? 0)), 1);
        const rows = testItems
            .map((t) => {
            const label = `${t.suite} :: ${t.name}`;
            const cls = t.regressed || t.slowNew ? "fail" : "pass";
            const badge = t.slowNew
                ? "[+] NEW SLOW"
                : t.regressed
                    ? "[!] REGRESSED"
                    : "[-] IMPROVED";
            return renderHtmlBarRow(label, t.baseSec ?? 0, t.headSec ?? 0, t.deltaSec, maxSec, cls, badge);
        })
            .join("\n");
        parts.push(`<section><h2>Test Timing Changes</h2><table><thead><tr><th>Test</th><th>Duration Comparison</th><th>Delta</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`);
    }
    const statusClass = diff.hasRegressions ? "fail" : "pass";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cidiff report</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #111827;
  --muted: #6b7280;
  --border: #d1d5db;
  --track: #e5e7eb;
  --base: #64748b;
  --fail: #dc2626;
  --warn: #d97706;
  --pass: #16a34a;
  --card: #f9fafb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #e2e8f0;
    --muted: #94a3b8;
    --border: #334155;
    --track: #1e293b;
    --base: #94a3b8;
    --fail: #ef4444;
    --warn: #f59e0b;
    --pass: #22c55e;
    --card: #1e293b;
  }
}
body {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: var(--bg);
  color: var(--fg);
  margin: 0 auto;
  padding: 24px;
  max-width: 1080px;
  line-height: 1.5;
  font-size: 13px;
}
header {
  border: 1px solid var(--border);
  background: var(--card);
  padding: 16px;
  margin-bottom: 24px;
}
h1 { margin: 0 0 8px 0; font-size: 16px; }
h2 { font-size: 14px; margin: 24px 0 8px 0; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.meta { color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--muted); font-weight: 600; }
td.label { max-width: 360px; word-break: break-word; }
td.bars { min-width: 260px; }
td.num { text-align: right; white-space: nowrap; }
.bar-line { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
.bar-tag { width: 32px; color: var(--muted); font-size: 11px; }
.bar-track { flex: 1; height: 10px; background: var(--track); overflow: hidden; }
.bar-fill { height: 100%; }
.bar-fill.base { background: var(--base); }
.bar-fill.head.fail { background: var(--fail); }
.bar-fill.head.warn { background: var(--warn); }
.bar-fill.head.pass { background: var(--pass); }
.val { width: 56px; text-align: right; font-size: 11px; }
.badge { display: inline-block; padding: 2px 6px; font-size: 11px; border: 1px solid currentColor; white-space: nowrap; }
.badge.fail { color: var(--fail); }
.badge.warn { color: var(--warn); }
.badge.pass { color: var(--pass); }
</style>
</head>
<body>
<header>
  <h1><span class="badge ${statusClass}">${diff.hasRegressions ? "FAIL" : "PASS"}</span> ${escapeHtml(headline)}</h1>
  <div class="meta">Total: ${escapeHtml(formatSec(diff.totalBaseSec))} -&gt; ${escapeHtml(formatSec(diff.totalHeadSec))} | Regressions: ${diff.regressionCount} | Thresholds: step=${diff.thresholds.stepThresholdSec}s, test=${diff.thresholds.testThresholdSec}s</div>
</header>
${parts.join("\n")}
</body>
</html>
`;
}
