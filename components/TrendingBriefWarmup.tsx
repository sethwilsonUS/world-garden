"use client";

import { useEffect } from "react";
import { warmTrendingBrief } from "@/lib/trending-brief-prefetch";

export const TrendingBriefWarmup = () => {
  useEffect(() => {
    const run = () => {
      void warmTrendingBrief();
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = setTimeout(run, 1500);
    return () => clearTimeout(timeoutId);
  }, []);

  return null;
};
