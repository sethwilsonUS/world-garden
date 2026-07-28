import { ConvexHttpClient } from "convex/browser";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

type ConvexRequestTimeoutOptions = {
  timeoutMs: number;
  message: string;
};

const createAbortableClient = (signal: AbortSignal): ConvexHttpClient => {
  const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!deploymentUrl) {
    throw new Error("Environment variable NEXT_PUBLIC_CONVEX_URL is not set.");
  }

  return new ConvexHttpClient(deploymentUrl, {
    fetch: (input, init) =>
      globalThis.fetch(input, {
        ...init,
        cache: "no-store",
        signal,
      }),
  });
};

const runAbortableConvexRequest = async <T>(
  operation: (client: ConvexHttpClient) => Promise<T>,
  { timeoutMs, message }: ConvexRequestTimeoutOptions,
): Promise<T> => {
  const controller = new AbortController();
  const request = Promise.resolve().then(() =>
    operation(createAbortableClient(controller.signal)),
  );

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await request;
  }

  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      const timeoutError = new Error(message);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (didTimeout) throw new Error(message);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const fetchConvexMutationWithTimeout = async <
  Mutation extends FunctionReference<"mutation">,
>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
  options: ConvexRequestTimeoutOptions,
): Promise<FunctionReturnType<Mutation>> =>
  await runAbortableConvexRequest(
    (client) => client.mutation(mutation, args),
    options,
  );

export const fetchConvexQueryWithTimeout = async <
  Query extends FunctionReference<"query">,
>(
  query: Query,
  args: FunctionArgs<Query>,
  options: ConvexRequestTimeoutOptions,
): Promise<FunctionReturnType<Query>> =>
  await runAbortableConvexRequest(
    (client) => client.query(query, args),
    options,
  );
