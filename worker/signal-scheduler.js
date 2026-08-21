const GITHUB_OWNER = "AIPeterLab";
const DEFAULT_WORKFLOW_FILE = "daily-update.yml";
const INITIAL_REFRESH_TIME = "18:15";
const RETRY_REFRESH_TIMES = new Set(["18:30", "18:45", "19:00"]);
const QQQ_REPO = "qqq-qld-signal-desk";
const QLD_STATUS_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${QQQ_REPO}/main/data/signals.json`;
const SOURCE_REPOS = new Set([QQQ_REPO, "spy-sso-signal-desk"]);
const DEPENDENCIES = {
  "ira-retirement-desk": [QQQ_REPO, "spy-sso-signal-desk"],
  "roth-estate-growth-desk": [QQQ_REPO],
};
const WORKFLOW_TIMEOUT_MS = 15 * 60 * 1000;
const WORKFLOW_POLL_MS = 10 * 1000;

const DASHBOARDS = [
  {
    name: "QLD Signal Desk",
    repo: "qqq-qld-signal-desk",
    ref: "main",
  },
  {
    name: "SSO Signal Desk",
    repo: "spy-sso-signal-desk",
    ref: "main",
  },
  {
    name: "BTC Cycle Signal Desk",
    repo: "btc-cycle-signal-desk",
    ref: "main",
  },
  {
    name: "IRA Reserve & Growth Desk",
    repo: "ira-retirement-desk",
    ref: "main",
  },
  {
    name: "Roth Estate-Growth Desk",
    repo: "roth-estate-growth-desk",
    ref: "main",
  },
  {
    name: "Indicator Dashboard",
    repo: "indicator-desk",
    ref: "main",
    workflow: "update-dashboard.yml",
  },
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledRefresh(env, event.scheduledTime, event.cron));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.pathname === "/auth-check") {
        return jsonResponse({ ok: false, error: "Not found" }, 404);
      }

      return jsonResponse({
        ok: true,
        service: "aipeterlab-signal-scheduler",
        dashboards: DASHBOARDS.map(({ name, repo, ref, workflow = DEFAULT_WORKFLOW_FILE }) => ({
          name,
          repo,
          ref,
          workflow,
        })),
        schedule: "All dashboards dispatch once at 6:15 PM America/New_York. QLD and its dependent dashboards retry through 7:00 PM only while QLD data is stale.",
      });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const authResult = validateAdminRequest(request, env);
      if (!authResult.ok) {
        return jsonResponse({ ok: false, error: authResult.error }, authResult.status);
      }

      const targetResult = await getTargetDashboards(request);
      if (!targetResult.ok) {
        return jsonResponse({ ok: false, error: targetResult.error }, targetResult.status);
      }

      const result = await dispatchAll(env, {
        trigger: "manual",
        cron: "manual",
        scheduledTime: Date.now(),
      }, targetResult.dashboards);
      return jsonResponse(result, result.ok ? 200 : 500);
    }

    return jsonResponse({ ok: false, error: "Not found" }, 404);
  },
};

async function runScheduledRefresh(env, scheduledTime, cron) {
  const now = new Date(scheduledTime);
  const newYork = getNewYorkScheduleParts(now);
  const initialMode = getRefreshMode(newYork, false);

  if (initialMode === "skip") {
    console.log(
      `Skipping cron ${cron}; New York date/time is ${newYork.date} ${newYork.time} (${newYork.weekday}).`,
    );
    return;
  }

  const context = {
    trigger: "cron",
    cron,
    scheduledTime,
    newYorkDate: newYork.date,
    newYorkTime: newYork.time,
  };

  let result;
  if (initialMode === "all") {
    result = await dispatchAll(env, context);
  } else {
    const qldCurrent = await isQldCurrentForDate(newYork.date, scheduledTime);
    if (getRefreshMode(newYork, qldCurrent) === "skip") {
      console.log(`Skipping QLD retry at ${newYork.time}; QLD already has ${newYork.date}.`);
      return;
    }
    result = await dispatchQldRetry(env, context);
  }

  if (!result.ok) {
    throw new Error(`One or more workflow dispatches failed: ${JSON.stringify(result.results)}`);
  }
}

async function dispatchQldRetry(env, context) {
  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      error: "Missing required Cloudflare Worker secret: GITHUB_TOKEN",
      results: [],
    };
  }

  const retryRepos = new Set(getQldRetryRepos());
  const retryDashboards = DASHBOARDS.filter((dashboard) => retryRepos.has(dashboard.repo));
  const qld = retryDashboards.find((dashboard) => dashboard.repo === QQQ_REPO);
  const dependents = retryDashboards.filter((dashboard) => dashboard.repo !== QQQ_REPO);
  const results = [];
  const dispatch = await dispatchWorkflow(env.GITHUB_TOKEN, qld, context);
  results.push(dispatch);
  if (!dispatch.ok) return { ok: false, context, results };

  const completion = await waitForWorkflowCompletion(
    env.GITHUB_TOKEN,
    qld,
    dispatch.dispatchedAt,
  );
  results.push(completion);
  if (!completion.ok) return { ok: false, context, results };

  const dependentResults = await Promise.all(
    dependents.map((dashboard) =>
      dispatchWorkflow(env.GITHUB_TOKEN, dashboard, context),
    ),
  );
  results.push(...dependentResults);
  return { ok: results.every((result) => result.ok), context, results };
}

async function isQldCurrentForDate(newYorkDate, scheduledTime) {
  try {
    const response = await fetch(`${QLD_STATUS_URL}?scheduled=${scheduledTime}`, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0 },
    });
    if (!response.ok) {
      console.warn(`Could not verify QLD market date: HTTP ${response.status}.`);
      return false;
    }
    const payload = await response.json();
    return payload.last_updated === newYorkDate;
  } catch (error) {
    console.warn(`Could not verify QLD market date: ${error}`);
    return false;
  }
}

async function dispatchAll(env, context, dashboards = DASHBOARDS) {
  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      error: "Missing required Cloudflare Worker secret: GITHUB_TOKEN",
      results: [],
    };
  }

  const requestedDependents = dashboards.filter((dashboard) => DEPENDENCIES[dashboard.repo]);
  const independent = dashboards.filter(
    (dashboard) => !SOURCE_REPOS.has(dashboard.repo) && !DEPENDENCIES[dashboard.repo],
  );
  const results = await Promise.all(
    independent.map((dashboard) => dispatchWorkflow(env.GITHUB_TOKEN, dashboard, context)),
  );

  const requestedSources = new Set(dashboards.filter((dashboard) => SOURCE_REPOS.has(dashboard.repo)).map((dashboard) => dashboard.repo));
  for (const dependent of requestedDependents) {
    for (const sourceRepo of DEPENDENCIES[dependent.repo]) requestedSources.add(sourceRepo);
  }
  const sources = DASHBOARDS.filter((dashboard) => requestedSources.has(dashboard.repo));
  const sourceDispatches = await Promise.all(sources.map((source) => dispatchWorkflow(env.GITHUB_TOKEN, source, context)));
  results.push(...sourceDispatches);
  const completions = await Promise.all(sourceDispatches.filter((result) => result.ok).map((result) => {
    const source = sources.find((dashboard) => dashboard.repo === result.repo);
    return waitForWorkflowCompletion(env.GITHUB_TOKEN, source, result.dispatchedAt);
  }));
  results.push(...completions);

  const successfulSources = new Set(completions.filter((result) => result.ok).map((result) => result.repo));
  const readyDependents = requestedDependents.filter((dependent) =>
    DEPENDENCIES[dependent.repo].every((sourceRepo) => successfulSources.has(sourceRepo)),
  );
  if (readyDependents.length > 0) {
    const dependentResults = await Promise.all(
      readyDependents.map((dashboard) => dispatchWorkflow(env.GITHUB_TOKEN, dashboard, context)),
    );
    results.push(...dependentResults);
  }

  return {
    ok: results.every((result) => result.ok),
    context,
    results,
  };
}

async function getTargetDashboards(request) {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return { ok: true, dashboards: DASHBOARDS };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Request body must be valid JSON.",
    };
  }

  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Request body must include a non-empty repos array.",
    };
  }

  const requested = new Set(body.repos);
  const dashboards = DASHBOARDS.filter((dashboard) => requested.has(dashboard.repo));
  const found = new Set(dashboards.map((dashboard) => dashboard.repo));
  const unknown = body.repos.filter((repo) => !found.has(repo));

  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Unknown dashboard repo(s): ${unknown.join(", ")}`,
    };
  }

  return { ok: true, dashboards };
}

async function dispatchWorkflow(githubToken, dashboard, context) {
  const workflow = dashboard.workflow || DEFAULT_WORKFLOW_FILE;
  const endpoint = `https://api.github.com/repos/${GITHUB_OWNER}/${dashboard.repo}/actions/workflows/${workflow}/dispatches`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "aipeterlab-signal-scheduler",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: dashboard.ref,
    }),
  });

  if (response.status === 204) {
    console.log(`Dispatched ${dashboard.name} (${dashboard.repo}) from ${context.trigger}.`);
    return {
      ok: true,
      name: dashboard.name,
      repo: dashboard.repo,
      status: response.status,
      dispatchedAt: new Date().toISOString(),
    };
  }

  const body = await response.text();
  console.error(`Failed to dispatch ${dashboard.name}: ${response.status} ${body}`);
  return {
    ok: false,
    name: dashboard.name,
    repo: dashboard.repo,
    status: response.status,
    body,
  };
}

export function getNewYorkScheduleParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    weekday: values.weekday,
  };
}

export function getRefreshMode(newYork, qldCurrent) {
  if (["Sat", "Sun"].includes(newYork.weekday)) return "skip";
  if (newYork.time === INITIAL_REFRESH_TIME) return "all";
  if (RETRY_REFRESH_TIMES.has(newYork.time)) return qldCurrent ? "skip" : "qld_retry";
  return "skip";
}

export function getQldRetryRepos() {
  return [
    QQQ_REPO,
    ...DASHBOARDS.filter((dashboard) =>
      DEPENDENCIES[dashboard.repo]?.includes(QQQ_REPO),
    ).map((dashboard) => dashboard.repo),
  ];
}

function validateAdminRequest(request, env) {
  if (!env.SCHEDULER_ADMIN_TOKEN) {
    return {
      ok: false,
      status: 403,
      error: "Manual run is disabled because SCHEDULER_ADMIN_TOKEN is not configured.",
    };
  }

  const expected = `Bearer ${env.SCHEDULER_ADMIN_TOKEN}`;
  if (request.headers.get("Authorization") !== expected) {
    return {
      ok: false,
      status: 401,
      error: "Missing or invalid Authorization bearer token.",
    };
  }

  return { ok: true };
}

async function waitForWorkflowCompletion(githubToken, dashboard, dispatchedAt) {
  const workflow = dashboard.workflow || DEFAULT_WORKFLOW_FILE;
  const endpoint = `https://api.github.com/repos/${GITHUB_OWNER}/${dashboard.repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=20`;
  const deadline = Date.now() + WORKFLOW_TIMEOUT_MS;
  const notBefore = Date.parse(dispatchedAt) - 5000;

  while (Date.now() < deadline) {
    const response = await githubRequest(githubToken, endpoint);
    if (!response.ok) {
      return { ok: false, name: `${dashboard.name} completion`, repo: dashboard.repo, status: response.status, body: await response.text() };
    }

    const payload = await response.json();
    const run = payload.workflow_runs.find(
      (candidate) => candidate.head_branch === dashboard.ref && Date.parse(candidate.created_at) >= notBefore,
    );
    if (run?.status === "completed") {
      return {
        ok: run.conclusion === "success",
        name: `${dashboard.name} completion`,
        repo: dashboard.repo,
        status: run.status,
        conclusion: run.conclusion,
        runId: run.id,
        htmlUrl: run.html_url,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, WORKFLOW_POLL_MS));
  }

  return { ok: false, name: `${dashboard.name} completion`, repo: dashboard.repo, status: "timed_out" };
}

function githubRequest(githubToken, endpoint, init = {}) {
  return fetch(endpoint, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "aipeterlab-signal-scheduler",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
