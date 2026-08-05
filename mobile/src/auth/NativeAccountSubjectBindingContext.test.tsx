import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  NativeAccountSubjectBindingProvider,
  useNativeAccountSubjectBinding,
} from "./NativeAccountSubjectBindingContext";

describe("NativeAccountSubjectBindingProvider", () => {
  it("fails clearly when the account hook escapes its provider", () => {
    expect(() => renderHook(() => useNativeAccountSubjectBinding())).toThrow(
      "useNativeAccountSubjectBinding() must be used within NativeAuthProvider",
    );
  });

  it.each(["user-a", null])(
    "exposes only the validated subject %s",
    (subject) => {
      function Wrapper({ children }: PropsWithChildren) {
        return (
          <NativeAccountSubjectBindingProvider subject={subject}>
            {children}
          </NativeAccountSubjectBindingProvider>
        );
      }

      const { result } = renderHook(() => useNativeAccountSubjectBinding(), {
        wrapper: Wrapper,
      });

      expect(result.current).toBe(subject);
    },
  );
});
