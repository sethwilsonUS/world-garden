"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BookmarkControllerValue } from "./bookmark-controller";
import { useGuestBookmarkController } from "./useGuestBookmarkController";
import { useHybridBookmarkController } from "./useHybridBookmarkController";

const BookmarkContext = createContext<BookmarkControllerValue | null>(null);

type BookmarkProviderProps = {
  children: ReactNode;
};

export const LocalBookmarkProvider = ({ children }: BookmarkProviderProps) => {
  const value = useGuestBookmarkController();

  return (
    <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>
  );
};

export const HybridBookmarkProvider = ({ children }: BookmarkProviderProps) => {
  const value = useHybridBookmarkController();

  return (
    <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>
  );
};

export const useBookmarks = (): BookmarkControllerValue => {
  const context = useContext(BookmarkContext);

  if (!context) {
    throw new Error("useBookmarks() must be used within a BookmarkProvider");
  }

  return context;
};
