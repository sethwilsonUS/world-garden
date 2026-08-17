import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  NativeAuthTransportBindingProvider,
  useNativeAuthTransportBinding,
  type NativeAuthTransportBinding,
} from "./NativeAuthTransportBindingContext";

describe("NativeAuthTransportBindingProvider", () => {
  it("fails clearly when the private hook escapes its provider", async () => {
    await expect(
      renderHook(() => useNativeAuthTransportBinding()),
    ).rejects.toThrow(
      "useNativeAuthTransportBinding() must be used within NativeAuthProvider",
    );
  });

  it("exposes only the audited transport capability", async () => {
    const accountEpoch = Symbol("test-account-epoch");
    const binding: NativeAuthTransportBinding = {
      accountEpoch,
      isCurrentAccountEpoch: (candidateEpoch) =>
        candidateEpoch === accountEpoch,
      resolveRequestCredentials: jest.fn().mockResolvedValue({
        accountEpoch,
        status: "public",
      }),
    };

    function Wrapper({ children }: PropsWithChildren) {
      return (
        <NativeAuthTransportBindingProvider binding={binding}>
          {children}
        </NativeAuthTransportBindingProvider>
      );
    }

    const { result } = await renderHook(() => useNativeAuthTransportBinding(), {
      wrapper: Wrapper,
    });

    expect(result.current).toBe(binding);
    expect(result.current).not.toHaveProperty("expectedAccountSubject");
    expect(result.current.isCurrentAccountEpoch(accountEpoch)).toBe(true);
    expect(result.current.isCurrentAccountEpoch(Symbol("stale"))).toBe(false);
  });
});
