const GITHUB_OWNER = "AIPeterLab";
const WORKFLOW_FILE = "daily-update.yml";
const TARGET_NEW_YORK_HOUR = "18";

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
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledRefresh(env, event.scheduledTime, event.cron));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "aipeterlab-signal-scheduler",
        dashboards: DASHBOARDS.map(({ name, repo, ref }) => ({ name, repo, ref })),
        schedule: "Dispatches at 6:15 PM America/New_York via 22:15/23:15 UTC cron gates.",
      });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const authResult = validateAdminRequest(request, env);
      if (!authResult.ok) {
        return jsonResponse({ ok: false, error: authResult.error }, authResult.status);
      }

      const result = await dispatchAll(env, {
        trigger: "manual",
        cron: "manual",
        scheduledTime: Date.now(),
      });
      return jsonResponse(result, result.ok ? 200 : 500);
    }

    return jsonResponse({ ok: false, error: "Not found" }, 404);
  },
};

async function runScheduledRefresh(env, scheduledTime, cron) {
  const now = new Date(scheduledTime);
  const newYorkHour = getNewYorkHour(now);

  if (newYorkHour !== TARGET_NEW_YORK_HOUR) {
    console.log(
      `Skipping cron ${cron}; New York hour is ${newYorkHour}, target is ${TARGET_NEW_YORK_HOUR}.`,
    );
    return;
  }

  const result = await dispatchAll(env, {
    trigger: "cron",
    cron,
    scheduledTime,
  });

  if (!result.ok) {
    throw new Error(`One or more workflow dispatches failed: ${JSON.stringify(result.results)}`);
  }
}

async function dispatchAll(env, context) {
  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      error: "Missing required Cloudflare Worker secret: GITHUB_TOKEN",
      results: [],
    };
  }

  const results = await Promise.all(
    DASHBOARDS.map((dashboard) => dispatchWorkflow(env.GITHUB_TOKEN, dashboard, context)),
  );

  return {
    ok: results.every((result) => result.ok),
    context,
    results,
  };
}

async function dispatchWorkflow(githubToken, dashboard, context) {
  const endpoint = `https://api.github.com/repos/${GITHUB_OWNER}/${dashboard.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
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

function getNewYorkHour(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
