import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

export type NativeArticleAudioProvider = "edge" | "openai";
export type NativeArticleAudioSectionKey = "summary" | `section-${number}`;

export type NativeArticleAudioSectionRequest = Readonly<{
  narrationVersion: number;
  provider: NativeArticleAudioProvider;
  revisionId: string;
  sectionKey: NativeArticleAudioSectionKey;
  signal?: AbortSignal;
  slug: string;
}>;

export type NativeArticleAudioFailureReason =
  | "account-unavailable"
  | "article-changed"
  | "article-not-found"
  | "authentication-rejected"
  | "invalid-request"
  | "invalid-response"
  | "temporarily-unavailable";

export type NativeArticleAudioSectionResult =
  | Readonly<{
      accountEpoch: symbol;
      /** Releases the native response transport after streaming or cancellation. */
      release: () => void;
      response: Response;
      status: "ready";
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "superseded" }>
  | Readonly<{
      reason: NativeArticleAudioFailureReason;
      retryable: boolean;
      status: "failed";
    }>;

export interface NativeArticleAudioAccess {
  /** Opaque boundary that changes before a different account can expose data. */
  readonly accountEpoch: symbol;
  readonly requestSection: (
    request: NativeArticleAudioSectionRequest,
  ) => Promise<NativeArticleAudioSectionResult>;
}

const NativeArticleAudioAccessContext =
  createContext<NativeArticleAudioAccess | null>(null);

export function NativeArticleAudioAccessContextProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: NativeArticleAudioAccess;
}): ReactElement {
  return (
    <NativeArticleAudioAccessContext.Provider value={value}>
      {children}
    </NativeArticleAudioAccessContext.Provider>
  );
}

export function useNativeArticleAudioAccess(): NativeArticleAudioAccess {
  const value = useContext(NativeArticleAudioAccessContext);
  if (value === null) {
    throw new Error(
      "useNativeArticleAudioAccess() must be used within NativeArticleAudioAccessProvider",
    );
  }
  return value;
}
