import { CIDIFF_COMMENT_MARKER } from "./report.js";
function normalizeApiBase(apiBase) {
    const base = apiBase || process.env.GITHUB_API_URL || "https://api.github.com";
    return base.replace(/\/+$/, "");
}
async function githubFetchJson(url, token, init) {
    const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "cidiff/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (init?.body) {
        headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, {
        ...init,
        headers: {
            ...headers,
            ...init?.headers,
        },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${text}`);
    }
    return (await res.json());
}
function computeStepSec(startedAt, completedAt) {
    if (!startedAt || !completedAt) {
        return 0;
    }
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(completedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return 0;
    }
    return Math.round((endMs - startMs)) / 1000;
}
export async function fetchRunStepTimings(opts) {
    const apiBase = normalizeApiBase(opts.apiBase);
    const timings = [];
    let page = 1;
    while (true) {
        const url = `${apiBase}/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/actions/runs/${opts.runId}/jobs?per_page=100&page=${page}`;
        const data = await githubFetchJson(url, opts.token);
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        for (const job of jobs) {
            const steps = Array.isArray(job.steps) ? job.steps : [];
            for (const step of steps) {
                if (!step.started_at || !step.completed_at) {
                    continue;
                }
                timings.push({
                    job: job.name,
                    name: step.name,
                    durationSec: computeStepSec(step.started_at, step.completed_at),
                    status: step.conclusion ?? step.status,
                });
            }
        }
        if (jobs.length < 100) {
            break;
        }
        page += 1;
    }
    return timings;
}
export async function fetchLatestBaseBranchSteps(opts) {
    const apiBase = normalizeApiBase(opts.apiBase);
    const branchParam = encodeURIComponent(opts.branch);
    const owner = encodeURIComponent(opts.owner);
    const repo = encodeURIComponent(opts.repo);
    const path = opts.workflowId !== undefined
        ? `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(String(opts.workflowId))}/runs?branch=${branchParam}&status=success&per_page=10`
        : `/repos/${owner}/${repo}/actions/runs?branch=${branchParam}&status=success&per_page=10`;
    const data = await githubFetchJson(`${apiBase}${path}`, opts.token);
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    const target = runs.find((r) => r.id !== opts.currentRunId);
    if (!target) {
        return [];
    }
    return fetchRunStepTimings({
        apiBase: opts.apiBase,
        token: opts.token,
        owner: opts.owner,
        repo: opts.repo,
        runId: target.id,
    });
}
export async function upsertPrComment(opts) {
    const apiBase = normalizeApiBase(opts.apiBase);
    const marker = opts.marker ?? CIDIFF_COMMENT_MARKER;
    const owner = encodeURIComponent(opts.owner);
    const repo = encodeURIComponent(opts.repo);
    let existing;
    let page = 1;
    while (true) {
        const listUrl = `${apiBase}/repos/${owner}/${repo}/issues/${opts.prNumber}/comments?per_page=100&page=${page}`;
        const comments = await githubFetchJson(listUrl, opts.token);
        existing = comments.find((c) => typeof c.body === "string" && c.body.includes(marker));
        if (existing || comments.length < 100) {
            break;
        }
        page += 1;
    }
    if (existing) {
        const patchUrl = `${apiBase}/repos/${owner}/${repo}/issues/comments/${existing.id}`;
        const updated = await githubFetchJson(patchUrl, opts.token, {
            method: "PATCH",
            body: JSON.stringify({ body: opts.body }),
        });
        return { action: "updated", id: updated.id, url: updated.html_url };
    }
    const createUrl = `${apiBase}/repos/${owner}/${repo}/issues/${opts.prNumber}/comments`;
    const created = await githubFetchJson(createUrl, opts.token, {
        method: "POST",
        body: JSON.stringify({ body: opts.body }),
    });
    return { action: "created", id: created.id, url: created.html_url };
}
