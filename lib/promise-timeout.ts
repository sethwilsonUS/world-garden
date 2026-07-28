type PromiseTimeoutOptions = {
  timeoutMs: number;
  message: string;
};

export const withPromiseTimeout = async <T>(
  operation: Promise<T>,
  { timeoutMs, message }: PromiseTimeoutOptions,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await operation;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};
