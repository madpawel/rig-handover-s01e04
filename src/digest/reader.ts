import { closeSync, constants, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
  time: number;
  fraction: string;
  tieKey: string;
};

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string'
    || !('job' in value) || typeof value.job !== 'string' || !value.job.trim()
    || !('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')
    || !('owner' in value) || (typeof value.owner !== 'string' && value.owner !== null)) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;
  // Require an explicit offset; Date.parse alone accepts local times and normalizes bad dates.
  const timestamp = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d+))?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value.at);
  const time = Date.parse(value.at);
  if (!timestamp || !validDate(timestamp[1]) || !Number.isFinite(time)) return null;
  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error,
    time,
    // Date.parse keeps milliseconds only; retain the rest for sub-millisecond ordering.
    fraction: (timestamp[5] ?? '').slice(3).replace(/0+$/, ''),
    tieKey: JSON.stringify([value.at, value.status, value.owner, error ?? null]),
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Invalid night names, like missing nights, return null without opening a file. */
export const readNight: ReadNight = (runsDir, night) => {
  if (!validDate(night)) return null;
  let contents: string;
  try {
    // Never follow a date-named symlink out of the runs directory.
    const fd = openSync(resolve(runsDir, `${night}.jsonl`), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      contents = readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const events: RunEvent[] = [];
  let badLines = 0;
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (!event) {
      badLines++;
      continue;
    }
    events.push(event);
    counts[event.status]++;
  }
  // Equal instants use the literal at/status/owner/error tuple, not file order.
  events.sort((a, b) => a.time - b.time
    || compareText(a.fraction, b.fraction) || compareText(a.tieKey, b.tieKey));

  const jobs = new Map<string, DigestRow>();
  for (const event of events) {
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null,
        firstAt: event.at, lastAt: event.at, hasFailure: false,
      };
      jobs.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    if (event.error !== undefined) row.lastError = event.error;
  }
  return {
    night,
    rows: [...jobs.values()].sort((a, b) => compareText(a.job, b.job)),
    badLines,
    counts,
  };
};
