import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  NativeAuthTransportBindingProvider,
  useNativeAuthTransportBinding,
} from "./NativeAuthTransportBindingContext";

describe("NativeAuthTransportBindingProvider", () => {
  it("fails clearly when the private hook escapes its provider", () => {
    expect(() => renderHook(() => useNativeAuthTransportBinding())).toThrow(
      "useNativeAuthTransportBinding() must be used within NativeAuthProvider",
    );
  });

  it.each([
    ["a bound account", "user_private_account"],
    ["no bound account", null],
  ])("exposes %s only through the private hook", (_label, expectedSubject) => {
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <NativeAuthTransportBindingProvider
          expectedAccountSubject={expectedSubject}
        >
          {children}
        </NativeAuthTransportBindingProvider>
      );
    }

    const { result } = renderHook(() => useNativeAuthTransportBinding(), {
      wrapper: Wrapper,
    });

    expect(result.current).toBe(expectedSubject);
  });
});
