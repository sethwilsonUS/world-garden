"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";

const EXPORT_FILENAME_PATTERN =
  /^curio-garden-account-data-\d{4}-\d{2}-\d{2}\.json$/;
const ACTIVE_FEED_WARNING_ID = "account-export-active-feed-warning";
const ACTIVE_FEED_WARNING_HEADING_ID =
  "account-export-active-feed-warning-heading";
const ACCOUNT_EXPORT_CLIENT_TIMEOUT_MS = 65_000;

type ExportState = "idle" | "preparing" | "success" | "error" | "timeout";

const DownloadIcon = () => (
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
    focusable="false"
  >
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

const AccountDataFrame = ({ children }: { children: ReactNode }) => (
  <div className="container mx-auto px-4 pb-20 pt-10">
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Back navigation" className="mb-5">
        <Link
          href="/dashboard"
          className="inline-flex min-h-10 items-center gap-1 text-sm text-muted no-underline"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={14}
            height={14}
            aria-hidden="true"
            focusable="false"
          >
            <path d="m15 19-7-7 7-7" />
          </svg>
          Back to dashboard
        </Link>
      </nav>

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          Account
        </p>
        <h1 className="mt-3 font-display text-[2rem] font-bold leading-[1.08] text-foreground sm:text-[2.45rem]">
          Account &amp; data
        </h1>
        <p className="mt-4 max-w-2xl text-[1.02rem] leading-[1.75] text-foreground-2">
          Take a portable copy of the Curio Garden information connected to
          your signed-in account.
        </p>
      </header>

      <div className="mt-8">{children}</div>
    </div>
  </div>
);

const LocalAccountData = () => (
  <AccountDataFrame>
    <section
      aria-labelledby="local-account-data-heading"
      className="garden-bed pattern-leaves p-6 sm:p-7"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Local garden
      </p>
      <h2
        id="local-account-data-heading"
        className="mt-2 font-display text-[1.35rem] font-semibold text-foreground"
      >
        Account data is unavailable in local mode
      </h2>
      <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
        Local mode does not connect a Curio Garden account, so there is no
        server-side account export to prepare here. Browser-stored data remains
        on this device.
      </p>
      <Link
        href="/"
        className="btn-secondary mt-6 inline-flex min-h-11 items-center justify-center px-5 py-2.5 text-sm no-underline"
      >
        Back to the garden
      </Link>
    </section>
  </AccountDataFrame>
);

const LoadingAccountData = () => (
  <AccountDataFrame>
    <section className="garden-bed p-6 sm:p-7" role="status">
      <div className="skeleton h-4 w-32" aria-hidden="true" />
      <h2 className="mt-4 font-display text-[1.35rem] font-semibold text-foreground">
        Checking your account
      </h2>
      <p className="mt-2 text-sm leading-[1.75] text-muted">
        Your export options will appear when the account session is ready.
      </p>
    </section>
  </AccountDataFrame>
);

const SignedOutAccountData = () => (
  <AccountDataFrame>
    <section
      aria-labelledby="signed-out-account-data-heading"
      className="garden-bed pattern-leaves p-6 sm:p-7"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Sign-in needed
      </p>
      <h2
        id="signed-out-account-data-heading"
        className="mt-2 font-display text-[1.35rem] font-semibold text-foreground"
      >
        Sign in to export your account data
      </h2>
      <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
        Curio Garden needs an active account session before it can assemble a
        private export. Browsing and device-local guest features still work
        without signing in.
      </p>
      <SignInButton>
        <button
          type="button"
          className="btn-primary mt-6 inline-flex min-h-11 items-center justify-center px-6 py-3 text-sm"
        >
          Sign in
        </button>
      </SignInButton>
    </section>
  </AccountDataFrame>
);

const exportStatusMessage = (state: ExportState) => {
  switch (state) {
    case "preparing":
      return "Preparing your account data export.";
    case "success":
      return "Your account data file is ready. Your browser should begin the download.";
    case "error":
      return "Your account data could not be prepared. Please try again.";
    case "timeout":
      return "The account data export took too long. Please try again.";
    default:
      return "";
  }
};

const datedExportFilename = () =>
  `curio-garden-account-data-${new Date().toISOString().slice(0, 10)}.json`;

const getExportFilename = (contentDisposition: string | null) => {
  const quotedFilename = contentDisposition?.match(
    /(?:^|;)\s*filename\s*=\s*"([^"]+)"/i,
  )?.[1];
  const unquotedFilename = contentDisposition?.match(
    /(?:^|;)\s*filename\s*=\s*([^;\s]+)/i,
  )?.[1];
  const filename = quotedFilename ?? unquotedFilename;

  return filename && EXPORT_FILENAME_PATTERN.test(filename)
    ? filename
    : datedExportFilename();
};

const SignedInAccountData = () => {
  const [exportState, setExportState] = useState<ExportState>("idle");
  const activeRequestRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const isPreparing = exportState === "preparing";

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
    };
  }, []);

  const downloadAccountData = async () => {
    if (activeRequestRef.current || isPreparing) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setExportState("preparing");
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let rejectAbortedRequest: ((reason?: unknown) => void) | undefined;
    const handleAbort = () => {
      rejectAbortedRequest?.(
        new DOMException("The request was aborted.", "AbortError"),
      );
    };
    const aborted = new Promise<never>((_, reject) => {
      rejectAbortedRequest = reject;
      if (controller.signal.aborted) {
        handleAbort();
      } else {
        controller.signal.addEventListener("abort", handleAbort, {
          once: true,
        });
      }
    });

    const request = Promise.resolve().then(async () => {
      const response = await fetch("/api/account/export", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      if (!isMountedRef.current || controller.signal.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      if (response.redirected) {
        throw new Error("Account export response was redirected");
      }
      if (!response.ok) throw new Error("Account export request failed");
      const responseMediaType = response.headers
        .get("Content-Type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (responseMediaType !== "application/json") {
        throw new Error("Account export response was not JSON");
      }

      const filename = getExportFilename(
        response.headers.get("Content-Disposition"),
      );
      const blob = await response.blob();
      return { blob, filename };
    });
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(new Error("Account export client deadline expired"));
      }, ACCOUNT_EXPORT_CLIENT_TIMEOUT_MS);
    });
    try {
      const { blob, filename } = await Promise.race([
        request,
        deadline,
        aborted,
      ]);
      if (!isMountedRef.current || controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        globalThis.setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
        }, 0);
      }

      if (isMountedRef.current) setExportState("success");
    } catch {
      if (!isMountedRef.current) return;
      if (didTimeout) {
        setExportState("timeout");
      } else if (!controller.signal.aborted) {
        setExportState("error");
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      controller.signal.removeEventListener("abort", handleAbort);
      rejectAbortedRequest = undefined;
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
    }
  };

  return (
    <AccountDataFrame>
      <section
        aria-labelledby="account-export-heading"
        className="garden-bed overflow-hidden border-accent-border"
      >
        <div className="border-b border-accent-border bg-accent-bg p-6 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Portable JSON
          </p>
          <h2
            id="account-export-heading"
            className="mt-2 font-display text-[1.5rem] font-semibold leading-[1.2] text-foreground"
          >
            Download account data
          </h2>
          <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
            The export is a readable JSON file containing the account data
            Curio Garden can connect to you.
          </p>
        </div>

        <div className="p-6 sm:p-7">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Included in the export
          </h3>
          <ul className="mt-4 list-disc space-y-2.5 pl-5 text-sm leading-[1.75] text-foreground-2">
            <li>Account profile details available to Curio Garden.</li>
            <li>Bookmarks, plus Playlist order and episode status.</li>
            <li>
              Signed-in listening progress, including heard ranges, and
              topic-badge credit earned from qualifying listening.
            </li>
            <li>
              Private podcast feed state and, while its URL is active, your
              active private RSS feed token. Revoked feed tokens are not
              included.
            </li>
            <li>
              Article-audio export records and generation quota windows. These
              records contain metadata, not the generated audio files.
            </li>
          </ul>

          <aside
            id={ACTIVE_FEED_WARNING_ID}
            aria-labelledby={ACTIVE_FEED_WARNING_HEADING_ID}
            className="mt-6 rounded-2xl border border-accent-border bg-accent-bg px-5 py-4"
          >
            <h3
              id={ACTIVE_FEED_WARNING_HEADING_ID}
              className="font-display font-semibold text-foreground"
            >
              Keep the export somewhere private
            </h3>
            <p className="mt-2 text-sm leading-[1.7] text-foreground-2">
              An active private RSS feed token is a bearer credential: anyone
              with it can use your feed while that URL is active. Treat the
              downloaded file as private, just as you would the feed address
              itself.
            </p>
          </aside>

          <h3 className="mt-7 font-display text-lg font-semibold text-foreground">
            Not included
          </h3>
          <p className="mt-3 text-sm leading-[1.75] text-foreground-2">
            Device-local history and preferences stay in this browser.
            Anonymous feedback, shared caches, and aggregated analytics are not
            treated as account-owned export data. Generated audio files are not
            embedded in this metadata export.
          </p>

          <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void downloadAccountData()}
              aria-disabled={isPreparing}
              aria-busy={isPreparing}
              aria-describedby={ACTIVE_FEED_WARNING_ID}
              className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-6 py-3 text-sm aria-disabled:cursor-wait aria-disabled:opacity-65"
            >
              <DownloadIcon />
              {isPreparing ? "Preparing export…" : "Download account data"}
            </button>
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent underline underline-offset-4"
            >
              Read the privacy policy
            </Link>
          </div>

          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`mt-4 min-h-6 text-sm leading-6 ${
              exportState === "error" || exportState === "timeout"
                ? "text-critical"
                : "text-muted"
            }`}
          >
            {exportStatusMessage(exportState)}
          </p>
        </div>
      </section>
    </AccountDataFrame>
  );
};

const AccountDataAuthContent = () => {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <LoadingAccountData />;
  if (!isSignedIn) return <SignedOutAccountData />;
  return <SignedInAccountData />;
};

export const AccountDataPage = () => {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return <LocalAccountData />;
  }

  return <AccountDataAuthContent />;
};
