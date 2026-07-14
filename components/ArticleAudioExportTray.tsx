"use client";

export type TrayJob = {
  _id: string;
  title: string;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount: number;
  completedSectionCount: number;
  createdAt: number;
  updatedAt: number;
  articleId?: string;
  lastError?: string;
  downloadHref?: string;
  statusLabelOverride?: string;
  progressLabelOverride?: string;
  kind: "export" | "download";
};

const statusLabel = (job: TrayJob): string => {
  if (job.statusLabelOverride) return job.statusLabelOverride;
  if (job.status === "ready") return "Ready to download";
  if (job.status === "failed") return "Export failed";
  if (job.stage === "packaging") return "Packaging MP3";
  if (job.status === "queued") return "Queued";
  if (job.status === "running") return "Preparing article audio";
  return "Preparing article audio";
};

const progressLabel = (job: TrayJob): string => {
  if (job.progressLabelOverride) return job.progressLabelOverride;
  if (job.status === "ready") return "Your article audio file is ready.";
  if (job.status === "failed") {
    return job.lastError || "Something went wrong while exporting this article.";
  }
  if (job.status === "queued") {
    return "Waiting for the current download to finish before this one starts.";
  }
  if (job.stage === "packaging") return "Finalizing the download package.";
  if (job.sectionCount <= 0) return "Preparing your export.";
  return `${Math.min(job.completedSectionCount, job.sectionCount)} of ${job.sectionCount} sections ready`;
};

const ExportIcon = ({
  status,
}: {
  status: TrayJob["status"];
}) => {
  if (status === "queued") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (status === "ready") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
        aria-hidden="true"
      >
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
    );
  }

  return (
    <svg
      className="animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
};
export const ArticleAudioExportTray = ({
  jobs,
  onDismiss,
  onRetry,
  politeAnnouncement,
  assertiveAnnouncement,
}: {
  jobs: TrayJob[];
  onDismiss: (exportId: string) => void;
  onRetry: (articleId: string) => void;
  politeAnnouncement: string;
  assertiveAnnouncement: string;
}) => {
  if (jobs.length === 0) {
    return (
      <>
        <div className="sr-only" aria-live="polite" role="status">
          {politeAnnouncement}
        </div>
        <div className="sr-only" aria-live="assertive" aria-atomic="true" role="alert">
          {assertiveAnnouncement}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="sr-only" aria-live="polite" role="status">
        {politeAnnouncement}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" role="alert">
        {assertiveAnnouncement}
      </div>

      <section
        aria-label="Audio downloads"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-end gap-3"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {jobs.map((job) => {
          const progressPercent =
            job.sectionCount > 0
              ? Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round(
                      (job.completedSectionCount / job.sectionCount) * 100,
                    ),
                  ),
                )
              : 12;

          const accentClasses =
            job.status === "failed"
              ? "text-serious bg-[color:var(--color-surface)] border-[color:var(--color-serious)]/25"
              : job.status === "ready"
                ? "text-accent bg-accent-bg border-accent-border"
                : "text-accent bg-accent-bg border-accent-border";

          return (
            <article
              key={job._id}
              className="pointer-events-auto garden-bed w-full max-w-[26rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.16)]"
            >
              <div className="p-4 sm:p-4.5">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border ${accentClasses}`}
                  >
                    <ExportIcon status={job.status} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">
                      {statusLabel(job)}
                    </p>
                    <h2 className="mt-1 font-display text-[1.02rem] leading-[1.2] text-foreground">
                      {job.title}
                    </h2>
                    <p className="mt-2 text-sm leading-[1.6] text-foreground-2">
                      {progressLabel(job)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDismiss(job._id)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted transition-colors duration-200 hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Dismiss audio download status for ${job.title}`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width={16}
                      height={16}
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>

                {job.status === "running" && (
                  <div className="mt-4 rounded-full bg-surface-3 p-1" aria-hidden="true">
                    <div
                      className="h-2 rounded-full bg-accent transition-[width] duration-300"
                      style={{
                        width:
                          job.stage === "packaging"
                            ? "100%"
                            : `${progressPercent}%`,
                      }}
                    />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {job.status === "ready" ? (
                    <a
                      href={
                        job.downloadHref ??
                        `/api/article/audio-export/${job._id}?download=1`
                      }
                      className="btn-primary min-h-11 px-4 py-2 text-sm no-underline"
                      aria-label={`Download audio for ${job.title}`}
                      download
                    >
                      {job.kind === "download" ? "Download again" : "Download MP3"}
                    </a>
                  ) : job.status === "failed" && job.articleId ? (
                    <button
                      type="button"
                      onClick={() => onRetry(job.articleId!)}
                      className="btn-primary min-h-11 px-4 py-2 text-sm"
                    >
                      Retry export
                    </button>
                  ) : job.status === "queued" ? (
                    <span className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm font-semibold text-foreground-2">
                      Queued
                    </span>
                  ) : (
                    <span className="inline-flex min-h-11 items-center rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-sm font-semibold text-accent">
                      Working in the background
                    </span>
                  )}

                  <span className="text-xs text-muted">
                    {new Date(job.updatedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
};
