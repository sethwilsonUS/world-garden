import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import { useNativeAuthTransportBinding } from "../auth/NativeAuthTransportBindingContext";
import {
  useNativeArticleAudioAccess,
  type NativeArticleAudioSectionRequest,
} from "./NativeArticleAudioAccessContext";
import { NativeArticleAudioAccessProvider } from "./NativeArticleAudioAccessProvider";

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
  ({
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    ok: status >= 200 && status < 300,
    status,
  }) as Response;

function binding(
  resolveRequestCredentials: jest.Mock = jest.fn().mockResolvedValue({
    accountEpoch,
    status: "public",
  }),
) {
  return {
    accountEpoch,
    isCurrentAccountEpoch: jest.fn((epoch: symbol) => epoch === accountEpoch),
    resolveRequestCredentials,
  } as unknown as ReturnType<typeof useNativeAuthTransportBinding>;
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
  it("fails clearly when the hook escapes its provider", () => {
    expect(() => renderHook(() => useNativeArticleAudioAccess())).toThrow(
      "useNativeArticleAudioAccess() must be used within NativeArticleAudioAccessProvider",
    );
  });

  it("sends a revision-aware public request without credentials and forces Edge", async () => {
    fetchMock.mockResolvedValue(response(200));
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
      Accept: "audio/mpeg, audio/*;q=0.9",
      "Content-Type": "application/json",
    });
    expect(requestBody()).toEqual({
      narrationVersion: 2,
      provider: "edge",
      revisionId: "1234",
      sectionKey: "section-0",
      slug: "Ada_Lovelace",
    });
    expect(JSON.stringify(requestBody())).not.toContain("user-a");
    expect(audioResult).toEqual({
      accountEpoch,
      response: expect.anything(),
      status: "ready",
    });
  });

  it("keeps a Clerk token only in the authenticated request header", async () => {
    const resolveRequestCredentials = jest.fn().mockResolvedValue({
      accountEpoch,
      sessionToken: "secret-clerk-token",
      status: "authenticated",
    });
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    fetchMock.mockResolvedValue(response(200));
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    const audioResult = await result.current.requestSection(request);

    expect(requestInit().headers).toEqual({
      Accept: "audio/mpeg, audio/*;q=0.9",
      Authorization: "Bearer secret-clerk-token",
      "Content-Type": "application/json",
    });
    expect(requestBody().provider).toBe("openai");
    expect(JSON.stringify(requestBody())).not.toContain("secret-clerk-token");
    expect(JSON.stringify(audioResult)).not.toContain("secret-clerk-token");
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(result.current.requestSection(request)).resolves.toEqual({
      accountEpoch,
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
      const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(result.current.requestSection(request)).resolves.toEqual({
      reason: "invalid-response",
      retryable: false,
      status: "failed",
    });
  });

  it("sanitizes a network failure and never retries it automatically", async () => {
    fetchMock.mockRejectedValue(
      new Error("secret-clerk-token issuer.example internal host"),
    );
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
      const { result } = renderHook(() => useNativeArticleAudioAccess(), {
        wrapper,
      });

      const pendingResult = result.current.requestSection(request);
      await jest.advanceTimersByTimeAsync(180_000);

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

  it("sanitizes an unexpected private credential resolver failure", async () => {
    const resolveRequestCredentials = jest
      .fn()
      .mockRejectedValue(new Error("secret-token issuer.example"));
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
      const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
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
    ["a numeric section key", { ...request, sectionKey: 0 }],
    ["a noncanonical revision", { ...request, revisionId: "001234" }],
    ["an oversized revision", { ...request, revisionId: "9".repeat(21) }],
    ["an invalid abort signal", { ...request, signal: "later" }],
  ])("sanitizes %s at the runtime boundary", async (_label, malformed) => {
    const resolveRequestCredentials = jest.fn();
    useTransportBindingMock.mockReturnValue(binding(resolveRequestCredentials));
    const { result } = renderHook(() => useNativeArticleAudioAccess(), {
      wrapper,
    });

    await expect(
      result.current.requestSection(
        malformed as unknown as NativeArticleAudioSectionRequest,
      ),
    ).resolves.toEqual({
      reason: "invalid-request",
      retryable: false,
      status: "failed",
    });
    expect(resolveRequestCredentials).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
