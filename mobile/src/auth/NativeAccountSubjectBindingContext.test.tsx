import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  NativeAccountSubjectBindingProvider,
  useNativeAccountSubjectBinding,
} from "./NativeAccountSubjectBindingContext";

describe("NativeAccountSubjectBindingProvider", () => {
  it("fails clearly when the account hook escapes its provider", async () => {
    await expect(
      renderHook(() => useNativeAccountSubjectBinding()),
    ).rejects.toThrow(
      "useNativeAccountSubjectBinding() must be used within NativeAuthProvider",
    );
  });

  it.each(["user-a", null])(
    "exposes only the validated subject %s",
    async (subject) => {
      function Wrapper({ children }: PropsWithChildren) {
        return (
          <NativeAccountSubjectBindingProvider subject={subject}>
            {children}
          </NativeAccountSubjectBindingProvider>
        );
      }

      const { result } = await renderHook(
        () => useNativeAccountSubjectBinding(),
        {
          wrapper: Wrapper,
        },
      );

      expect(result.current).toBe(subject);
    },
  );
});
