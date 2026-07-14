"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useData, type Article } from "@/lib/data-context";
import { useHistory } from "@/hooks/useHistory";
import { useArticleAudioController } from "@/hooks/useArticleAudioController";
import type { ContextBlock } from "@/lib/article-context-types";
import {
  analyzeAdaptiveImage,
  type AdaptiveImageAnalysis,
} from "@/lib/adaptive-image";
import { getVisibleArticleContextBlocks } from "@/lib/article-context-visibility";
import {
  ArticleContextLane,
  useArticleContext,
  type ArticleContextLoadState,
} from "./ArticleContext";
import { ArticleGallery, type LightboxState } from "./ArticleGallery";
import { ArticleHeader, ArticleSourceLine } from "./ArticleHeader";
import { ArticleTopics } from "./ArticleTopics";
import {
  ArticleHero,
  ArticleLoadError,
  ArticleLoadingState,
  AudioErrorNotice,
  ResumeBanner,
} from "./ArticleViewPresentation";
import { BookmarkButton } from "./BookmarkButton";
import { PlaylistActionButton } from "./PlaylistActionButton";
import { RelatedArticles } from "./RelatedArticles";
import { TableOfContents } from "./TableOfContents";

type ArticleData = Article & {
  _id?: string;
};

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const EMPTY_CONTEXT_BLOCKS: ContextBlock[] = [];

const AuthenticatedArticleView = ({ slug }: { slug: string }) => {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

  return (
    <ArticleViewContent
      key={slug}
      slug={slug}
      badgeTrackingEnabled={isAuthLoaded && isSignedIn === true}
    />
  );
};

export const ArticleView = ({ slug }: { slug: string }) => {
  if (isLocal) {
    return (
      <ArticleViewContent
        key={slug}
        slug={slug}
        badgeTrackingEnabled={false}
      />
    );
  }

  return <AuthenticatedArticleView slug={slug} />;
};

const ArticleViewContent = ({
  slug,
  badgeTrackingEnabled,
}: {
  slug: string;
  badgeTrackingEnabled: boolean;
}) => {
  const { fetchArticle } = useData();
  const { recordVisit, updateProgress, getProgress } = useHistory();

  const [displayArticle, setDisplayArticle] = useState<ArticleData | null>(
    null,
  );
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  const [savedProgressState, setSavedProgressState] = useState<{
    sectionKey?: string;
    sectionIndex?: number | null;
  } | null>(null);
  const [heroLightbox, setHeroLightbox] = useState<LightboxState>(null);
  const [heroImageAnalysis, setHeroImageAnalysis] =
    useState<AdaptiveImageAnalysis | null>(null);
  const fetchTriggered = useRef(false);

  const articleContext = useArticleContext(
    displayArticle
      ? {
          wikiPageId: displayArticle.wikiPageId,
          title: displayArticle.title,
          revisionId: displayArticle.revisionId,
          language: displayArticle.language,
        }
      : null,
  );
  const articleContextStatus = articleContext.status;
  const articleContextError = articleContext.error;
  const articleContextManifest =
    articleContextStatus === "ready" ? articleContext.manifest : null;
  const articleContextBlocks = articleContextManifest?.blocks ?? null;
  const contextBlocks = useMemo(
    () =>
      articleContextBlocks
        ? getVisibleArticleContextBlocks(
            articleContextBlocks,
            displayArticle?.thumbnailUrl,
          )
        : EMPTY_CONTEXT_BLOCKS,
    [articleContextBlocks, displayArticle?.thumbnailUrl],
  );
  const visibleArticleContext = useMemo<ArticleContextLoadState>(() => {
    if (articleContextStatus === "ready") {
      const manifest = articleContextManifest!;
      return {
        status: "ready",
        error: null,
        manifest:
          contextBlocks === manifest.blocks
            ? manifest
            : { ...manifest, blocks: contextBlocks },
      };
    }
    if (articleContextStatus === "error") {
      return {
        status: "error",
        manifest: null,
        error: articleContextError!,
      };
    }
    return { status: articleContextStatus, manifest: null, error: null };
  }, [
    articleContextError,
    articleContextManifest,
    articleContextStatus,
    contextBlocks,
  ]);

  const updateResumePrompt = useCallback(() => {
    const progress = getProgress(slug);
    if (
      progress?.lastSectionKey &&
      progress.lastSectionKey !== "summary" &&
      progress.lastSectionIndex != null
    ) {
      setSavedProgressState({
        sectionKey: progress.lastSectionKey,
        sectionIndex: progress.lastSectionIndex,
      });
      setShowResumeBanner(true);
      return;
    }

    setSavedProgressState(null);
    setShowResumeBanner(false);
  }, [getProgress, slug]);

  const loadArticle = useCallback(() => {
    fetchTriggered.current = true;
    fetchArticle({ slug })
      .then((result) => {
        const article = result as ArticleData;
        setDisplayArticle(article);
        updateResumePrompt();
        recordVisit(slug, article.title);
      })
      .catch((error) =>
        setFetchError(
          error instanceof Error ? error.message : "Failed to load article",
        ),
      )
      .finally(() => setFetching(false));
  }, [fetchArticle, recordVisit, slug, updateResumePrompt]);

  useEffect(() => {
    if (fetchTriggered.current) return;
    loadArticle();
  }, [loadArticle]);

  useEffect(() => {
    const thumbnailUrl = displayArticle?.thumbnailUrl;
    if (!thumbnailUrl) return;

    let cancelled = false;
    analyzeAdaptiveImage(thumbnailUrl)
      .then((analysis) => {
        if (!cancelled) {
          setHeroImageAnalysis(analysis);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHeroImageAnalysis({
            url: thumbnailUrl,
            hasTransparency: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayArticle?.thumbnailUrl]);

  const {
    state: audioState,
    actions: audioActions,
    audioElement: {
      ref: audioRef,
      src: audioSrc,
      playAllButtonRef,
      warmRegionRef,
    },
  } = useArticleAudioController({
    slug,
    article: displayArticle,
    badgeTrackingEnabled,
    updateProgress,
    shouldFocusPlayAll: Boolean(displayArticle && !showResumeBanner),
  });

  if (fetching && !displayArticle) {
    return <ArticleLoadingState />;
  }

  if (fetchError) {
    return (
      <ArticleLoadError
        error={fetchError}
        onRetry={() => {
          setFetchError(null);
          setFetching(true);
          loadArticle();
        }}
      />
    );
  }

  if (!displayArticle) return null;

  const sections = displayArticle.sections ?? [];
  const wikiPageId = displayArticle.wikiPageId;

  const handleResume = () => {
    if (!savedProgressState?.sectionKey) return;
    setShowResumeBanner(false);
    audioActions.resume(
      savedProgressState.sectionKey,
      savedProgressState.sectionIndex ?? null,
    );
  };

  const handleStartFromBeginning = () => {
    setShowResumeBanner(false);
    audioActions.startFromBeginning();
  };

  return (
    <article className="animate-fade-in-up">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-bold leading-[1.15] text-foreground m-0">
            {displayArticle.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <PlaylistActionButton slug={slug} title={displayArticle.title} />
            <BookmarkButton slug={slug} title={displayArticle.title} />
          </div>
        </div>
        <ArticleSourceLine
          language={displayArticle.language}
          revisionId={displayArticle.revisionId}
          wikiPageId={displayArticle.wikiPageId}
        />
        <ArticleTopics badgeKeys={displayArticle.badgeKeys} />
      </div>

      <ArticleHero
        article={displayArticle}
        imageAnalysis={heroImageAnalysis}
        lightbox={heroLightbox}
        onLightboxChange={setHeroLightbox}
      />

      {showResumeBanner && savedProgressState && (
        <ResumeBanner
          sectionLabel={
            savedProgressState.sectionIndex != null
              ? sections[savedProgressState.sectionIndex]?.title ??
                "previous section"
              : "summary"
          }
          onResume={handleResume}
          onStartOver={handleStartFromBeginning}
        />
      )}

      <audio
        ref={audioRef}
        src={audioSrc ?? undefined}
        preload="metadata"
        aria-hidden="true"
        className="hidden"
      />

      {audioState.error && (
        <AudioErrorNotice
          error={audioState.error}
          retryLabel={audioState.retryLabel}
          onRetry={audioActions.retry}
        />
      )}

      <div
        ref={warmRegionRef}
        className="animate-fade-in-up-delay-2 mb-6"
      >
        <TableOfContents
          articleTitle={displayArticle.title}
          wikiPageId={wikiPageId}
          summaryText={displayArticle.summary}
          sections={sections}
          sectionDurations={audioState.sectionDurations}
          playback={audioState.playback}
          onListenSection={audioActions.listenSection}
          onListenSummary={audioActions.listenSummary}
          onPlayAll={audioActions.playAll}
          onWarmPlayAll={audioActions.warmPlayAll}
          onWarmSummary={audioActions.warmSummary}
          onWarmSection={audioActions.warmSection}
          onStopPlayAll={audioActions.stopPlayAll}
          onTogglePlayAll={audioActions.togglePlayAll}
          onSkipSection={audioActions.skipSection}
          onDownloadAll={audioActions.downloadAll}
          downloadHref={audioState.download.href}
          downloading={audioState.download.downloading}
          downloadProgress={audioState.download.progress}
          downloadStatus={audioState.download.status}
          downloadStage={audioState.download.stage}
          playbackRate={audioState.playbackRate}
          onPlaybackRateChange={audioActions.changePlaybackRate}
          audioProgress={audioState.audioProgress}
          onSeek={audioActions.seek}
          playAllRef={playAllButtonRef}
          fallbackVoiceNotice={audioState.fallbackVoiceNotice}
          contextBlocks={contextBlocks}
        />
      </div>

      <ArticleContextLane
        state={visibleArticleContext}
        retry={articleContext.retry}
      />

      <div className="animate-fade-in-up-delay-2 mb-6">
        <ArticleGallery wikiPageId={wikiPageId} />
      </div>

      {audioState.finishedPlaying && (
        <div className="animate-fade-in-up mb-6">
          <RelatedArticles
            wikiPageId={wikiPageId}
            currentTitle={displayArticle.title}
          />
        </div>
      )}

      <ArticleHeader
        title={displayArticle.title}
        language={displayArticle.language}
        revisionId={displayArticle.revisionId}
        lastEdited={displayArticle.lastEdited}
        wikiPageId={displayArticle.wikiPageId}
      />
    </article>
  );
};
