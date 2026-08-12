import type { ResumeCursor, ResumeCursorTarget } from "@curio-garden/domain";
import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

export type NativeListeningProgressAvailability =
  | "connecting"
  | "ready"
  | "unavailable";

export type NativeListeningProgressMutationResult =
  | Readonly<{ status: "committed" }>
  | Readonly<{ cursor: ResumeCursor | null; status: "conflict" }>
  | Readonly<{ message: string; status: "failed" }>
  | Readonly<{ status: "superseded" }>;

export interface NativeListeningProgressSession {
  readonly clear: () => Promise<NativeListeningProgressMutationResult>;
  readonly save: (
    cursor: ResumeCursor,
  ) => Promise<NativeListeningProgressMutationResult>;
}

export type NativeListeningProgressOpenResult =
  | Readonly<{
      cursor: ResumeCursor | null;
      session: NativeListeningProgressSession;
      status: "opened";
    }>
  | Readonly<{ message: string; status: "failed" }>
  | Readonly<{ status: "superseded" }>
  | Readonly<{ status: "unavailable" }>;

export interface NativeListeningProgressValue {
  /** Opaque boundary that changes before a different account can expose data. */
  readonly accountEpoch: symbol;
  readonly availability: NativeListeningProgressAvailability;
  readonly openArticle: (
    target: ResumeCursorTarget,
  ) => Promise<NativeListeningProgressOpenResult>;
}

const NativeListeningProgressContext =
  createContext<NativeListeningProgressValue | null>(null);

export function NativeListeningProgressProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: NativeListeningProgressValue;
}): ReactElement {
  return (
    <NativeListeningProgressContext.Provider value={value}>
      {children}
    </NativeListeningProgressContext.Provider>
  );
}

export function useNativeListeningProgress(): NativeListeningProgressValue {
  const value = useContext(NativeListeningProgressContext);

  if (value === null) {
    throw new Error(
      "useNativeListeningProgress() must be used within NativeListeningProgressProvider",
    );
  }

  return value;
}
