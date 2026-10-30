import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { NightDigest } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightSummary = NightDigest['counts'] & { total: number };

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightSummaries?: Record<string, NightSummary | null>;
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  const nights = nightsOnDisk(config.runsDir);
  const nightSummaries: Record<string, NightSummary | null> = {};
  for (const night of nights) {
    const digest = readNight(config.runsDir, night);
    nightSummaries[night] = digest
      ? { ...digest.counts, total: digest.counts.ok + digest.counts.retry + digest.counts.fail }
      : null;
  }

  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    nightSummaries,
  };
}
