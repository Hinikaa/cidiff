import { CIDIFF_COMMENT_MARKER } from "./report.js";
import type { StepTiming } from "./types.js";

export interface GitHubRequestOpts {
  apiBase?: string;
  token: string;
  owner: string;
  repo: string;
}

interface GitHubStep {
  name: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

interface GitHubJob {
  id: number;
  name: string;
  steps?: GitHubStep[];
}

interface GitHubJobsResponse {
  total_count?: number;
  jobs?: GitHubJob[];
}

interface GitHubRun {
  id: number;
  workflow_id?: number;
  status?: string;
  conclusion?: string | null;
}

interface GitHubRunsResponse {
  workflow_runs?: GitHubRun[];
}

interface GitHubComment {
  id: number;
  body?: string;
  html_url?: string;
}

function normalizeApiBase(apiBase?: string): string {
  const base = apiBase || process.env.GITHUB_API_URL || "https://api.github.com";
  return base.replace(/\/+$/, "");
}

async function githubFetchJson<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
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
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${text}`);
  }

  return (await res.json()) as T;
}

function computeStepSec(startedAt?: string | null, completedAt?: string | null): number {
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

export async function fetchRunStepTimings(
  opts: GitHubRequestOpts & { runId: number }
): Promise<StepTiming[]> {
  const apiBase = normalizeApiBase(opts.apiBase);
  const timings: StepTiming[] = [];
  let page = 1;

  while (true) {
    const url = `${apiBase}/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/actions/runs/${opts.runId}/jobs?per_page=100&page=${page}`;
    const data = await githubFetchJson<GitHubJobsResponse>(url, opts.token);
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

export async function fetchLatestBaseBranchSteps(
  opts: GitHubRequestOpts & {
    branch: string;
    workflowId?: number | string;
    currentRunId?: number;
  }
): Promise<StepTiming[]> {
  const apiBase = normalizeApiBase(opts.apiBase);
  const branchParam = encodeURIComponent(opts.branch);
  const owner = encodeURIComponent(opts.owner);
  const repo = encodeURIComponent(opts.repo);

  const path = opts.workflowId !== undefined
    ? `/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(String(opts.workflowId))}/runs?branch=${branchParam}&status=success&per_page=10`
    : `/repos/${owner}/${repo}/actions/runs?branch=${branchParam}&status=success&per_page=10`;

  const data = await githubFetchJson<GitHubRunsResponse>(`${apiBase}${path}`, opts.token);
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

export async function upsertPrComment(
  opts: GitHubRequestOpts & {
    prNumber: number;
    body: string;
    marker?: string;
  }
): Promise<{ action: "created" | "updated"; id: number; url?: string }> {
  const apiBase = normalizeApiBase(opts.apiBase);
  const marker = opts.marker ?? CIDIFF_COMMENT_MARKER;
  const owner = encodeURIComponent(opts.owner);
  const repo = encodeURIComponent(opts.repo);

  let existing: GitHubComment | undefined;
  let page = 1;

  while (true) {
    const listUrl = `${apiBase}/repos/${owner}/${repo}/issues/${opts.prNumber}/comments?per_page=100&page=${page}`;
    const comments = await githubFetchJson<GitHubComment[]>(listUrl, opts.token);
    existing = comments.find((c) => typeof c.body === "string" && c.body.includes(marker));
    if (existing || comments.length < 100) {
      break;
    }
    page += 1;
  }

  if (existing) {
    const patchUrl = `${apiBase}/repos/${owner}/${repo}/issues/comments/${existing.id}`;
    const updated = await githubFetchJson<GitHubComment>(patchUrl, opts.token, {
      method: "PATCH",
      body: JSON.stringify({ body: opts.body }),
    });
    return { action: "updated", id: updated.id, url: updated.html_url };
  }

  const createUrl = `${apiBase}/repos/${owner}/${repo}/issues/${opts.prNumber}/comments`;
  const created = await githubFetchJson<GitHubComment>(createUrl, opts.token, {
    method: "POST",
    body: JSON.stringify({ body: opts.body }),
  });
  return { action: "created", id: created.id, url: created.html_url };
}
