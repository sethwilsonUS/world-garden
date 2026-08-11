export const MAX_NATIVE_ARTICLE_AUDIO_BYTES = 16 * 1024 * 1024;

// Preserve the original directory name across upgrades so the first activation
// still scavenges files created by the earlier summary-only player.
const ARTICLE_AUDIO_CACHE_DIRECTORY = "curio-article-summary-audio";
const STAGED_FILE_DELETE_ATTEMPTS = 3;

export interface NativeArticleAudioEphemeralBackendEntry {
  delete: () => void;
}

export interface NativeArticleAudioEphemeralBackendFile extends NativeArticleAudioEphemeralBackendEntry {
  readonly size: number;
  readonly uri: string;
  writableStream: () => WritableStream<Uint8Array>;
}

export interface NativeArticleAudioEphemeralBackend {
  createAudioFile: () => NativeArticleAudioEphemeralBackendFile;
  ensureDirectory: () => void;
  listEntries: () => readonly NativeArticleAudioEphemeralBackendEntry[];
}

export interface NativeArticleAudioEphemeralLease {
  readonly byteLength: number;
  readonly uri: string;
  release: () => Promise<void>;
}

export type NativeArticleAudioEphemeralPreparationResult =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "failed" }>;

export type NativeArticleAudioEphemeralStageResult =
  | Readonly<{
      lease: NativeArticleAudioEphemeralLease;
      status: "ready";
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      reason: "invalid-response" | "temporarily-unavailable";
      status: "failed";
    }>;

export interface NativeArticleAudioEphemeralStore {
  prepare: (
    signal: AbortSignal,
  ) => Promise<NativeArticleAudioEphemeralPreparationResult>;
  stage: (
    response: Response,
    signal: AbortSignal,
  ) => Promise<NativeArticleAudioEphemeralStageResult>;
}

type StoreOptions = Readonly<{
  loadBackend?: () => Promise<NativeArticleAudioEphemeralBackend>;
}>;

async function loadExpoBackend(): Promise<NativeArticleAudioEphemeralBackend> {
  const [{ Directory, File, Paths }, { randomUUID }] = await Promise.all([
    import("expo-file-system"),
    import("expo-crypto"),
  ]);
  const directory = new Directory(Paths.cache, ARTICLE_AUDIO_CACHE_DIRECTORY);

  return {
    createAudioFile: () => {
      const file = new File(directory, `${randomUUID()}.mp3`);
      file.create({ intermediates: false, overwrite: false });
      return {
        delete: () => {
          if (file.exists) file.delete();
        },
        get size() {
          return file.size;
        },
        uri: file.uri,
        writableStream: () => file.writableStream(),
      };
    },
    ensureDirectory: () => {
      directory.create({ idempotent: true, intermediates: true });
    },
    listEntries: () =>
      directory.list().map((entry) => ({
        delete: () => {
          if (entry.exists) entry.delete();
        },
      })),
  };
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isMp3Response(response: Response): boolean {
  const mediaType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
  return response.status === 200 && mediaType === "audio/mpeg";
}

async function ignoreRejection(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (_error: unknown) {
    void _error;
  }
}

async function deleteWithBoundedRetry(
  entry: NativeArticleAudioEphemeralBackendEntry,
): Promise<boolean> {
  for (let attempt = 0; attempt < STAGED_FILE_DELETE_ATTEMPTS; attempt += 1) {
    try {
      entry.delete();
      return true;
    } catch (_error: unknown) {
      void _error;
      // A just-released native stream or decoder can briefly retain its file
      // handle. Yield before a bounded retry instead of permanently orphaning
      // bytes after the first transient failure.
      if (attempt + 1 < STAGED_FILE_DELETE_ATTEMPTS) await Promise.resolve();
    }
  }
  return false;
}

export function createNativeArticleAudioEphemeralStore({
  loadBackend = loadExpoBackend,
}: StoreOptions = {}): NativeArticleAudioEphemeralStore {
  let backendPromise: Promise<NativeArticleAudioEphemeralBackend> | null = null;
  let initializationPromise: Promise<void> | null = null;
  let initialized = false;
  const resolveBackend = () => {
    backendPromise ??= loadBackend().catch((error: unknown) => {
      backendPromise = null;
      throw error;
    });
    return backendPromise;
  };
  const initialize = async () => {
    if (initialized) return;
    initializationPromise ??= (async () => {
      const backend = await resolveBackend();
      backend.ensureDirectory();
      for (const entry of backend.listEntries()) {
        await deleteWithBoundedRetry(entry);
      }
      initialized = true;
    })();
    try {
      await initializationPromise;
    } catch (error: unknown) {
      initializationPromise = null;
      throw error;
    }
  };

  return {
    prepare: async (signal) => {
      if (signal.aborted) return { status: "cancelled" };
      try {
        await initialize();
        return signal.aborted ? { status: "cancelled" } : { status: "ready" };
      } catch (_error: unknown) {
        void _error;
        return signal.aborted ? { status: "cancelled" } : { status: "failed" };
      }
    },

    stage: async (response, signal) => {
      const declaredLength = parseContentLength(
        response.headers.get("content-length"),
      );
      if (
        !isMp3Response(response) ||
        declaredLength === null ||
        declaredLength > MAX_NATIVE_ARTICLE_AUDIO_BYTES ||
        response.body === null
      ) {
        if (response.body !== null) {
          await ignoreRejection(response.body.cancel());
        }
        return { reason: "invalid-response", status: "failed" };
      }
      if (signal.aborted) {
        await ignoreRejection(response.body.cancel());
        return { status: "cancelled" };
      }

      let file: NativeArticleAudioEphemeralBackendFile | null = null;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
      let invalidResponse = false;
      const abortStreams = () => {
        if (reader !== null) void ignoreRejection(reader.cancel());
        if (writer !== null) void ignoreRejection(writer.abort());
      };

      signal.addEventListener("abort", abortStreams, { once: true });
      try {
        const backend = await resolveBackend();
        if (signal.aborted) return { status: "cancelled" };
        backend.ensureDirectory();
        file = backend.createAudioFile();
        reader = response.body.getReader();
        writer = file.writableStream().getWriter();
        let observedLength = 0;

        while (true) {
          if (signal.aborted) return { status: "cancelled" };
          const next = await reader.read();
          if (signal.aborted) return { status: "cancelled" };
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) {
            invalidResponse = true;
            break;
          }

          observedLength += next.value.byteLength;
          if (
            observedLength > declaredLength ||
            observedLength > MAX_NATIVE_ARTICLE_AUDIO_BYTES
          ) {
            invalidResponse = true;
            break;
          }
          await writer.write(next.value);
        }

        if (invalidResponse || observedLength !== declaredLength) {
          return { reason: "invalid-response", status: "failed" };
        }
        if (signal.aborted) return { status: "cancelled" };

        await writer.close();
        if (signal.aborted) return { status: "cancelled" };
        writer.releaseLock();
        writer = null;
        reader.releaseLock();
        reader = null;
        if (file.size !== declaredLength) {
          return { reason: "invalid-response", status: "failed" };
        }
        let released = false;
        const stagedFile = file;
        file = null;
        return {
          lease: {
            byteLength: declaredLength,
            release: async () => {
              if (released) return;
              released = await deleteWithBoundedRetry(stagedFile);
            },
            uri: stagedFile.uri,
          },
          status: "ready",
        };
      } catch (_error: unknown) {
        void _error;
        return signal.aborted
          ? { status: "cancelled" }
          : { reason: "temporarily-unavailable", status: "failed" };
      } finally {
        signal.removeEventListener("abort", abortStreams);
        if (reader !== null) {
          await ignoreRejection(reader.cancel());
          try {
            reader.releaseLock();
          } catch (_error: unknown) {
            void _error;
          }
        }
        if (writer !== null) {
          await ignoreRejection(writer.abort());
          try {
            writer.releaseLock();
          } catch (_error: unknown) {
            void _error;
          }
        }
        if (file !== null) {
          await deleteWithBoundedRetry(file);
        }
        await ignoreRejection(response.body.cancel());
      }
    },
  };
}

/**
 * All article-audio surfaces share one activation boundary so a newly mounted
 * player cannot scavenge files still leased by the player it is replacing.
 */
export const defaultNativeArticleAudioEphemeralStore =
  createNativeArticleAudioEphemeralStore();
