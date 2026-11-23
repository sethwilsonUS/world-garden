"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData, type Article } from "@/lib/data-context";
import { useHistory } from "@/hooks/useHistory";
import { useArticlePlayback } from "./ArticlePlaybackProvider";
import {
  useArticleContext,
  type ArticleContextLoadState,
} from "@/hooks/useArticleContext";
import type { ContextBlock } from "@/lib/article-context-types";
import {
  analyzeAdaptiveImage,
  type AdaptiveImageAnalysis,
} from "@/lib/adaptive-image";
import { getVisibleArticleContextBlocks } from "@/lib/article-context-visibility";
import { ArticleContextLane } from "./ArticleContext";
import { ArticleFeedbackLink } from "./ArticleFeedbackLink";
import { ArticleGallery } from "./ArticleGallery";
import type { LightboxState } from "./GalleryLightbox";
import { ArticleHeader, ArticleSourceLine } from "./ArticleHeader";
import { ArticleTopics } from "./ArticleTopics";
import {
  ArticleHero,
  ArticleLoadError,
  ArticleLoadingState,
  AudioErrorNotice,
  ResumeBanner,
} from "./ArticleViewPresentation";
import { ArticleListeningControls } from "./ArticleListeningControls";
import { BookmarkButton } from "./BookmarkButton";
import { PlaylistActionButton } from "./PlaylistActionButton";
import { RelatedArticles } from "./RelatedArticles";
import { TableOfContents } from "./TableOfContents";

type ArticleData = Article & {
  _id?: string;
};

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const EMPTY_CONTEXT_BLOCKS: ContextBlock[] = [];

export const ArticleView = ({ slug }: { slug: string }) => (
  <ArticleViewContent key={slug} slug={slug} />
);

const ArticleViewContent = ({ slug }: { slug: string }) => {
  const { fetchArticle } = useData();
  const { recordVisit, getProgress } = useHistory();

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
  const playAllButtonRef = useRef<HTMLButtonElement>(null);

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

  const controller = useArticlePlayback(slug, displayArticle, playAllButtonRef);

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
  if (!controller) return <ArticleLoadingState />;
  const {
    state: audioState,
    actions: audioActions,
    audioElement: { warmRegionRef },
  } = controller;

  const sections = displayArticle.sections ?? [];

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
      <header className="mb-6">
        <h1 className="type-page-title m-0 font-display text-[clamp(2rem,5vw,3rem)] font-bold leading-[1.15] text-foreground">
          {displayArticle.title}
        </h1>

        <div className="mt-5">
          <ArticleListeningControls
            playAllButtonRef={playAllButtonRef}
            identity={displayArticle}
            summaryText={displayArticle.summary}
            sections={sections}
            sectionDurations={audioState.sectionDurations}
            playback={audioState.playback}
            onPlayAll={audioActions.playAll}
            onWarmPlayAll={audioActions.warmPlayAll}
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
            fallbackVoiceNotice={audioState.fallbackVoiceNotice}
          />
        </div>

        {showResumeBanner &&
          savedProgressState &&
          audioState.playback.status === "idle" && (
            <div className="mt-4">
              <ResumeBanner
                sectionLabel={
                  savedProgressState.sectionIndex != null
                    ? (sections[savedProgressState.sectionIndex]?.title ??
                      "previous section")
                    : "summary"
                }
                onResume={handleResume}
                onStartOver={handleStartFromBeginning}
              />
            </div>
          )}

        {audioState.error && (
          <div className="mt-4">
            <AudioErrorNotice
              error={audioState.error}
              retryLabel={audioState.retryLabel}
              onRetry={audioActions.retry}
            />
          </div>
        )}

        <div
          role="group"
          aria-label="Save this article"
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <BookmarkButton
            slug={slug}
            title={displayArticle.title}
            variant="labeled"
          />
          <PlaylistActionButton
            slug={slug}
            title={displayArticle.title}
            variant="labeled"
          />
          <details className="group basis-full" data-save-options-help>
            <summary className="btn-tertiary -ml-3 cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">What’s the difference?</span>
              <span className="hidden group-open:inline">
                Hide the difference
              </span>
            </summary>
            <p className="mb-0 mt-1 max-w-[70ch] text-sm leading-relaxed text-foreground-2">
              {isLocal
                ? "Library keeps the article on this device for later."
                : "Library keeps the article for later. Playlist generates a full-article podcast episode for your private feed."}
            </p>
          </details>
        </div>
      </header>

      <ArticleHero
        article={displayArticle}
        imageAnalysis={heroImageAnalysis}
        lightbox={heroLightbox}
        onLightboxChange={setHeroLightbox}
      />

      <div className="mb-6 flex flex-col gap-3">
        <ArticleSourceLine
          language={displayArticle.language}
          revisionId={displayArticle.revisionId}
          wikiPageId={displayArticle.wikiPageId}
        />
        <ArticleTopics badgeKeys={displayArticle.badgeKeys} />
      </div>

      <div ref={warmRegionRef} className="animate-fade-in-up-delay-2 mb-6">
        <TableOfContents
          identity={displayArticle}
          summaryText={displayArticle.summary}
          sections={sections}
          sectionDurations={audioState.sectionDurations}
          playback={audioState.playback}
          onListenSection={audioActions.listenSection}
          onListenSummary={audioActions.listenSummary}
          onWarmSummary={audioActions.warmSummary}
          onWarmSection={audioActions.warmSection}
          playbackRate={audioState.playbackRate}
          audioProgress={audioState.audioProgress}
          onSeek={audioActions.seek}
          contextBlocks={contextBlocks}
        />
      </div>

      <ArticleContextLane
        state={visibleArticleContext}
        retry={articleContext.retry}
      />

      <ArticleGallery
        identity={displayArticle}
        className="animate-fade-in-up-delay-2 mb-6 mt-10 border-t border-border pt-8"
      />

      {audioState.finishedPlaying && (
        <div className="animate-fade-in-up mb-6">
          <RelatedArticles identity={displayArticle} />
        </div>
      )}

      <ArticleHeader
        title={displayArticle.title}
        language={displayArticle.language}
        revisionId={displayArticle.revisionId}
        lastEdited={displayArticle.lastEdited}
        wikiPageId={displayArticle.wikiPageId}
      />

      <p className="mt-6 text-sm text-muted">
        Something off with this article or its audio?{" "}
        <ArticleFeedbackLink
          title={displayArticle.title}
          slug={slug}
          revisionId={displayArticle.revisionId}
        />
      </p>
    </article>
  );
};
