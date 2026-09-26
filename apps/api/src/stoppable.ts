/** Handle returned by background-job starters: stop scheduling and await in-flight work. */
export interface StopHandle {
  stop: () => Promise<void>;
}

/** Upper bound for waiting on in-flight work during shutdown. */
export const STOP_TIMEOUT_MS = 5_000;

/**
 * Await a promise with an upper bound so shutdown can never hang.
 * Resolves on success, rejection, or timeout; never rejects itself.
 */
export function raceStop(
  work: Promise<unknown>,
  timeoutMs = STOP_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref();
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/**
 * Tracks promises for work already started (not just scheduled) so
 * stop() can wait for the in-flight run without serializing ticks.
 */
export interface ActiveRuns {
  track(run: Promise<unknown>): void;
  /** Bounded wait for every run tracked so far. */
  waitAll(timeoutMs?: number): Promise<void>;
}

export function createActiveRuns(): ActiveRuns {
  const runs = new Set<Promise<unknown>>();
  return {
    track(run: Promise<unknown>): void {
      runs.add(run);
      const settle = (): void => {
        runs.delete(run);
      };
      void run.then(settle, settle);
    },
    waitAll(timeoutMs?: number): Promise<void> {
      return raceStop(Promise.all([...runs]), timeoutMs);
    },
  };
}
