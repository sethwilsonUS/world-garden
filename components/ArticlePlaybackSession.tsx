"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useArticleAudioController } from "@/hooks/useArticleAudioController";
import { useHistory } from "@/hooks/useHistory";
import { NowPlayingBar } from "./NowPlayingBar";
import { tocFocusTargetId } from "./TableOfContents";
import type { ArticlePage, ArticleSource } from "./ArticlePlaybackProvider";

function focusSection(key: string) {
  const target = document.getElementById(tocFocusTargetId(key));
  if (!target || target.matches(":disabled")) return false;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  target.scrollIntoView({
    block: "center",
    behavior: reduceMotion ? "auto" : "smooth",
  });
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

type SessionProps = {
  source: ArticleSource;
  page: ArticlePage | null;
  ownsPlayback: boolean;
  claim: (source: ArticleSource) => void;
  release: (slug: string) => void;
};

function PlaybackSession({
  source,
  page,
  ownsPlayback,
  claim,
  release,
  badgeTrackingEnabled,
}: SessionProps & { badgeTrackingEnabled: boolean }) {
  const { slug, article } = source;
  const { updateProgress } = useHistory();
  const router = useRouter();
  const claimPlayback = useCallback(
    () => claim({ slug, article }),
    [claim, slug, article],
  );
  const controller = useArticleAudioController({
    slug,
    article,
    badgeTrackingEnabled,
    updateProgress,
    claimPlayback,
    ownsMediaSession: ownsPlayback,
  });
  const {
    state,
    actions,
    audioElement: { ref: audioRef, src: audioSrc },
  } = controller;
  const stop = actions.stopPlayAll;
  const { sectionKey, sectionIdx, status } = state.playback;
  const pendingJump = useRef(false);

  // Send changes to just the visible article. Background progress never
  // re-renders the current route or replaces its own article controls.
  useLayoutEffect(() => {
    page?.showController(controller);
  });

  useEffect(() => {
    if (ownsPlayback && status === "idle") release(slug);
  }, [ownsPlayback, release, slug, status]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio && !audio.paused) audio.pause();
    };
  }, [audioRef]);

  useLayoutEffect(() => {
    if (!ownsPlayback) return;
    function onPlay(event: Event) {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      if (media === audioRef.current) {
        for (const other of document.querySelectorAll<HTMLMediaElement>(
          "audio, video",
        )) {
          if (other !== media && !other.paused) other.pause();
        }
      } else {
        stop();
      }
    }
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, [ownsPlayback, stop, audioRef]);

  const jumpToSection = () => {
    if (!sectionKey) return;
    if (page && focusSection(sectionKey)) return;
    pendingJump.current = true;
    if (!page) router.push(`/article/${encodeURIComponent(slug)}`);
  };
  // Registration and the article's controls commit separately. Wait until
  // the section row is in the document before moving keyboard focus.
  useEffect(() => {
    if (page && pendingJump.current && sectionKey && focusSection(sectionKey)) {
      pendingJump.current = false;
    }
  });
  const sectionTitle =
    sectionIdx === null
      ? "Summary"
      : (article.sections?.[sectionIdx]?.title ?? null);

  return (
    <>
      <audio
        ref={audioRef}
        src={audioSrc ?? undefined}
        preload="metadata"
        aria-hidden="true"
        className="hidden"
      />
      {ownsPlayback && (
        <NowPlayingBar
          articleTitle={article.title}
          sectionTitle={sectionTitle}
          returnFocusRef={page?.playAllButtonRef}
          error={page || status !== "error" ? null : state.error}
          onRetry={actions.retry}
          playback={state.playback}
          audioProgress={state.audioProgress}
          playbackRate={state.playbackRate}
          onTogglePlayback={actions.togglePlayback}
          onSkipBy={actions.skipBy}
          onSkipSection={actions.skipSection}
          onStop={actions.stopPlayAll}
          onSeek={actions.seek}
          onPlaybackRateChange={actions.changePlaybackRate}
          onJumpToSection={jumpToSection}
        />
      )}
    </>
  );
}

function AuthenticatedPlaybackSession(props: SessionProps) {
  const { isLoaded, isSignedIn } = useAuth();
  return (
    <PlaybackSession
      {...props}
      badgeTrackingEnabled={isLoaded && isSignedIn === true}
    />
  );
}

export default function ArticlePlaybackSession(props: SessionProps) {
  return process.env.NEXT_PUBLIC_LOCAL_MODE === "true" ? (
    <PlaybackSession {...props} badgeTrackingEnabled={false} />
  ) : (
    <AuthenticatedPlaybackSession {...props} />
  );
}
