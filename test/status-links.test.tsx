import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

let runsDir: string;
const config = () => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-status-links-'));
});
afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function event(status: 'ok' | 'retry' | 'fail'): string {
  return JSON.stringify({ at: '2026-10-28T23:15:00+02:00', job: 'same-job', owner: null, status });
}

describe('status digest links', () => {
  it('links every night newest first and counts valid events, not jobs', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'),
      [event('ok'), event('retry'), 'not json', event('retry'), event('fail'), event('ok')].join('\n'));
    writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
    writeFileSync(join(runsDir, 'notes.txt'), 'ignored');

    const status = readStatus(config());
    expect(status.nights).toEqual(['2026-10-29', '2026-10-28']);
    expect(status.nightSummaries).toEqual({
      '2026-10-29': { total: 0, ok: 0, retry: 0, fail: 0 },
      '2026-10-28': { total: 5, ok: 2, retry: 2, fail: 1 },
    });
    const response = await createApp(config()).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-29"');
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html.indexOf('/digest/2026-10-29')).toBeLessThan(html.indexOf('/digest/2026-10-28'));
    expect(html).toContain('total 5 · ok 2 / retry 2 / fail 1');
    expect(html).toContain('total 0 · ok 0 / retry 0 / fail 0');
    expect(html).not.toContain('notes.txt');
    expect(html).toContain('2026-10-29T14:06:00+01:00');
  });

  it('keeps the empty-board message', async () => {
    const response = await createApp(config()).request('/');
    expect(await response.text()).toContain('nothing in runs/');
  });

  it('supports legacy status objects and escapes their displayed data', () => {
    const html = StatusBoard({ status: {
      adapter: '<script>bad()</script>', installed: '—', lastBeat: null,
      nights: ['2026-10-28'],
    } }).toString();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('total — · ok — / retry — / fail —');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
