import {
  createNativeArticleAudioEphemeralStore,
  MAX_NATIVE_ARTICLE_AUDIO_BYTES,
  type NativeArticleAudioEphemeralBackend,
  type NativeArticleAudioEphemeralBackendFile,
} from "./NativeArticleAudioEphemeralStore";

type FakeFile = NativeArticleAudioEphemeralBackendFile & {
  readonly bytes: number[];
  readonly deleteMock: jest.Mock<void, []>;
};

function fakeFile(uri = "file:///private-cache/random-id.mp3"): FakeFile {
  const bytes: number[] = [];
  const deleteMock = jest.fn<void, []>();

  return {
    bytes,
    delete: deleteMock,
    deleteMock,
    get size() {
      return bytes.length;
    },
    uri,
    writableStream: () =>
      new WritableStream<Uint8Array>({
        write(chunk) {
          bytes.push(...chunk);
        },
      }),
  };
}

function fakeBackend(file = fakeFile()) {
  const staleFile = { delete: jest.fn<void, []>() };
  const staleDirectory = { delete: jest.fn<void, []>() };
  const backend: NativeArticleAudioEphemeralBackend = {
    createAudioFile: jest.fn(() => file),
    ensureDirectory: jest.fn(),
    listEntries: jest.fn(() => [staleFile, staleDirectory]),
  };

  return { backend, file, staleDirectory, staleFile };
}

function audioResponse(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    headers: {
      "content-length":
        body instanceof Uint8Array ? String(body.byteLength) : "4",
      "content-type": "audio/mpeg",
      ...headers,
    },
    status: 200,
  });
}

describe("NativeArticleAudioEphemeralStore", () => {
  it("scavenges only its dedicated cache boundary before a new activation", async () => {
    const { backend, staleDirectory, staleFile } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "ready",
    });
    expect(backend.ensureDirectory).toHaveBeenCalledTimes(1);
    expect(backend.listEntries).toHaveBeenCalledTimes(1);
    expect(staleFile.delete).toHaveBeenCalledTimes(1);
    expect(staleDirectory.delete).toHaveBeenCalledTimes(1);
  });

  it("continues preparing and staging after bounded retries cannot delete one stale entry", async () => {
    const { backend, file, staleDirectory, staleFile } = fakeBackend();
    staleFile.delete.mockImplementation(() => {
      throw new Error("stale file remains locked");
    });
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "ready",
    });
    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "ready",
    });
    const staged = await store.stage(
      audioResponse(new Uint8Array([1, 2, 3, 4])),
      new AbortController().signal,
    );

    expect(backend.listEntries).toHaveBeenCalledTimes(1);
    expect(staleFile.delete).toHaveBeenCalledTimes(3);
    expect(staleDirectory.delete).toHaveBeenCalledTimes(1);
    expect(staged.status).toBe("ready");
    expect(file.bytes).toEqual([1, 2, 3, 4]);
    if (staged.status !== "ready") throw new Error("Expected staged audio");
    await staged.lease.release();
  });

  it("scavenges once per store so a second player cannot delete an active lease", async () => {
    const { backend, staleDirectory, staleFile } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "ready",
    });
    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "ready",
    });

    expect(backend.listEntries).toHaveBeenCalledTimes(1);
    expect(staleFile.delete).toHaveBeenCalledTimes(1);
    expect(staleDirectory.delete).toHaveBeenCalledTimes(1);
  });

  it("retries private-cache preparation after a transient backend load failure", async () => {
    const { backend } = fakeBackend();
    const loadBackend = jest
      .fn<Promise<NativeArticleAudioEphemeralBackend>, []>()
      .mockRejectedValueOnce(new Error("cache unavailable"))
      .mockResolvedValueOnce(backend);
    const store = createNativeArticleAudioEphemeralStore({ loadBackend });

    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "failed",
    });
    await expect(store.prepare(new AbortController().signal)).resolves.toEqual({
      status: "ready",
    });

    expect(loadBackend).toHaveBeenCalledTimes(2);
    expect(backend.listEntries).toHaveBeenCalledTimes(1);
  });

  it("streams one bounded MP3 into a random private file and releases it idempotently", async () => {
    const { backend, file } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });
    const controller = new AbortController();

    const result = await store.stage(
      audioResponse(new Uint8Array([1, 2, 3, 4])),
      controller.signal,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected staged audio");
    expect(result.lease.byteLength).toBe(4);
    expect(result.lease.uri).toBe("file:///private-cache/random-id.mp3");
    expect(file.bytes).toEqual([1, 2, 3, 4]);
    expect(backend.createAudioFile).toHaveBeenCalledTimes(1);

    await result.lease.release();
    await result.lease.release();
    expect(file.deleteMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient staged-file deletion before marking the lease released", async () => {
    const { backend, file } = fakeBackend();
    file.deleteMock.mockImplementationOnce(() => {
      throw new Error("file handle still closing");
    });
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    const result = await store.stage(
      audioResponse(new Uint8Array([1, 2, 3, 4])),
      new AbortController().signal,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected staged audio");
    await result.lease.release();
    await result.lease.release();
    expect(file.deleteMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing content length", { "content-length": "" }],
    ["zero content length", { "content-length": "0" }],
    ["fractional content length", { "content-length": "4.5" }],
    ["wrong media type", { "content-type": "audio/wav" }],
    [
      "oversized declaration",
      { "content-length": String(MAX_NATIVE_ARTICLE_AUDIO_BYTES + 1) },
    ],
  ])("rejects %s before touching private storage", async (_label, headers) => {
    const { backend } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(
      store.stage(
        audioResponse(new Uint8Array([1, 2, 3, 4]), headers),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ reason: "invalid-response", status: "failed" });
    expect(backend.createAudioFile).not.toHaveBeenCalled();
  });

  it("cancels an invalid response body before returning ownership", async () => {
    const { backend } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });
    const cancel = jest.fn();
    const response = audioResponse(new ReadableStream<Uint8Array>({ cancel }), {
      "content-type": "application/json",
    });

    await expect(
      store.stage(response, new AbortController().signal),
    ).resolves.toEqual({ reason: "invalid-response", status: "failed" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(backend.createAudioFile).not.toHaveBeenCalled();
  });

  it("deletes a partial file when observed bytes exceed the declaration", async () => {
    const { backend, file } = fakeBackend();
    file.deleteMock.mockImplementationOnce(() => {
      throw new Error("file handle still closing");
    });
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(
      store.stage(
        audioResponse(new Uint8Array([1, 2, 3, 4]), {
          "content-length": "3",
        }),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ reason: "invalid-response", status: "failed" });
    expect(file.deleteMock).toHaveBeenCalledTimes(2);
  });

  it("deletes a short file when the stream ends before its declaration", async () => {
    const { backend, file } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(
      store.stage(
        audioResponse(new Uint8Array([1, 2]), { "content-length": "4" }),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ reason: "invalid-response", status: "failed" });
    expect(file.deleteMock).toHaveBeenCalledTimes(1);
  });

  it("deletes staged bytes when the final filesystem size does not match", async () => {
    const file = fakeFile();
    Object.defineProperty(file, "size", {
      configurable: true,
      get: () => 3,
    });
    const { backend } = fakeBackend(file);
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });

    await expect(
      store.stage(
        audioResponse(new Uint8Array([1, 2, 3, 4])),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ reason: "invalid-response", status: "failed" });
    expect(file.deleteMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a stalled response and removes its partial file", async () => {
    const { backend, file } = fakeBackend();
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: async () => backend,
    });
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new Uint8Array([1, 2]));
      },
    });
    const stage = store.stage(
      audioResponse(body, { "content-length": "4" }),
      controller.signal,
    );

    for (
      let attempt = 0;
      attempt < 5 &&
      (backend.createAudioFile as jest.Mock).mock.calls.length === 0;
      attempt += 1
    ) {
      await Promise.resolve();
    }
    expect(backend.createAudioFile).toHaveBeenCalledTimes(1);
    controller.abort();

    await expect(stage).resolves.toEqual({ status: "cancelled" });
    expect(file.deleteMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the response if the operation aborts while private storage loads", async () => {
    const { backend } = fakeBackend();
    let resolveBackend!: (value: NativeArticleAudioEphemeralBackend) => void;
    const backendLoading = new Promise<NativeArticleAudioEphemeralBackend>(
      (resolve) => {
        resolveBackend = resolve;
      },
    );
    const store = createNativeArticleAudioEphemeralStore({
      loadBackend: () => backendLoading,
    });
    const cancel = jest.fn();
    const response = audioResponse(new ReadableStream<Uint8Array>({ cancel }), {
      "content-length": "4",
    });
    const controller = new AbortController();

    const staged = store.stage(response, controller.signal);
    controller.abort();
    resolveBackend(backend);

    await expect(staged).resolves.toEqual({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(backend.createAudioFile).not.toHaveBeenCalled();
  });
});
