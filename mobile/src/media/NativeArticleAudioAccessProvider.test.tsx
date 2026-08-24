import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import { useNativeAuthTransportBinding } from "../auth/NativeAuthTransportBindingContext";
import {
  useNativeArticleAudioAccess,
  type NativeArticleAudioSectionRequest,
} from "./NativeArticleAudioAccessContext";
import {
  isNativeArticleAudioSectionRequest,
  NativeArticleAudioAccessProvider,
} from "./NativeArticleAudioAccessProvider";

jest.mock("../auth/NativeAuthTransportBindingContext", () => ({
  useNativeAuthTransportBinding: jest.fn(),
}));

const useTransportBindingMock = jest.mocked(useNativeAuthTransportBinding);
const fetchMock = jest.fn<
  Promise<Response>,
  [RequestInfo | URL, RequestInit?]
>();
const accountEpoch = Symbol("account-a");
const request: NativeArticleAudioSectionRequest = Object.freeze({
  narrationVersion: 2,
  provider: "openai",
  revisionId: "1234",
  sectionKey: "section-0",
  slug: "Ada_Lovelace",
});

const response = (
  status: number,
  contentType = status === 200 ? "audio/mpeg" : "application/json",
): Response =>
  new Response(null, {
    headers: { "Content-Type": contentType },
    status,
  });

function binding(
  resolveRequestCredentials: jest.Mock = jest.fn().mockResolvedValue({
    accountEpoch,
    status: "public",
  }),
): ReturnType<typeof useNativeAuthTransportBinding> {
  return {
    accountEpoch,
    isCurrentAccountEpoch: jest.fn((epoch: symbol) => epoch === accountEpoch),
    resolveRequestCredentials,
  };
}

function wrapper({ children }: PropsWithChildren) {
  return (
    <NativeArticleAudioAccessProvider
      fetchImpl={fetchMock}
      webOrigin="https://curiogarden.org"
    >
      {children}
    </NativeArticleAudioAccessProvider>
  );
}

function httpWrapper({ children }: PropsWithChildren) {
  return (
    <NativeArticleAudioAccessProvider
      fetchImpl={fetchMock}
      webOrigin="http://127.0.0.1:3000"
    >
      {children}
    </NativeArticleAudioAccessProvider>
  );
}

function requestInit(callIndex = 0): RequestInit {
  return fetchMock.mock.calls[callIndex]?.[1] ?? {};
}

function requestBody(callIndex = 0): Record<string, unknown> {
  const body = requestInit(callIndex).body;
  if (typeof body !== "string") throw new Error("Expected a JSON body");
  return JSON.parse(body) as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  useTransportBindingMock.mockReturnValue(binding());
});

describe("NativeArticleAudioAccessProvider", () => {
  it("fails clearly when the hook escapes its provider", async () => {
    await expect(
      renderHook(() => useNativeArticleAudioAccess()),
    ).rejects.toThrow(
      "useNativeArticleAudioAccess() must be used within NativeArticleAudioAccessProvider",
    );
  });

  it("sends a revision-aware public request without credentials and forces Edge", async () => {
    fetchMock.mockResolvedValue(response(200));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection(request);

    expect(result.current.accountEpoch).toBe(accountEpoch);
    expect(result.current).not.toHaveProperty("sessionToken");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://curiogarden.org/api/article/audio/section",
      expect.objectContaining({
        credentials: "omit",
        method: "POST",
        redirect: "error",
      }),
    );
    expect(requestInit().headers).toEqual({
      Accept: "audio/mpeg",
      "Accept-Encoding": "identity",
      "Content-Type": "application/json",
    });
    expect(requestBody()).toEqual({
      narrationVersion: 2,
      provider: "edge",
      revisionId: "1234",
      sectionKey: "section-0",
      slug: "Ada_Lovelace",
    });
    expect(requestBody()).not.toHaveProperty("accountEpoch");
    expect(accountEpoch.description).toBe("account-a");
    expect(JSON.stringify(requestBody())).not.toContain("account-a");
    expect(audioResult).toEqual({
      accountEpoch,
      release: expect.any(Function),
      response: expect.anything(),
      status: "ready",
    });
    if (audioResult.status === "ready") audioResult.release();
  });

  it("keeps native response cancellation owned after headers arrive", async () => {
    const caller = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation(async (_input, init) => {
      fetchSignal = init?.signal;
      return response(200);
    });
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection({
      ...request,
      signal: caller.signal,
    });

    expect(audioResult).toEqual(
      expect.objectContaining({
        release: expect.any(Function),
        status: "ready",
      }),
    );
    expect(fetchSignal?.aborted).toBe(false);

    caller.abort();
    expect(fetchSignal?.aborted).toBe(true);

    const release = (audioResult as { release: () => void }).release;
    expect(() => {
      release();
      release();
    }).not.toThrow();
  });

  it("keeps the 240-second transport deadline alive through body ownership", async () => {
    jest.useFakeTimers();
    try {
      let fetchSignal: AbortSignal | null | undefined;
      fetchMock.mockImplementation(async (_input, init) => {
        fetchSignal = init?.signal;
        return response(200);
      });
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      const audioResult = await result.current.requestSection(request);
      expect(audioResult.status).toBe("ready");
      expect(fetchSignal?.aborted).toBe(false);

      await jest.advanceTimersByTimeAsync(239_999);
      expect(fetchSignal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchSignal?.aborted).toBe(true);

      if (audioResult.status === "ready") audioResult.release();
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps a Clerk token only in the authenticated request header", async () => {
    const resolveRequestCredentials = jest.fn().mockResolvedValue({
      accountEpoch,
      sessionToken: "secret-clerk-token",
      status: "authenticated",
    });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    fetchMock.mockResolvedValue(response(200));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection(request);

    expect(requestInit().headers).toEqual({
      Accept: "audio/mpeg",
      "Accept-Encoding": "identity",
      Authorization: "Bearer secret-clerk-token",
      "Content-Type": "application/json",
    });
    expect(requestBody().provider).toBe("openai");
    expect(JSON.stringify(requestBody())).not.toContain("secret-clerk-token");
    expect(JSON.stringify(audioResult)).not.toContain("secret-clerk-token");
    if (audioResult.status === "ready") audioResult.release();
  });

  it("keeps local HTTP transport public and Edge-only", async () => {
    fetchMock.mockResolvedValue(response(200));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper: httpWrapper,
    });

    const audioResult = await result.current.requestSection(request);
    expect(audioResult).toEqual({
      accountEpoch,
      release: expect.any(Function),
      response: expect.anything(),
      status: "ready",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/article/audio/section",
      expect.anything(),
    );
    expect(requestInit().headers).not.toHaveProperty("Authorization");
    expect(requestBody().provider).toBe("edge");
    if (audioResult.status === "ready") audioResult.release();
  });

  it("never sends an authenticated Bearer credential to local HTTP", async () => {
    useTransportBindingMock.mockReturnValue(
      binding(
        jest.fn().mockResolvedValue({
          accountEpoch,
          sessionToken: "secret-clerk-token",
          status: "authenticated",
        }),
      ),
    );
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper: httpWrapper,
    });

    await expect(result.current.requestSection(request)).resolves.toEqual({
      reason: "authentication-rejected",
      retryable: false,
      status: "failed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes credentials once after a 401 in the same account epoch", async () => {
    const resolveRequestCredentials = jest
      .fn()
      .mockResolvedValueOnce({
        accountEpoch,
        sessionToken: "expired-token",
        status: "authenticated",
      })
      .mockResolvedValueOnce({
        accountEpoch,
        sessionToken: "refreshed-token",
        status: "authenticated",
      });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    fetchMock
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection(request);
    expect(audioResult).toEqual({
      accountEpoch,
      release: expect.any(Function),
      response: expect.anything(),
      status: "ready",
    });

    expect(resolveRequestCredentials).toHaveBeenNthCalledWith(1, {
      forceRefresh: false,
    });
    expect(resolveRequestCredentials).toHaveBeenNthCalledWith(2, {
      forceRefresh: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestInit(0).headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer expired-token" }),
    );
    expect(requestInit(1).headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer refreshed-token" }),
    );
    if (audioResult.status === "ready") audioResult.release();
  });

  it("does not retry a second authentication rejection", async () => {
    const resolveRequestCredentials = jest
      .fn()
      .mockResolvedValueOnce({
        accountEpoch,
        sessionToken: "expired-token",
        status: "authenticated",
      })
      .mockResolvedValueOnce({
        accountEpoch,
        sessionToken: "still-rejected-token",
        status: "authenticated",
      });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    fetchMock.mockResolvedValue(response(401));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(result.current.requestSection(request)).resolves.toEqual({
      reason: "authentication-rejected",
      retryable: false,
      status: "failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never downgrades an authenticated 401 retry to a public request", async () => {
    const resolveRequestCredentials = jest
      .fn()
      .mockResolvedValueOnce({
        accountEpoch,
        sessionToken: "expired-token",
        status: "authenticated",
      })
      .mockResolvedValueOnce({ accountEpoch, status: "public" });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    fetchMock.mockResolvedValue(response(401));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(result.current.requestSection(request)).resolves.toEqual({
      reason: "authentication-rejected",
      retryable: false,
      status: "failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "invalid-request", false],
    [404, "article-not-found", false],
    [409, "article-changed", false],
    [429, "temporarily-unavailable", true],
    [500, "temporarily-unavailable", true],
    [503, "temporarily-unavailable", true],
  ] as const)(
    "maps HTTP %i to a sanitized terminal result without a general retry",
    async (status, reason, retryable) => {
      fetchMock.mockResolvedValue(response(status));
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      await expect(result.current.requestSection(request)).resolves.toEqual({
        reason,
        retryable,
        status: "failed",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an unexpected successful payload without consuming it", async () => {
    fetchMock.mockResolvedValue(response(200, "application/json"));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(result.current.requestSection(request)).resolves.toEqual({
      reason: "invalid-response",
      retryable: false,
      status: "failed",
    });
  });

  it.each(["audio/wav", "audio/mp4", "audio/mpegish"])(
    "rejects a successful non-MP3 payload (%s)",
    async (contentType) => {
      fetchMock.mockResolvedValue(response(200, contentType));
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      await expect(result.current.requestSection(request)).resolves.toEqual({
        reason: "invalid-response",
        retryable: false,
        status: "failed",
      });
    },
  );

  it("sanitizes a network failure and never retries it automatically", async () => {
    fetchMock.mockRejectedValue(
      new Error("secret-clerk-token issuer.example internal host"),
    );
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection(request);

    expect(audioResult).toEqual({
      reason: "temporarily-unavailable",
      retryable: true,
      status: "failed",
    });
    expect(JSON.stringify(audioResult)).not.toMatch(
      /secret-clerk-token|issuer\.example|internal host/u,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a network attempt at the fixed transport deadline", async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("internal timeout")),
              { once: true },
            );
          }),
      );
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      const pendingResult = result.current.requestSection(request);
      await jest.advanceTimersByTimeAsync(240_000);

      await expect(pendingResult).resolves.toEqual({
        reason: "temporarily-unavailable",
        retryable: true,
        status: "failed",
      });
      expect(requestInit().signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores a successful response that arrives after the operation deadline", async () => {
    jest.useFakeTimers();
    try {
      let resolveFetch: ((value: Response) => void) | undefined;
      const cancelBody = jest.fn().mockResolvedValue(undefined);
      const lateResponse = new Response(
        new ReadableStream({ cancel: cancelBody }),
        { headers: { "Content-Type": "audio/mpeg" }, status: 200 },
      );
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      const pendingResult = result.current.requestSection(request);
      await jest.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(240_000);

      await expect(pendingResult).resolves.toEqual({
        reason: "temporarily-unavailable",
        retryable: true,
        status: "failed",
      });
      resolveFetch?.(lateResponse);
      await Promise.resolve();
      await Promise.resolve();
      expect(cancelBody).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("shares one operation deadline across credentials and a 401 refresh", async () => {
    jest.useFakeTimers();
    try {
      const resolveRequestCredentials = jest.fn().mockResolvedValue({
        accountEpoch,
        sessionToken: "private-session-token",
        status: "authenticated",
      });
      useTransportBindingMock.mockReturnValue(
        binding(resolveRequestCredentials),
      );
      fetchMock
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              setTimeout(() => resolve(response(401)), 230_000);
            }),
        )
        .mockImplementationOnce(
          (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new Error("shared deadline")),
                { once: true },
              );
            }),
        );
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      const pendingResult = result.current.requestSection(request);
      await jest.advanceTimersByTimeAsync(230_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(pendingResult).resolves.toEqual({
        reason: "temporarily-unavailable",
        retryable: true,
        status: "failed",
      });
      expect(resolveRequestCredentials).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds credential resolution with the same operation deadline", async () => {
    jest.useFakeTimers();
    try {
      const resolveRequestCredentials = jest.fn(
        () => new Promise<never>(() => undefined),
      );
      useTransportBindingMock.mockReturnValue(
        binding(resolveRequestCredentials),
      );
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      const pendingResult = result.current.requestSection(request);
      await jest.advanceTimersByTimeAsync(240_000);

      await expect(pendingResult).resolves.toEqual({
        reason: "temporarily-unavailable",
        retryable: true,
        status: "failed",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("sanitizes an unexpected private credential resolver failure", async () => {
    const resolveRequestCredentials = jest
      .fn()
      .mockRejectedValue(new Error("secret-token issuer.example"));
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection(request);

    expect(audioResult).toEqual({
      reason: "account-unavailable",
      retryable: true,
      status: "failed",
    });
    expect(JSON.stringify(audioResult)).not.toMatch(
      /secret-token|issuer\.example/u,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers caller cancellation when credential resolution rejects", async () => {
    const controller = new AbortController();
    const resolveRequestCredentials = jest.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error("private credential failure");
    });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(
      result.current.requestSection({ ...request, signal: controller.signal }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefers caller cancellation when credentials resolve unavailable", async () => {
    const controller = new AbortController();
    const resolveRequestCredentials = jest.fn().mockImplementation(async () => {
      controller.abort();
      return { status: "unavailable" } as const;
    });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(
      result.current.requestSection({ ...request, signal: controller.signal }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns cancelled for a caller abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(
      result.current.requestSection({ ...request, signal: controller.signal }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not refresh or expose a response when the caller aborts in flight", async () => {
    const controller = new AbortController();
    const resolveRequestCredentials = jest.fn().mockResolvedValue({
      accountEpoch,
      sessionToken: "private-session-token",
      status: "authenticated",
    });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return response(401);
    });
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(
      result.current.requestSection({ ...request, signal: controller.signal }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(resolveRequestCredentials).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supersedes a request when the account changes while credentials resolve", async () => {
    let resolveCredentials:
      | ((value: {
          accountEpoch: symbol;
          sessionToken: string;
          status: "authenticated";
        }) => void)
      | undefined;
    const resolveRequestCredentials = jest.fn(
      () =>
        new Promise<{
          accountEpoch: symbol;
          sessionToken: string;
          status: "authenticated";
        }>((resolve) => {
          resolveCredentials = resolve;
        }),
    );
    const privateBinding = binding(resolveRequestCredentials);
    useTransportBindingMock.mockReturnValue(privateBinding);
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });
    const pending = result.current.requestSection(request);

    (
      privateBinding.isCurrentAccountEpoch as jest.MockedFunction<
        typeof privateBinding.isCurrentAccountEpoch
      >
    ).mockReturnValue(false);
    resolveCredentials?.({
      accountEpoch,
      sessionToken: "stale-token",
      status: "authenticated",
    });

    await expect(pending).resolves.toEqual({ status: "superseded" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["superseded", "unavailable"] as const)(
    "does not issue a request for %s credentials",
    async (status) => {
      useTransportBindingMock.mockReturnValue(
        binding(jest.fn().mockResolvedValue({ status })),
      );
      const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      await expect(result.current.requestSection(request)).resolves.toEqual(
        status === "superseded"
          ? { status: "superseded" }
          : {
              reason: "account-unavailable",
              retryable: true,
              status: "failed",
            },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed caller input before credentials or transport", async () => {
    const resolveRequestCredentials = jest.fn();
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    const { result } = await renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(
      result.current.requestSection({ ...request, revisionId: "001234" }),
    ).resolves.toEqual({
      reason: "invalid-request",
      retryable: false,
      status: "failed",
    });
    expect(resolveRequestCredentials).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a null request", null],
    ["a whitespace-only slug", { ...request, slug: "   " }],
    ["an oversized slug", { ...request, slug: "a".repeat(501) }],
    ["a numeric section key", { ...request, sectionKey: 0 }],
    ["a noncanonical revision", { ...request, revisionId: "001234" }],
    ["an oversized revision", { ...request, revisionId: "9".repeat(21) }],
    ["an invalid abort signal", { ...request, signal: "later" }],
  ])("rejects %s at the unknown-input validator seam", (_label, malformed) => {
    expect(isNativeArticleAudioSectionRequest(malformed)).toBe(false);
  });
});
