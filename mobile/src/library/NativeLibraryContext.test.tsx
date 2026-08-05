import type { BookmarkEntry } from "@curio-garden/domain";
import { renderHook } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import {
  NativeLibraryProvider,
  useNativeLibrary,
  type NativeLibraryValue,
} from "./NativeLibraryContext";

const entries: readonly BookmarkEntry[] = [
  {
    savedAt: 1_754_342_400_000,
    slug: "Ada_Lovelace",
    title: "Ada Lovelace",
  },
];

const value: NativeLibraryValue = {
  accountEpoch: Symbol("account-a"),
  isMutating: () => false,
  removeBookmark: async () => ({ status: "committed" }),
  retry: () => undefined,
  saveBookmark: async () => ({ status: "committed" }),
  state: { entries, status: "ready" },
};

function LibraryWrapper({ children }: PropsWithChildren) {
  return (
    <NativeLibraryProvider value={value}>{children}</NativeLibraryProvider>
  );
}

describe("NativeLibraryContext", () => {
  it("fails clearly when the hook escapes its provider", () => {
    expect(() => renderHook(() => useNativeLibrary())).toThrow(
      "useNativeLibrary() must be used within NativeLibraryProvider",
    );
  });

  it("exposes the provider's account-library contract", () => {
    const { result } = renderHook(() => useNativeLibrary(), {
      wrapper: LibraryWrapper,
    });

    expect(result.current).toBe(value);
    expect(result.current.state).toEqual({ entries, status: "ready" });
    expect(result.current).not.toHaveProperty("download");
    expect(result.current).not.toHaveProperty("persistGuestBookmarks");
  });
});
