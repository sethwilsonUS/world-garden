import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

const NativeAuthTransportBindingContext = createContext<
  string | null | undefined
>(undefined);

/**
 * Private account binding for native transport adapters.
 *
 * Keep this value out of screen state, storage, logs, analytics, and copy.
 */
export function NativeAuthTransportBindingProvider({
  children,
  expectedAccountSubject,
}: {
  readonly children: ReactNode;
  readonly expectedAccountSubject: string | null;
}): ReactElement {
  return (
    <NativeAuthTransportBindingContext.Provider value={expectedAccountSubject}>
      {children}
    </NativeAuthTransportBindingContext.Provider>
  );
}

export function useNativeAuthTransportBinding(): string | null {
  const value = useContext(NativeAuthTransportBindingContext);

  if (value === undefined) {
    throw new Error(
      "useNativeAuthTransportBinding() must be used within NativeAuthProvider",
    );
  }

  return value;
}
