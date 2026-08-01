"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";

type AccountDeletionResult = { status: "deleted" } | { status: "pending" };

type AccountDeletionState =
  | "idle"
  | "submitting"
  | "cancelled"
  | "error"
  | "uncertain";

class AccountDeletionRequestError extends Error {
  constructor(readonly outcome: "not-started" | "uncertain") {
    super("Account deletion request failed");
    this.name = "AccountDeletionRequestError";
  }
}

const isJsonResponse = (response: Response): boolean =>
  response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";

const normalizeDeletionResult = (
  value: unknown,
): AccountDeletionResult | null => {
  if (!value || typeof value !== "object") return null;
  const result = value as {
    status?: unknown;
    deleted?: unknown;
    deletionRequested?: unknown;
  };

  if (result.status === "deleted" || result.deleted === true) {
    return { status: "deleted" };
  }
  if (result.status === "pending" || result.deletionRequested === true) {
    return { status: "pending" };
  }
  return null;
};

const hasUncertainDeletionOutcome = (value: unknown): boolean =>
  Boolean(
    value &&
    typeof value === "object" &&
    "outcome" in value &&
    value.outcome === "uncertain",
  );

const deletionStatusMessage = (state: AccountDeletionState): string => {
  switch (state) {
    case "submitting":
      return "Verifying your identity and starting account deletion.";
    case "cancelled":
      return "Verification was canceled. Your account was not deleted.";
    case "error":
      return "Your account could not be deleted. Nothing was changed. Please try again.";
    case "uncertain":
      return "We could not confirm whether the deletion request reached Curio Garden. Reload the page to check your sign-in, then try again if needed.";
    default:
      return "";
  }
};

type AccountDeletionPanelProps = {
  navigateToResult?: (href: string) => void;
};

export const AccountDeletionPanel = ({
  navigateToResult = (href) => window.location.replace(href),
}: AccountDeletionPanelProps) => {
  const disclosureId = useId();
  const disclosureHeadingId = useId();
  const consequencesId = useId();
  const checkboxErrorId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const disclosureHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const activeSubmissionRef = useRef(false);
  const isMountedRef = useRef(true);
  const shouldRestoreFocusRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [showCheckboxError, setShowCheckboxError] = useState(false);
  const [deletionState, setDeletionState] =
    useState<AccountDeletionState>("idle");
  const isSubmitting = deletionState === "submitting";

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      disclosureHeadingRef.current?.focus();
      return;
    }
    if (!shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    openerRef.current?.focus();
  }, [isOpen]);

  const requestAccountDeletion = useCallback(async () => {
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });

      if (response.status === 403) {
        // Clerk's useReverification hook consumes the exact 403 JSON hint and
        // retries this request after its verification dialog succeeds.
        return response;
      }
      if (response.redirected || !isJsonResponse(response)) {
        throw new AccountDeletionRequestError("uncertain");
      }

      const payload = (await response.json()) as unknown;
      if (hasUncertainDeletionOutcome(payload)) {
        throw new AccountDeletionRequestError("uncertain");
      }
      const result = normalizeDeletionResult(payload);
      if (response.status === 200 && result?.status === "deleted") {
        return result;
      }
      if (response.status === 202 && result?.status === "pending") {
        return result;
      }
      if (response.ok) {
        throw new AccountDeletionRequestError("uncertain");
      }
      throw new AccountDeletionRequestError("not-started");
    } catch (error) {
      if (error instanceof AccountDeletionRequestError) throw error;
      throw new AccountDeletionRequestError("uncertain");
    }
  }, []);

  const requestDeletionWithReverification = useReverification(
    requestAccountDeletion,
  );

  const resetAndClose = () => {
    if (isSubmitting) return;
    shouldRestoreFocusRef.current = true;
    setHasConfirmed(false);
    setShowCheckboxError(false);
    setDeletionState("idle");
    setIsOpen(false);
  };

  const submitDeletion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeSubmissionRef.current || isSubmitting) return;

    if (!confirmationRef.current?.checked) {
      setShowCheckboxError(true);
      confirmationRef.current?.focus();
      return;
    }

    activeSubmissionRef.current = true;
    setShowCheckboxError(false);
    setDeletionState("submitting");
    deleteButtonRef.current?.focus();

    try {
      const rawResult = await requestDeletionWithReverification();
      const result =
        rawResult instanceof Response
          ? null
          : normalizeDeletionResult(rawResult);
      if (!result) {
        throw new AccountDeletionRequestError("not-started");
      }
      if (!isMountedRef.current) return;

      navigateToResult(
        result.status === "deleted"
          ? "/account/deleted"
          : "/account/deletion-pending",
      );
    } catch (error) {
      if (!isMountedRef.current) return;
      if (isReverificationCancelledError(error)) {
        setDeletionState("cancelled");
      } else if (
        error instanceof AccountDeletionRequestError &&
        error.outcome === "uncertain"
      ) {
        setDeletionState("uncertain");
      } else {
        setDeletionState("error");
      }
      deleteButtonRef.current?.focus();
    } finally {
      activeSubmissionRef.current = false;
    }
  };

  return (
    <section
      aria-labelledby="account-deletion-heading"
      className="garden-bed overflow-hidden border-critical/35"
    >
      <div className="border-b border-critical/25 bg-surface-2 p-6 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-critical">
          Permanent action
        </p>
        <h2
          id="account-deletion-heading"
          className="type-section-title-lg mt-2 font-display text-[1.5rem] font-semibold leading-[1.2] text-foreground"
        >
          Delete account
        </h2>
        <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
          Delete your Curio Garden sign-in and the server-side information
          connected to it. You can{" "}
          <a
            href="#account-export-heading"
            className="font-semibold text-accent underline underline-offset-4"
          >
            download an export first
          </a>
          .
        </p>
      </div>

      <div className="p-6 sm:p-7">
        <button
          ref={openerRef}
          type="button"
          aria-controls={disclosureId}
          aria-expanded={isOpen}
          disabled={isSubmitting}
          onClick={() => {
            if (isOpen) {
              resetAndClose();
              return;
            }
            setHasConfirmed(false);
            setShowCheckboxError(false);
            setDeletionState("idle");
            setIsOpen(true);
          }}
          className="btn-critical inline-flex min-h-11 items-center justify-center px-5 py-2.5 text-sm"
        >
          Delete account…
        </button>

        {isOpen ? (
          <div
            id={disclosureId}
            aria-labelledby={disclosureHeadingId}
            className="mt-6 rounded-2xl border border-critical/35 bg-surface px-5 py-5 sm:px-6 sm:py-6"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isSubmitting) {
                event.preventDefault();
                resetAndClose();
              }
            }}
          >
            <h3
              ref={disclosureHeadingRef}
              id={disclosureHeadingId}
              tabIndex={-1}
              className="font-display text-[1.25rem] font-semibold leading-[1.3] text-foreground"
            >
              Permanently delete your account?
            </h3>
            <p
              id={consequencesId}
              className="mt-3 text-sm font-semibold leading-[1.7] text-critical"
            >
              This cannot be undone.
            </p>

            <h4 className="mt-5 font-display text-lg font-semibold text-foreground">
              Curio Garden will delete
            </h4>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-[1.75] text-foreground-2">
              <li>Your Curio Garden sign-in and account profile.</li>
              <li>
                Signed-in bookmarks, listening progress, and topic-badge credit.
              </li>
              <li>
                Your Personal Playlist, its account-linked generated episode
                files, and private RSS feed access.
              </li>
              <li>
                Account-linked article-audio exports, generated files, and
                generation quota records.
              </li>
            </ul>

            <h4 className="mt-5 font-display text-lg font-semibold text-foreground">
              This will not remove
            </h4>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-[1.75] text-foreground-2">
              <li>
                History and preferences stored only in this browser. You can
                clear those through your browser settings.
              </li>
              <li>
                Audio or account-data files already downloaded to a device.
              </li>
              <li>
                Anonymous feedback, shared article and audio caches, or
                aggregated analytics that are not account-owned.
              </li>
            </ul>

            <form
              aria-label="Confirm account deletion"
              aria-busy={isSubmitting}
              className="mt-6 border-t border-border pt-5"
              noValidate
              onSubmit={(event) => void submitDeletion(event)}
            >
              <label className="flex cursor-pointer items-start gap-3 text-sm font-semibold leading-[1.65] text-foreground">
                <input
                  ref={confirmationRef}
                  type="checkbox"
                  required
                  checked={hasConfirmed}
                  disabled={isSubmitting}
                  aria-invalid={showCheckboxError}
                  aria-describedby={
                    showCheckboxError
                      ? `${consequencesId} ${checkboxErrorId}`
                      : consequencesId
                  }
                  onChange={(event) => {
                    setHasConfirmed(event.currentTarget.checked);
                    if (event.currentTarget.checked) {
                      setShowCheckboxError(false);
                    }
                  }}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--color-critical)]"
                />
                <span>
                  I understand this permanently deletes my Curio Garden account
                  and signed-in data.
                </span>
              </label>

              {showCheckboxError ? (
                <p
                  id={checkboxErrorId}
                  role="alert"
                  className="mt-3 text-sm font-semibold text-critical"
                >
                  Check the confirmation box before deleting your account.
                </p>
              ) : null}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={resetAndClose}
                  className="btn-secondary min-h-11 px-5 py-2.5 text-sm"
                >
                  Keep my account
                </button>
                <button
                  ref={deleteButtonRef}
                  type="submit"
                  disabled={!hasConfirmed}
                  aria-disabled={!hasConfirmed || isSubmitting}
                  aria-busy={isSubmitting}
                  aria-describedby={consequencesId}
                  className="btn-critical min-h-11 px-5 py-2.5 text-sm aria-disabled:cursor-wait aria-disabled:opacity-65"
                >
                  {isSubmitting
                    ? "Deleting account…"
                    : "Permanently delete account"}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            isOpen
              ? `mt-4 min-h-6 text-sm leading-[1.7] ${
                  deletionState === "error" ||
                  deletionState === "uncertain" ||
                  deletionState === "cancelled"
                    ? "text-critical"
                    : "text-muted"
                }`
              : "sr-only"
          }
        >
          {deletionStatusMessage(deletionState)}
        </p>

        <p className="mt-4 text-sm leading-[1.7] text-muted">
          Questions before deleting? Read the{" "}
          <Link
            href="/privacy#privacy-choices"
            className="font-semibold text-accent underline underline-offset-4"
          >
            privacy choices
          </Link>
          .
        </p>
      </div>
    </section>
  );
};
