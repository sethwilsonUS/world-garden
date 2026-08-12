import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  NativeListeningProgressProvider,
  useNativeListeningProgress,
  type NativeListeningProgressValue,
} from "./NativeListeningProgressContext";

const value: NativeListeningProgressValue = {
  accountEpoch: Symbol("account-a"),
  availability: "unavailable",
  openArticle: async () => ({ status: "unavailable" }),
};

function ListeningProgressWrapper({ children }: PropsWithChildren) {
  return (
    <NativeListeningProgressProvider value={value}>
      {children}
    </NativeListeningProgressProvider>
  );
}

describe("NativeListeningProgressContext", () => {
  it("fails clearly when the hook escapes its provider", () => {
    expect(() => renderHook(() => useNativeListeningProgress())).toThrow(
      "useNativeListeningProgress() must be used within NativeListeningProgressProvider",
    );
  });

  it("exposes the provider's tokenless account-bound contract", () => {
    const { result } = renderHook(() => useNativeListeningProgress(), {
      wrapper: ListeningProgressWrapper,
    });

    expect(result.current).toBe(value);
    expect(result.current.availability).toBe("unavailable");
    expect(result.current).not.toHaveProperty("token");
    expect(result.current).not.toHaveProperty("getToken");
  });
});
