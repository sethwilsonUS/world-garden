import {
  normalizeMediaWikiNumericId,
  normalizeResumeCursor,
  RESUME_CURSOR_LIMITS,
  resumeCursorMatchesTarget,
  type ResumeCursor,
  type ResumeCursorTarget,
} from "@curio-garden/domain";
import { useConvex, useMutation } from "convex/react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

import { useNativeAuth } from "../auth/NativeAuthContext";
import { useNativeAccountSubjectBinding } from "../auth/NativeAccountSubjectBindingContext";
import {
  NativeListeningProgressProvider,
  type NativeListeningProgressMutationResult,
  type NativeListeningProgressOpenResult,
  type NativeListeningProgressSession,
  type NativeListeningProgressValue,
} from "../listening/NativeListeningProgressContext";
import { convexClientApi } from "./convexClientApi";

const UNAVAILABLE_RESULT = Object.freeze({ status: "unavailable" as const });
const SUPERSEDED_RESULT = Object.freeze({ status: "superseded" as const });
const COMMITTED_RESULT = Object.freeze({ status: "committed" as const });
const LOAD_ERROR_MESSAGE =
  "We couldn’t load your saved position. Please try again.";
const SAVE_ERROR_MESSAGE =
  "We couldn’t update your saved position. Please try again.";
const MAX_PENDING_MUTATIONS = 32;

type ActiveIdentity = Readonly<{
  accountEpoch: symbol;
  expectedAccountSubject: string;
  sessionEpochKey: string;
}>;

const identityMatches = (
  left: ActiveIdentity | null,
  right: ActiveIdentity,
): boolean =>
  left?.accountEpoch === right.accountEpoch &&
  left.expectedAccountSubject === right.expectedAccountSubject &&
  left.sessionEpochKey === right.sessionEpochKey;

type ServerResponse = Readonly<{
  cursor: ResumeCursor | null;
  cursorVersion: number;
  sessionEpochKey: string;
}>;

type ServerMutationResponse = ServerResponse & {
  disposition: "applied" | "stale";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key))
  );
};

const normalizeTarget = (value: unknown): ResumeCursorTarget | null => {
  if (!isRecord(value)) {
    return null;
  }
  const wikiPageId = normalizeMediaWikiNumericId(value.wikiPageId);
  const revisionId = normalizeMediaWikiNumericId(value.revisionId);
  if (
    wikiPageId === null ||
    revisionId === null ||
    typeof value.narrationVersion !== "number" ||
    !Number.isSafeInteger(value.narrationVersion) ||
    value.narrationVersion < 1 ||
    value.narrationVersion > RESUME_CURSOR_LIMITS.maxNarrationVersion
  ) {
    return null;
  }

  return Object.freeze({
    narrationVersion: value.narrationVersion,
    revisionId,
    wikiPageId,
  });
};

const normalizeServerResponse = (
  value: unknown,
  target: ResumeCursorTarget,
  kind: "mutation" | "query",
): ServerResponse | null => {
  const expectedKeys =
    kind === "mutation"
      ? ["cursor", "cursorVersion", "disposition", "sessionEpochKey"]
      : ["cursor", "cursorVersion", "sessionEpochKey"];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, expectedKeys) ||
    typeof value.sessionEpochKey !== "string" ||
    !Number.isSafeInteger(value.cursorVersion) ||
    (value.cursorVersion as number) < 0 ||
    (kind === "mutation" &&
      value.disposition !== "applied" &&
      value.disposition !== "stale")
  ) {
    return null;
  }
  const cursorVersion = value.cursorVersion as number;
  if (value.cursor === null) {
    return {
      cursor: null,
      cursorVersion,
      sessionEpochKey: value.sessionEpochKey,
      ...(kind === "mutation"
        ? { disposition: value.disposition as "applied" | "stale" }
        : {}),
    };
  }
  if (
    !isRecord(value.cursor) ||
    !hasExactKeys(value.cursor, [
      "cursorVersion",
      "durationSeconds",
      "mode",
      "narrationVersion",
      "positionSeconds",
      "revisionId",
      "sectionKey",
      "updatedAt",
      "wikiPageId",
    ]) ||
    cursorVersion === 0 ||
    value.cursor.cursorVersion !== cursorVersion ||
    !Number.isSafeInteger(value.cursor.updatedAt) ||
    (value.cursor.updatedAt as number) < 0
  ) {
    return null;
  }
  const cursor = normalizeResumeCursor({
    durationSeconds: value.cursor.durationSeconds,
    mode: value.cursor.mode,
    narrationVersion: value.cursor.narrationVersion,
    positionSeconds: value.cursor.positionSeconds,
    revisionId: value.cursor.revisionId,
    sectionKey: value.cursor.sectionKey,
    wikiPageId: value.cursor.wikiPageId,
  });
  if (cursor === null || !resumeCursorMatchesTarget(cursor, target)) {
    return null;
  }

  return {
    cursor,
    cursorVersion,
    sessionEpochKey: value.sessionEpochKey,
    ...(kind === "mutation"
      ? { disposition: value.disposition as "applied" | "stale" }
      : {}),
  };
};

const normalizeServerMutationResponse = (
  value: unknown,
  target: ResumeCursorTarget,
): ServerMutationResponse | null => {
  const response = normalizeServerResponse(value, target, "mutation");
  if (
    response === null ||
    !isRecord(value) ||
    (value.disposition !== "applied" && value.disposition !== "stale")
  ) {
    return null;
  }
  return { ...response, disposition: value.disposition };
};

const cursorsEqual = (
  left: ResumeCursor | null,
  right: ResumeCursor | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.wikiPageId === right.wikiPageId &&
    left.revisionId === right.revisionId &&
    left.narrationVersion === right.narrationVersion &&
    left.mode === right.mode &&
    left.sectionKey === right.sectionKey &&
    left.positionSeconds === right.positionSeconds &&
    left.durationSeconds === right.durationSeconds);

const sanitizeOpenError = (
  _error: unknown,
  message: string,
): NativeListeningProgressOpenResult => ({ message, status: "failed" });

const sanitizeMutationError = (
  _error: unknown,
  message: string,
): NativeListeningProgressMutationResult => ({
  message,
  status: "failed",
});

type NativeResumeWriteArgs = Readonly<{
  cursor: ResumeCursor | null;
  expectedAccountSubject: string;
  expectedCursorVersion: number;
  sessionEpochKey: string;
  wikiPageId: string;
}>;

type PendingMutation = Readonly<{
  intent: ResumeCursor | null;
  kind: "clear" | "save";
  resolve: (result: NativeListeningProgressMutationResult) => void;
}>;

const createSession = ({
  currentIdentity,
  identity,
  initialCursorVersion,
  target,
  write,
}: {
  readonly currentIdentity: () => ActiveIdentity | null;
  readonly identity: ActiveIdentity;
  readonly initialCursorVersion: number;
  readonly target: ResumeCursorTarget;
  readonly write: (args: NativeResumeWriteArgs) => Promise<unknown>;
}): NativeListeningProgressSession => {
  let cursorVersion = initialCursorVersion;
  let terminalConflict:
    | Extract<NativeListeningProgressMutationResult, { status: "conflict" }>
    | undefined;
  let terminallySuperseded = false;
  let activeMutation = false;
  const pendingMutations: PendingMutation[] = [];

  const run = async (
    intent: ResumeCursor | null,
  ): Promise<NativeListeningProgressMutationResult> => {
    if (terminallySuperseded || !identityMatches(currentIdentity(), identity)) {
      terminallySuperseded = true;
      return SUPERSEDED_RESULT;
    }
    if (terminalConflict !== undefined) return terminalConflict;

    const expectedCursorVersion = cursorVersion;
    try {
      const rawResponse = await Promise.resolve().then(() =>
        write({
          cursor: intent,
          expectedAccountSubject: identity.expectedAccountSubject,
          expectedCursorVersion,
          sessionEpochKey: identity.sessionEpochKey,
          wikiPageId: target.wikiPageId,
        }),
      );
      if (!identityMatches(currentIdentity(), identity)) {
        terminallySuperseded = true;
        return SUPERSEDED_RESULT;
      }
      const response = normalizeServerMutationResponse(rawResponse, target);
      if (response === null) {
        return sanitizeMutationError(null, SAVE_ERROR_MESSAGE);
      }
      if (response.sessionEpochKey !== identity.sessionEpochKey) {
        terminallySuperseded = true;
        return SUPERSEDED_RESULT;
      }

      if (response.disposition === "applied") {
        if (
          response.cursorVersion !== expectedCursorVersion + 1 ||
          !cursorsEqual(response.cursor, intent)
        ) {
          return sanitizeMutationError(null, SAVE_ERROR_MESSAGE);
        }
        cursorVersion = response.cursorVersion;
        return COMMITTED_RESULT;
      }

      if (response.cursorVersion <= expectedCursorVersion) {
        return sanitizeMutationError(null, SAVE_ERROR_MESSAGE);
      }
      cursorVersion = response.cursorVersion;
      if (cursorsEqual(response.cursor, intent)) {
        return COMMITTED_RESULT;
      }
      terminalConflict = Object.freeze({
        cursor: response.cursor,
        status: "conflict" as const,
      });
      return terminalConflict;
    } catch (error: unknown) {
      return identityMatches(currentIdentity(), identity)
        ? sanitizeMutationError(error, SAVE_ERROR_MESSAGE)
        : SUPERSEDED_RESULT;
    }
  };

  const drain = async (): Promise<void> => {
    if (activeMutation) return;
    activeMutation = true;
    try {
      while (pendingMutations.length > 0) {
        const operation = pendingMutations.shift();
        if (operation === undefined) continue;
        operation.resolve(await run(operation.intent));
      }
    } finally {
      activeMutation = false;
    }
  };

  const enqueue = (
    intent: ResumeCursor | null,
    kind: PendingMutation["kind"],
  ): Promise<NativeListeningProgressMutationResult> => {
    if (terminallySuperseded || !identityMatches(currentIdentity(), identity)) {
      terminallySuperseded = true;
      return Promise.resolve(SUPERSEDED_RESULT);
    }
    if (terminalConflict !== undefined) {
      return Promise.resolve(terminalConflict);
    }
    if (kind === "save") {
      const previous = pendingMutations.at(-1);
      if (previous?.kind === "save") {
        pendingMutations.pop();
        previous.resolve(SUPERSEDED_RESULT);
      }
    }
    if (pendingMutations.length >= MAX_PENDING_MUTATIONS) {
      return Promise.resolve(sanitizeMutationError(null, SAVE_ERROR_MESSAGE));
    }

    const operation = new Promise<NativeListeningProgressMutationResult>(
      (resolve) => {
        pendingMutations.push({ intent, kind, resolve });
      },
    );
    void drain();
    return operation;
  };

  return {
    clear: () => enqueue(null, "clear"),
    save: (value) => {
      if (
        terminallySuperseded ||
        !identityMatches(currentIdentity(), identity)
      ) {
        terminallySuperseded = true;
        return Promise.resolve(SUPERSEDED_RESULT);
      }
      if (terminalConflict !== undefined) {
        return Promise.resolve(terminalConflict);
      }
      try {
        const cursor = normalizeResumeCursor(value);
        if (cursor === null || !resumeCursorMatchesTarget(cursor, target)) {
          return Promise.resolve(
            sanitizeMutationError(null, SAVE_ERROR_MESSAGE),
          );
        }
        return enqueue(cursor, "save");
      } catch (error: unknown) {
        return Promise.resolve(
          sanitizeMutationError(error, SAVE_ERROR_MESSAGE),
        );
      }
    },
  };
};

export function ConvexNativeListeningProgressProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const auth = useNativeAuth();
  const expectedAccountSubject = useNativeAccountSubjectBinding();
  const convex = useConvex();
  const writeMutation = useMutation(
    convexClientApi.listeningProgress.writeNative,
  );
  const isReady =
    auth.state.status === "ready" && expectedAccountSubject !== null;
  const availability = isReady
    ? "ready"
    : auth.state.status === "loading" || auth.state.status === "connecting"
      ? "connecting"
      : "unavailable";
  const currentIdentityRef = useRef<ActiveIdentity | null>(null);
  useLayoutEffect(() => {
    currentIdentityRef.current = isReady
      ? {
          accountEpoch: auth.sessionEpoch,
          expectedAccountSubject,
          sessionEpochKey: auth.sessionEpochKey,
        }
      : null;

    return () => {
      currentIdentityRef.current = null;
    };
  }, [
    auth.sessionEpoch,
    auth.sessionEpochKey,
    expectedAccountSubject,
    isReady,
  ]);
  const openArticle = useCallback<NativeListeningProgressValue["openArticle"]>(
    async (requestedTarget) => {
      const identity = isReady
        ? {
            accountEpoch: auth.sessionEpoch,
            expectedAccountSubject,
            sessionEpochKey: auth.sessionEpochKey,
          }
        : null;
      if (identity === null) return UNAVAILABLE_RESULT;
      if (!identityMatches(currentIdentityRef.current, identity)) {
        return SUPERSEDED_RESULT;
      }

      try {
        const target = normalizeTarget(requestedTarget);
        if (target === null) {
          return sanitizeOpenError(null, LOAD_ERROR_MESSAGE);
        }
        const rawResponse: unknown = await convex.query(
          convexClientApi.listeningProgress.getNative,
          {
            expectedAccountSubject: identity.expectedAccountSubject,
            sessionEpochKey: identity.sessionEpochKey,
            wikiPageId: target.wikiPageId,
          },
        );
        if (!identityMatches(currentIdentityRef.current, identity)) {
          return SUPERSEDED_RESULT;
        }
        const response = normalizeServerResponse(rawResponse, target, "query");
        if (
          response === null ||
          response.sessionEpochKey !== identity.sessionEpochKey
        ) {
          return response !== null
            ? SUPERSEDED_RESULT
            : sanitizeOpenError(null, LOAD_ERROR_MESSAGE);
        }
        return {
          cursor: response.cursor,
          session: createSession({
            currentIdentity: () => currentIdentityRef.current,
            identity,
            initialCursorVersion: response.cursorVersion,
            target,
            write: writeMutation,
          }),
          status: "opened",
        };
      } catch (error: unknown) {
        return identityMatches(currentIdentityRef.current, identity)
          ? sanitizeOpenError(error, LOAD_ERROR_MESSAGE)
          : SUPERSEDED_RESULT;
      }
    },
    [
      auth.sessionEpoch,
      auth.sessionEpochKey,
      convex,
      expectedAccountSubject,
      isReady,
      writeMutation,
    ],
  );
  const value = useMemo<NativeListeningProgressValue>(
    () => ({
      accountEpoch: auth.sessionEpoch,
      availability,
      openArticle,
    }),
    [auth.sessionEpoch, availability, openArticle],
  );

  return (
    <NativeListeningProgressProvider value={value}>
      {children}
    </NativeListeningProgressProvider>
  );
}
