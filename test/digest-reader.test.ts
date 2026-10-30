import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = (overrides: Record<string, unknown> = {}) => ({
  at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides,
});

// Only read the real sample. All generated fixtures stay in disposable directories.
describe('readNight sample', () => {
  it('reads five sorted jobs and counts one bad line without changing the sample', () => {
    expect(readNight(resolve('runs'), night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null, hasFailure: false,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503', hasFailure: false,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held', hasFailure: false,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded', hasFailure: true,
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null, hasFailure: false,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });
});

describe('readNight fixtures', () => {
  let root: string;
  let runsDir: string;
  const writeLines = (lines: unknown[]) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  };

  beforeEach(() => {
    root = mkdtempSync(resolve('.digest-test-'));
    runsDir = join(root, 'runs');
    mkdirSync(runsDir);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns null for a missing file or directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(root, 'missing'), night)).toBeNull();
  });

  it.each(['', '\n\r\n \t\n'])('returns an empty digest for an empty or blank-only file (%j)', (contents) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and invalid shapes, ignores blanks, and keeps valid rows', () => {
    const invalid: unknown[] = [
      null, [], 'text', 42, true, {},
      event({ at: null }), event({ job: null }), event({ job: '' }), event({ job: ' \t' }),
      event({ status: 'unknown' }), event({ status: { toString: 'ok' } }),
      event({ owner: 42 }), event({ error: null }), event({ error: 42 }),
      { at: event().at, job: 'missing-owner', status: 'ok' },
      { job: 'missing-time', status: 'ok', owner: null },
      { at: event().at, job: 'missing-status', owner: null },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      '', ' \t', '{broken', ...invalid.map((line) => JSON.stringify(line)),
      JSON.stringify(event({ owner: null, extra: { allowed: true } })), '',
    ].join('\r\n'));
    const result = readNight(runsDir, night);
    expect(result?.badLines).toBe(invalid.length + 1);
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({ job: 'job', owner: null, lastError: null });
  });

  it.each([
    '', 'not-a-date', '2026-10-28', '2026-10-28T23:00:00',
    '2026-02-29T23:00:00Z', '2026-02-30T23:00:00Z', '2026-04-31T23:00:00Z',
    '2026-13-01T23:00:00Z', '2026-10-00T23:00:00Z',
    '2026-10-28T24:00:00Z', '2026-10-28T23:60:00Z', '2026-10-28T23:00:60Z',
    '2026-10-28T23:00:00+24:00', '2026-10-28T23:00:00+01:60',
    '2026-10-28T23:00:00Zjunk',
  ])('counts invalid timestamp %j as a bad line', (at) => {
    writeLines([event({ at })]);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 1, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('uses chronological instants, not input order or lexical local times; retains recovery history', () => {
    const firstAt = '2026-10-29T01:30:00+02:00';
    const lastAt = '2026-10-29T00:10:00Z';
    writeLines([
      event({ at: lastAt, status: 'ok', owner: null }),
      event({ at: '2026-10-28T19:45:00-04:00', status: 'retry', owner: 'middle', error: 'last error' }),
      event({ at: firstAt, status: 'fail', error: 'first error' }),
      event({ at: '2026-10-29T00:00:00.123+00:00', status: 'retry' }),
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 2, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok',
        lastError: 'last error', firstAt, lastAt, hasFailure: true,
      }],
    });
  });

  it('keeps the most recent error even when it is an empty string', () => {
    writeLines([
      event({ at: '2026-10-28T23:00:00Z', error: 'old' }),
      event({ at: '2026-10-28T23:01:00Z', error: '' }),
      event({ at: '2026-10-28T23:02:00Z' }),
    ]);
    expect(readNight(runsDir, night)?.rows[0].lastError).toBe('');
  });

  it('sorts jobs by deterministic code-point order and handles prototype-like names', () => {
    writeLines(['z', 'a', '__proto__', 'A', 'constructor'].map((job) => event({ job })));
    expect(readNight(runsDir, night)?.rows.map((row) => row.job)).toEqual([
      'A', '__proto__', 'a', 'constructor', 'z',
    ]);
  });

  it('breaks timestamp ties by literal at/status/owner/error, independent of file order', () => {
    const events = [
      event({ at: '2026-10-28T23:00:00Z', status: 'ok', owner: 'z' }),
      event({ at: '2026-10-29T00:00:00+01:00', status: 'retry', error: 'tie error' }),
      event({ at: '2026-10-28T23:00:00Z', status: 'fail', owner: 'a', error: 'failure' }),
    ];
    writeLines(events);
    const original = readNight(runsDir, night);
    writeLines([...events].reverse());
    expect(readNight(runsDir, night)).toEqual(original);
    expect(original?.rows[0]).toMatchObject({
      firstAt: '2026-10-28T23:00:00Z', lastAt: '2026-10-29T00:00:00+01:00',
      lastStatus: 'retry', lastError: 'tie error', hasFailure: true,
    });
  });

  it('orders fractional seconds beyond millisecond precision', () => {
    writeLines([
      event({ at: '2026-10-28T23:00:00.1239Z', owner: 'last' }),
      event({ at: '2026-10-29T00:00:00.12311+01:00', owner: 'first' }),
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({
      firstAt: '2026-10-29T00:00:00.12311+01:00',
      lastAt: '2026-10-28T23:00:00.1239Z', owner: 'last',
    });
  });

  it.each([
    '../2026-10-28', '../../2026-10-28', '/2026-10-28', '..\\2026-10-28',
    '2026-10-28/../2026-10-28', '%2e%2e%2f2026-10-28',
    '2026-10-28.jsonl', '2026-10-28\0', '2026-10-28\n', ' 2026-10-28',
    '2026-1-28', '2026-13-01', '2026-00-01', '2026-10-00',
    '2026-02-29', '1900-02-29', '2026-04-31', '',
  ])('rejects unsafe or invalid night %j without opening a file', (unsafeNight) => {
    // A valid file exists outside runsDir, so traversal must not consume it.
    writeFileSync(join(root, `${night}.jsonl`), JSON.stringify(event()));
    // ENOTDIR would be thrown if the reader attempted to open anything here.
    const notDirectory = join(root, 'not-a-directory');
    writeFileSync(notDirectory, 'not a directory');
    expect(readNight(runsDir, unsafeNight)).toBeNull();
    expect(readNight(notDirectory, unsafeNight)).toBeNull();
  });

  it.each(['2024-02-29', '2000-02-29'])('accepts valid leap-day night %s', (leapNight) => {
    writeFileSync(join(runsDir, `${leapNight}.jsonl`), JSON.stringify(event({ at: `${leapNight}T00:00:00Z` })));
    expect(readNight(runsDir, leapNight)?.badLines).toBe(0);
    expect(readNight(runsDir, leapNight)?.rows).toHaveLength(1);
  });

  it('does not swallow non-ENOENT errors', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    const notDirectory = join(root, 'not-a-directory');
    writeFileSync(notDirectory, 'not a directory');
    expect(() => readNight(notDirectory, night)).toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
  });

  it('refuses to follow a date-named symlink outside runsDir', () => {
    const outside = join(root, 'outside.jsonl');
    writeFileSync(outside, JSON.stringify(event()));
    symlinkSync(outside, join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow(expect.objectContaining({ code: 'ELOOP' }));
  });
});
