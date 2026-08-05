import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

const NativeAccountSubjectBindingContext = createContext<
  string | null | undefined
>(undefined);

/**
 * Account identity validated by the Clerk-to-Convex bridge.
 *
 * This context deliberately exposes no session credential or token resolver.
 * Data adapters may use the subject only to bind account-scoped query results
 * to the currently displayed native session.
 */
export function NativeAccountSubjectBindingProvider({
  children,
  subject,
}: {
  readonly children: ReactNode;
  readonly subject: string | null;
}): ReactElement {
  return (
    <NativeAccountSubjectBindingContext.Provider value={subject}>
      {children}
    </NativeAccountSubjectBindingContext.Provider>
  );
}

export function useNativeAccountSubjectBinding(): string | null {
  const subject = useContext(NativeAccountSubjectBindingContext);
  if (subject === undefined) {
    throw new Error(
      "useNativeAccountSubjectBinding() must be used within NativeAuthProvider",
    );
  }

  return subject;
}
