import type { BookmarkEntry } from "@curio-garden/domain";
import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

interface NativeLibrarySignedOutState {
  readonly entries: readonly [];
  readonly status: "signedOut";
}

interface NativeLibraryConnectingState {
  readonly entries: readonly [];
  readonly status: "connecting";
}

interface NativeLibraryLoadingState {
  readonly entries: readonly [];
  readonly status: "loading";
}

interface NativeLibraryErrorState {
  readonly entries: readonly [];
  readonly message: string;
  readonly status: "error";
}

interface NativeLibraryReadyState {
  readonly entries: readonly BookmarkEntry[];
  readonly status: "ready";
}

export type NativeLibraryState =
  | NativeLibrarySignedOutState
  | NativeLibraryConnectingState
  | NativeLibraryLoadingState
  | NativeLibraryErrorState
  | NativeLibraryReadyState;

export type NativeLibraryMutationResult =
  | Readonly<{ status: "committed" }>
  | Readonly<{ message: string; status: "failed" }>
  | Readonly<{ status: "superseded" }>;

export interface NativeLibraryValue {
  /** Opaque boundary that changes before a different account can expose data. */
  readonly accountEpoch: symbol;
  readonly isMutating: (slug: string) => boolean;
  readonly removeBookmark: (
    args: Readonly<{ slug: string }>,
  ) => Promise<NativeLibraryMutationResult>;
  readonly retry: () => void;
  readonly saveBookmark: (
    args: Readonly<{ slug: string; title: string }>,
  ) => Promise<NativeLibraryMutationResult>;
  readonly state: NativeLibraryState;
}

const NativeLibraryContext = createContext<NativeLibraryValue | null>(null);

export function NativeLibraryProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: NativeLibraryValue;
}): ReactElement {
  return (
    <NativeLibraryContext.Provider value={value}>
      {children}
    </NativeLibraryContext.Provider>
  );
}

export function useNativeLibrary(): NativeLibraryValue {
  const value = useContext(NativeLibraryContext);

  if (value === null) {
    throw new Error(
      "useNativeLibrary() must be used within NativeLibraryProvider",
    );
  }

  return value;
}
