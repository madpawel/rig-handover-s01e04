import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest, RunStatus } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T23:01:00+05:30';
const lastAt = '2026-10-29T00:02:00+05:30';

function event(job: string, status: RunStatus = 'ok', owner: string | null = 'rook', at = firstAt, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

// Inspect table rows, not headings or incidental mentions elsewhere on the page.
function tableRows(html: string): string[] {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? html;
  return [...body.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([row]) => row)
    .filter((row) => /<td\b/i.test(row));
}

function jobRow(html: string, job: string): string {
  const matches = tableRows(html).filter((row) =>
    row.match(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/i)?.[1] === job,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function hasWarning(row: string): boolean {
  return /class=["'][^"']*\bwarn\b[^"']*["']/i.test(row);
}

describe('digest routes', () => {
  let root: string;
  let runsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    runsDir = join(root, 'runs');
    mkdirSync(runsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function app() {
    return createApp({ adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir });
  }

  function log(lines: string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
  }

  async function responses() {
    const server = app();
    const page = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    const digest: NightDigest = await json.json();
    return { html: await page.text(), digest };
  }

  it('serves a valid night as HTML and the complete JSON contract, preserving offsets', async () => {
    log([event('backup', 'retry'), event('backup', 'ok', 'rook', lastAt)]);
    const { html, digest } = await responses();
    expect(digest).toEqual({
      night,
      rows: [{ job: 'backup', owner: 'rook', runs: 2, retries: 1, lastStatus: 'ok',
        lastError: null, firstAt, lastAt, hasFailure: false }],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 0 },
    });
    const row = jobRow(html, 'backup');
    for (const value of ['rook', firstAt, lastAt, 'ok']) expect(row).toContain(value);
    expect(html).toContain(night);
    expect(html).not.toMatch(/<script\b/i);
  });

  it('returns 404 for a missing night on both routes', async () => {
    for (const prefix of ['/digest/', '/api/digest/']) {
      expect((await app().request(`${prefix}${night}`)).status).toBe(404);
    }
  });

  it('renders an empty existing night as nothing ran', async () => {
    log([]);
    const { html, digest } = await responses();
    expect(html.toLowerCase()).toContain('nothing ran');
    expect(tableRows(html)).toHaveLength(0);
    expect(digest).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed lines without losing valid jobs or null owners', async () => {
    log([event('owned'), '{broken json', event('unowned', 'ok', null), '{"job":"incomplete"}']);
    const { html, digest } = await responses();
    expect(digest.badLines).toBe(2);
    expect(digest.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest.rows.map((row) => row.job)).toEqual(['owned', 'unowned']);
    expect(digest.rows.find((row) => row.job === 'unowned')?.owner).toBeNull();
    expect(jobRow(html, 'unowned')).toContain('—');
    expect(jobRow(html, 'owned')).toContain('rook');
  });

  it('sorts page and JSON jobs identically regardless of log order', async () => {
    log([event('zebra-job'), event('alpha-job'), event('middle-job')]);
    const { html, digest } = await responses();
    const jobs = digest.rows.map((row) => row.job);
    expect(jobs).toEqual(['alpha-job', 'middle-job', 'zebra-job']);
    const rows = tableRows(html);
    expect(rows).toHaveLength(jobs.length);
    jobs.forEach((job, index) => expect(rows[index]).toContain(job));
  });

  it('warns at three retries and for any failure, even after recovery, but not at two retries', async () => {
    log([
      event('below', 'retry'), event('below', 'retry'), event('below'),
      event('threshold', 'retry'), event('threshold', 'retry'), event('threshold', 'retry'), event('threshold'),
      event('recovered', 'fail', 'rook', firstAt, 'temporary failure'), event('recovered', 'ok', 'rook', lastAt),
      event('failed', 'fail', 'rook', firstAt, 'still failed'),
    ]);
    const { html, digest } = await responses();
    expect(hasWarning(jobRow(html, 'below'))).toBe(false);
    for (const job of ['threshold', 'recovered', 'failed']) expect(hasWarning(jobRow(html, job))).toBe(true);
    expect(digest.rows.find((row) => row.job === 'threshold')?.retries).toBe(3);
    expect(digest.rows.find((row) => row.job === 'recovered')).toMatchObject({ lastStatus: 'ok', hasFailure: true });
    expect(digest.counts).toEqual({ ok: 3, retry: 5, fail: 2 });
  });

  it('escapes job, owner and error text in HTML while retaining original JSON values', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="owner">';
    const error = '<svg onload="error"> & failed';
    log([event(job, 'fail', owner, firstAt, error)]);
    const { html, digest } = await responses();
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });
    for (const raw of [job, owner, error]) expect(html).not.toContain(raw);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;svg');
    expect(html).toContain('&amp; failed');
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
  });

  it('rejects unsafe paths and invalid date shapes without exposing files outside runsDir', async () => {
    const secret = 'OUTSIDE-RUNS-SENTINEL';
    writeFileSync(join(root, 'outside.jsonl'), event(secret));
    // Existing invalid filenames ensure validation, rather than absence, blocks reads.
    for (const invalid of ['2026-1-28', 'not-a-night', '2026-10-28-extra']) {
      writeFileSync(join(runsDir, `${invalid}.jsonl`), event(secret));
    }
    const unsafe = ['2026-1-28', 'not-a-night', '2026-10-28-extra', '..%2Foutside',
      '%2e%2e%2foutside', '..%5Coutside', '%252e%252e%252foutside', '2026-10-28%00'];
    for (const prefix of ['/digest/', '/api/digest/']) {
      for (const input of unsafe) {
        const response = await app().request(`${prefix}${input}`);
        expect([400, 404], `${prefix}${input}`).toContain(response.status);
        expect(await response.text()).not.toContain(secret);
      }
    }
  });
});
