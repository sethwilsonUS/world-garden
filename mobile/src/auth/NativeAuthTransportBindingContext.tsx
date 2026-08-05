import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

export type NativeAuthTransportCredentials =
  | Readonly<{
      accountEpoch: symbol;
      sessionToken: string;
      status: "authenticated";
    }>
  | Readonly<{
      accountEpoch: symbol;
      status: "public";
    }>
  | Readonly<{ status: "superseded" }>
  | Readonly<{ status: "unavailable" }>;

export interface NativeAuthTransportBinding {
  readonly accountEpoch: symbol;
  readonly isCurrentAccountEpoch: (accountEpoch: symbol) => boolean;
  readonly resolveRequestCredentials: (options?: {
    readonly forceRefresh?: boolean;
  }) => Promise<NativeAuthTransportCredentials>;
}

const NativeAuthTransportBindingContext = createContext<
  NativeAuthTransportBinding | undefined
>(undefined);

/**
 * Private account binding for native transport adapters.
 *
 * Keep this value and any resolved credential out of screen state, storage,
 * logs, analytics, and copy. A transport should resolve, attach, and discard
 * the credential within one request.
 */
export function NativeAuthTransportBindingProvider({
  binding,
  children,
}: {
  readonly binding: NativeAuthTransportBinding;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <NativeAuthTransportBindingContext.Provider value={binding}>
      {children}
    </NativeAuthTransportBindingContext.Provider>
  );
}

export function useNativeAuthTransportBinding(): NativeAuthTransportBinding {
  const value = useContext(NativeAuthTransportBindingContext);

  if (value === undefined) {
    throw new Error(
      "useNativeAuthTransportBinding() must be used within NativeAuthProvider",
    );
  }

  return value;
}
