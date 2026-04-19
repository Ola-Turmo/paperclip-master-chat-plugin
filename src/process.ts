type TimeoutManagedChildProcess = {
  kill(signal?: NodeJS.Signals | number): boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

export function armProcessTimeout(
  child: TimeoutManagedChildProcess,
  timeoutMs: number,
  onTimeout: () => void,
  killDelayMs = 1_000,
): () => void {
  let killTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, killDelayMs);
    onTimeout();
  }, timeoutMs);

  return () => {
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
  };
}
