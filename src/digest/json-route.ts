import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

export function registerDigestJson(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) {
      return c.json({ error: 'Invalid night; expected YYYY-MM-DD' }, 400);
    }

    const digest = readNight(config.runsDir, night);
    if (digest === null) {
      return c.json({ error: 'Night not found' }, 404);
    }

    return c.json(digest);
  });
}
