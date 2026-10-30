import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RigConfig } from '../src/config.js';
import type { ReadNight, NightDigest } from '../src/digest/types.js';
import { registerDigestJson } from '../src/digest/json-route.js';

const { readNight } = vi.hoisted(() => ({ readNight: vi.fn<ReadNight>() }));
vi.mock('../src/digest/reader.js', () => ({ readNight }));

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '/unused/mock-runs',
};

function app(): Hono {
  const instance = new Hono();
  registerDigestJson(instance, config);
  return instance;
}

describe('digest JSON route', () => {
  beforeEach(() => readNight.mockReset());

  it('returns the complete reader result without reordering or changing offsets', async () => {
    const row = {
      job: 'z-job', owner: null, runs: 4, retries: 3,
      lastStatus: 'fail', lastError: '<failed>', hasFailure: true,
      firstAt: '2026-10-28T01:00:00+02:00', lastAt: '2026-10-28T02:00:00+02:00',
    } satisfies NightDigest['rows'][number];
    const digest: NightDigest = {
      night: '2026-10-28', rows: [row, { ...row, job: 'a-job' }],
      badLines: 1, counts: { ok: 0, retry: 6, fail: 2 },
    };
    readNight.mockReturnValue(digest);

    const res = await app().request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledExactlyOnceWith(config.runsDir, '2026-10-28');
  });

  it('returns JSON 404 when the reader reports a missing file', async () => {
    readNight.mockReturnValue(null);
    const res = await app().request('/api/digest/2026-10-27');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Night not found' });
  });

  it('returns an empty digest unchanged', async () => {
    const digest: NightDigest = {
      night: '2026-10-29', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    };
    readNight.mockReturnValue(digest);
    const res = await app().request('/api/digest/2026-10-29');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(digest);
  });

  it.each(['not-a-night', '2026-1-28', '2026-10-28.jsonl', '..%2Fsecret', '%2Fetc%2Fpasswd', '2026-10-28%00'])(
    'rejects invalid or unsafe night %s without reading',
    async (night) => {
      const res = await app().request(`/api/digest/${night}`);
      expect([400, 404]).toContain(res.status);
      expect(readNight).not.toHaveBeenCalled();
    },
  );
});
