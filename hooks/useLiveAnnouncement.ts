"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives a single mounted ARIA live region so repeated identical messages
 * still trigger a fresh announcement.
 *
 * React skips state updates with the same string, leaving the live region
 * unchanged and silent in assistive technology. When a caller announces the
 * same text again, this clears the region right away and restores the text in
 * a later task so screen readers observe two distinct DOM mutations. Pending
 * restores are cancelled on newer feedback or unmount.
 */
export const useLiveAnnouncement = () => {
  const [announcement, setAnnouncement] = useState("");
  const lastMessageRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  const announce = useCallback(
    (message: string) => {
      cancelPending();
      if (!message) {
        lastMessageRef.current = "";
        setAnnouncement("");
        return;
      }
      if (message === lastMessageRef.current) {
        setAnnouncement("");
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setAnnouncement(message);
        }, 0);
        return;
      }
      lastMessageRef.current = message;
      setAnnouncement(message);
    },
    [cancelPending],
  );

  return { announcement, announce } as const;
};
