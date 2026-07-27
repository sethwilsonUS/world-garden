"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PodcastFeedActions } from "@/components/PodcastFeedActions";

type PrivateFeedStatus = "not_created" | "active" | "revoked";
type ConfirmationKind = "rotate" | "revoke";

type PrivateFeedAccessControlsProps = {
  feedStatus: PrivateFeedStatus;
  feedUrl: string | null;
  isUpdating: boolean;
  onRotate: () => Promise<void>;
  onRevoke: () => Promise<void>;
};

const statusContent: Record<
  PrivateFeedStatus,
  { label: string; title: string; description: string }
> = {
  not_created: {
    label: "Not created",
    title: "Create your private feed",
    description:
      "Create a private RSS feed URL when you want to follow your Curio Garden playlist in a podcast app.",
  },
  active: {
    label: "Active",
    title: "Your private feed is active",
    description:
      "Anyone with this URL can listen to your playlist. Treat it like a password and replace it if it is shared accidentally.",
  },
  revoked: {
    label: "Off",
    title: "Your private feed is off",
    description:
      "Your playlist remains in Curio Garden. You can create a new private feed URL whenever you are ready to subscribe again.",
  },
};

const confirmationContent: Record<
  ConfirmationKind,
  {
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel: string;
    failureMessage: string;
  }
> = {
  rotate: {
    title: "Replace this private feed URL?",
    description:
      "The old subscription stops working when the URL is replaced. Audio that a podcast app already downloaded or cached remains there.",
    confirmLabel: "Yes, replace URL",
    pendingLabel: "Replacing URL…",
    failureMessage: "The private feed URL could not be replaced. Try again.",
  },
  revoke: {
    title: "Turn off this private feed?",
    description:
      "Your playlist remains in Curio Garden. The feed URL stops working, but downloaded, cached, or previously accessed copies cannot be recalled.",
    confirmLabel: "Yes, turn off feed",
    pendingLabel: "Turning off feed…",
    failureMessage: "The private feed could not be turned off. Try again.",
  },
};

export const PrivateFeedAccessControls = ({
  feedStatus,
  feedUrl,
  isUpdating,
  onRotate,
  onRevoke,
}: PrivateFeedAccessControlsProps) => {
  const disclosureId = useId();
  const disclosureTitleId = useId();
  const disclosureDescriptionId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const [confirmation, setConfirmation] = useState<ConfirmationKind | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const isBusy = isUpdating || isSubmitting;
  const content = statusContent[feedStatus];

  useEffect(() => {
    if (confirmation) {
      confirmButtonRef.current?.focus();
      return;
    }

    if (!shouldRestoreFocusRef.current || isBusy) return;
    shouldRestoreFocusRef.current = false;

    const opener = openerRef.current;
    if (opener?.isConnected) {
      opener.focus();
    } else {
      rootRef.current?.focus();
    }
  }, [confirmation, isBusy]);

  const closeConfirmation = () => {
    shouldRestoreFocusRef.current = true;
    setConfirmation(null);
  };

  const openConfirmation = (
    kind: ConfirmationKind,
    opener: HTMLButtonElement,
  ) => {
    openerRef.current = opener;
    setErrorMessage("");
    setConfirmation(kind);
  };

  const runCreate = async () => {
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      await onRotate();
    } catch {
      setErrorMessage("The private feed URL could not be created. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmation) return;
    const currentConfirmation = confirmation;
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      if (currentConfirmation === "rotate") {
        await onRotate();
      } else {
        await onRevoke();
      }
      closeConfirmation();
    } catch {
      setErrorMessage(confirmationContent[currentConfirmation].failureMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-busy={isBusy}
      aria-labelledby={`${disclosureId}-heading`}
      className="rounded-2xl border border-border bg-surface px-5 py-5 sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Private RSS access
          </p>
          <h3
            id={`${disclosureId}-heading`}
            className="mt-2 font-display text-[1.2rem] font-semibold leading-[1.25] text-foreground"
          >
            {content.title}
          </h3>
        </div>
        <span
          className={`inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] ${
            feedStatus === "active"
              ? "border-accent-border bg-accent-bg text-accent"
              : "border-border bg-surface-2 text-muted"
          }`}
        >
          {content.label}
        </span>
      </div>

      <p className="mt-3 text-sm leading-[1.7] text-foreground-2">
        {content.description}
      </p>

      {feedStatus === "active" ? (
        <>
          {feedUrl ? (
            <>
              <code
                aria-label="Private playlist feed URL"
                className="mt-4 block overflow-x-auto rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-foreground"
              >
                {feedUrl}
              </code>
              <PodcastFeedActions
                feedUrl={feedUrl}
                feedTitle="Personal Playlist"
              />
            </>
          ) : (
            <p className="mt-4 text-sm leading-[1.7] text-muted" role="status">
              Your private feed address is refreshing.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              aria-controls={disclosureId}
              aria-expanded={confirmation === "rotate"}
              disabled={isBusy}
              onClick={(event) =>
                openConfirmation("rotate", event.currentTarget)
              }
              className="btn-secondary inline-flex min-h-11 items-center justify-center px-4 py-2.5 text-sm"
            >
              Replace URL
            </button>
            <button
              type="button"
              aria-controls={disclosureId}
              aria-expanded={confirmation === "revoke"}
              disabled={isBusy}
              onClick={(event) =>
                openConfirmation("revoke", event.currentTarget)
              }
              className="btn-secondary inline-flex min-h-11 items-center justify-center px-4 py-2.5 text-sm"
            >
              Turn off feed
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void runCreate()}
          className="btn-primary mt-5 inline-flex min-h-11 items-center justify-center px-5 py-2.5 text-sm"
        >
          {isBusy ? "Creating private feed URL…" : "Create private feed URL"}
        </button>
      )}

      {confirmation ? (
        <section
          id={disclosureId}
          aria-labelledby={disclosureTitleId}
          aria-describedby={disclosureDescriptionId}
          className="mt-5 rounded-xl border border-accent-border bg-accent-bg p-4 sm:p-5"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isBusy) {
              event.preventDefault();
              closeConfirmation();
            }
          }}
        >
          <h4
            id={disclosureTitleId}
            className="font-display text-[1.08rem] font-semibold leading-[1.3] text-foreground"
          >
            {confirmationContent[confirmation].title}
          </h4>
          <p
            id={disclosureDescriptionId}
            className="mt-2 text-sm leading-[1.7] text-foreground-2"
          >
            {confirmationContent[confirmation].description}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              ref={confirmButtonRef}
              type="button"
              disabled={isBusy}
              onClick={() => void runConfirmedAction()}
              className="btn-primary inline-flex min-h-11 items-center justify-center px-5 py-2.5 text-sm"
            >
              {isBusy
                ? confirmationContent[confirmation].pendingLabel
                : confirmationContent[confirmation].confirmLabel}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={closeConfirmation}
              className="btn-secondary inline-flex min-h-11 items-center justify-center px-5 py-2.5 text-sm"
            >
              Keep current feed
            </button>
          </div>
        </section>
      ) : null}

      {isBusy ? (
        <p className="mt-4 text-sm text-muted" role="status">
          Updating private feed…
        </p>
      ) : null}
      {errorMessage ? (
        <p className="alert-banner alert-error mt-4 text-sm" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
};
