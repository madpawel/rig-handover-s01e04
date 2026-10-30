export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
  hasFailure: boolean;
};

export type NightDigest = {
  night: string;
  rows: DigestRow[];
  badLines: number;
  /** Total valid log events by status, not final job statuses. */
  counts: { ok: number; retry: number; fail: number };
};

/** Implemented as readNight in ./reader; null denotes a missing night. */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
