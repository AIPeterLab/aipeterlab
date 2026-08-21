import assert from "node:assert/strict";
import test from "node:test";

import {
  getNewYorkScheduleParts,
  getQldRetryRepos,
  getRefreshMode,
} from "./signal-scheduler.js";

test("dispatches all dashboards at 6:15 PM during daylight time", () => {
  const parts = getNewYorkScheduleParts(new Date("2026-08-21T22:15:00Z"));
  assert.deepEqual(parts, { date: "2026-08-21", time: "18:15", weekday: "Fri" });
  assert.equal(getRefreshMode(parts, false), "all");
});

test("dispatches all dashboards at 6:15 PM during standard time", () => {
  const parts = getNewYorkScheduleParts(new Date("2026-12-21T23:15:00Z"));
  assert.deepEqual(parts, { date: "2026-12-21", time: "18:15", weekday: "Mon" });
  assert.equal(getRefreshMode(parts, false), "all");
});

test("disables the former 5 PM New York refresh", () => {
  const parts = getNewYorkScheduleParts(new Date("2026-08-21T21:00:00Z"));
  assert.equal(getRefreshMode(parts, false), "skip");
});

test("retries only while QLD is stale", () => {
  const parts = getNewYorkScheduleParts(new Date("2026-08-21T22:30:00Z"));
  assert.equal(getRefreshMode(parts, false), "qld_retry");
  assert.equal(getRefreshMode(parts, true), "skip");
});

test("does not refresh dashboards after the retry window", () => {
  const parts = getNewYorkScheduleParts(new Date("2026-08-21T23:15:00Z"));
  assert.equal(getRefreshMode(parts, false), "skip");
});

test("retry candidates exclude independent dashboards", () => {
  assert.deepEqual(getQldRetryRepos(), [
    "qqq-qld-signal-desk",
    "ira-retirement-desk",
    "roth-estate-growth-desk",
  ]);
});
