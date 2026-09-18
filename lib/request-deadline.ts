/** Bound a request and propagate cancellation to its network operations. */
export const createRequestDeadline = (
  timeoutMs: number,
  message: string,
  parentSignal?: AbortSignal,
) => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const expire = () => controller.abort(new Error(message));
  const timer = setTimeout(expire, Math.max(0, timeoutMs));
  if (timeoutMs <= 0) expire();

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
};

/** Also stop waiting for dependencies that do not honor cancellation themselves. */
export const runWithAbortSignal = async <T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> => {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};
