"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BADGE_KEYS, buildEmptyBadgeProgress } from "@/lib/badges";

export const useBadges = () => {
  const { isLoaded: isClerkLoaded, isSignedIn } = useAuth();
  const {
    isAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth();
  const canUseAccountApi = Boolean(isSignedIn && isAuthenticated);

  const result = useQuery(
    api.badges.getViewerBadgeProgress,
    canUseAccountApi ? {} : "skip",
  );

  const fallbackBadges = BADGE_KEYS.map((key) => buildEmptyBadgeProgress(key));

  return {
    badges: result?.badges ?? fallbackBadges,
    totalExp: result?.totalExp ?? 0,
    unlockedBadgeCount: result?.unlockedBadgeCount ?? 0,
    isLoaded: canUseAccountApi
      ? result !== undefined
      : isClerkLoaded && !isConvexAuthLoading,
  } as const;
};
