"use client";

import Link from "next/link";
import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type RefObject,
} from "react";
import {
  MAX_PRODUCT_FEEDBACK_CONTACT_EMAIL_BYTES,
  MAX_PRODUCT_FEEDBACK_ENVIRONMENT_BYTES,
  MAX_PRODUCT_FEEDBACK_MESSAGE_BYTES,
  type ProductFeedbackKind,
} from "@/lib/product-feedback";

type FeedbackFormProps = {
  deliveryAvailable: boolean;
  articleContext?: {
    title: string;
    slug: string;
    revisionId?: string;
  };
};

type ArticleFeedbackContext = NonNullable<FeedbackFormProps["articleContext"]>;

type FeedbackFields = {
  kind: ProductFeedbackKind | "";
  message: string;
  environment: string;
  contactEmail: string;
  researchOptIn: boolean;
};

type FeedbackField = keyof FeedbackFields;
type FieldErrors = Partial<Record<FeedbackField, string>>;

const INITIAL_FIELDS: FeedbackFields = {
  kind: "",
  message: "",
  environment: "",
  contactEmail: "",
  researchOptIn: false,
};

const encoder = new TextEncoder();

const RESEARCH_EMAIL_ERROR =
  "Add an email address so a research invitation can reach you.";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/u;

const utf8Length = (value: string): number => encoder.encode(value).byteLength;

const validateFields = (fields: FeedbackFields): FieldErrors => {
  const errors: FieldErrors = {};
  const message = fields.message.trim();
  const environment = fields.environment.trim();
  const email = fields.contactEmail.trim();

  if (!fields.kind) {
    errors.kind = "Choose what kind of feedback you are sharing.";
  }
  if (!message) {
    errors.message = "Tell us what you would like Curio Garden to know.";
  } else if (utf8Length(message) > MAX_PRODUCT_FEEDBACK_MESSAGE_BYTES) {
    errors.message =
      "Please shorten your feedback. Some characters use more space than others.";
  }
  if (
    utf8Length(environment) > MAX_PRODUCT_FEEDBACK_ENVIRONMENT_BYTES
  ) {
    errors.environment = "Please shorten the browser or access-tool details.";
  }
  if (fields.researchOptIn && !email) {
    errors.contactEmail = RESEARCH_EMAIL_ERROR;
  } else if (
    utf8Length(email) > MAX_PRODUCT_FEEDBACK_CONTACT_EMAIL_BYTES
  ) {
    errors.contactEmail =
      "Please shorten the email address. Some characters use more space than others.";
  } else if (email && (!EMAIL_PATTERN.test(email) || email.includes(".."))) {
    errors.contactEmail =
      "Enter an email address in a format like name@example.com.";
  }

  return errors;
};

const responseError = async (response: Response): Promise<string> => {
  if (response.status === 429) {
    return "Feedback is being sent too often. Please wait and try again later.";
  }
  if (response.status === 503) {
    return "The feedback form is temporarily unavailable. Your words are still here, so you can try again later.";
  }
  if (response.status === 400) {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (
        typeof body.error === "string" &&
        body.error.trim().length > 0 &&
        body.error.length <= 200
      ) {
        return body.error;
      }
    } catch {
      // Use the stable validation message below for malformed responses.
    }
    return "Some feedback fields need attention. Review the form and try again.";
  }
  return "Your feedback could not be sent. Your words are still here; check your connection and try again.";
};

const describedBy = (helpId: string, errorId: string, hasError: boolean) =>
  hasError ? `${helpId} ${errorId}` : helpId;

const ArticleContextSummary = ({
  articleContext,
}: {
  articleContext: ArticleFeedbackContext;
}) => (
  <section
    aria-labelledby="feedback-article-heading"
    className="mt-6 rounded-xl border border-border bg-surface px-4 py-3"
  >
    <p
      id="feedback-article-heading"
      className="text-xs font-semibold uppercase tracking-[0.14em] text-accent"
    >
      Feedback on this article
    </p>
    <p className="mt-1 font-semibold text-foreground [overflow-wrap:anywhere]">
      {articleContext.title}
    </p>
    {articleContext.revisionId ? (
      <p className="mt-1 font-mono text-xs text-muted">
        Wikipedia revision {articleContext.revisionId}
      </p>
    ) : null}
  </section>
);

export const FeedbackForm = ({
  deliveryAvailable,
  articleContext,
}: FeedbackFormProps) => {
  const [fields, setFields] = useState<FeedbackFields>(INITIAL_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [sending, setSending] = useState(false);
  const submittingRef = useRef(false);
  const kindRef = useRef<HTMLSelectElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const environmentRef = useRef<HTMLInputElement>(null);
  const contactEmailRef = useRef<HTMLInputElement>(null);

  const focusFirstInvalidField = (errors: FieldErrors) => {
    const refs: Array<[FeedbackField, RefObject<HTMLElement | null>]> = [
      ["kind", kindRef],
      ["message", messageRef],
      ["environment", environmentRef],
      ["contactEmail", contactEmailRef],
    ];
    const target = refs.find(([field]) => errors[field])?.[1].current;
    requestAnimationFrame(() => target?.focus());
  };

  const updateText =
    (field: Exclude<FeedbackField, "kind" | "researchOptIn">) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      if (sending) return;
      setFields((current) => ({ ...current, [field]: event.target.value }));
      setFieldErrors((current) => ({ ...current, [field]: undefined }));
      setRequestError("");
      setSuccessMessage("");
    };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const errors = validateFields(fields);
    setFieldErrors(errors);
    setRequestError("");
    setSuccessMessage("");
    if (Object.keys(errors).length > 0) {
      focusFirstInvalidField(errors);
      return;
    }

    submittingRef.current = true;
    setSending(true);
    try {
      const environment = fields.environment.trim();
      const contactEmail = fields.contactEmail.trim();
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: fields.kind,
          message: fields.message.trim(),
          ...(environment ? { environment } : {}),
          ...(contactEmail ? { contactEmail } : {}),
          researchOptIn: fields.researchOptIn,
          ...(articleContext
            ? {
                articleTitle: articleContext.title,
                articleSlug: articleContext.slug,
                ...(articleContext.revisionId
                  ? { articleRevisionId: articleContext.revisionId }
                  : {}),
              }
            : {}),
        }),
      });

      if (!response.ok) {
        setRequestError(await responseError(response));
        return;
      }

      const result = (await response.json()) as { accepted?: unknown };
      if (response.status !== 202 || result.accepted !== true) {
        setRequestError(
          "Your feedback could not be confirmed. Your words are still here; please try again.",
        );
        return;
      }

      setFields(INITIAL_FIELDS);
      setFieldErrors({});
      setSuccessMessage("Thank you. Your feedback was sent.");
    } catch {
      setRequestError(
        "Your feedback could not be sent. Your words are still here; check your connection and try again.",
      );
    } finally {
      submittingRef.current = false;
      setSending(false);
    }
  };

  if (!deliveryAvailable) {
    return (
      <section
        aria-labelledby="feedback-form-heading"
        className="garden-bed min-w-0 p-5 sm:p-7"
      >
        <h2
          id="feedback-form-heading"
          className="font-display text-2xl font-semibold text-foreground"
        >
          Share feedback
        </h2>
        {articleContext ? (
          <ArticleContextSummary articleContext={articleContext} />
        ) : null}
        <p className="mt-3 leading-[1.75] text-foreground-2">
          The feedback form is temporarily unavailable. Nothing has been
          recorded.
        </p>
        <p className="mt-3 leading-[1.75] text-foreground-2">
          You can use{" "}
          <a
            href="https://github.com/sethwilsonUS/world-garden/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            GitHub Discussions
            <span className="sr-only"> (opens in a new tab)</span>
          </a>{" "}
          instead. Discussions are public and require a GitHub account, so
          please do not include private information.
        </p>
      </section>
    );
  }

  return (
    <form
      className="garden-bed min-w-0 p-5 sm:p-7"
      noValidate
      aria-labelledby="feedback-form-heading"
      aria-busy={sending}
      onSubmit={submit}
    >
      <h2
        id="feedback-form-heading"
        className="font-display text-2xl font-semibold text-foreground"
      >
        Share feedback
      </h2>
      <p className="mt-2 text-sm text-muted">
        Fields marked required must be completed.
      </p>

      {articleContext ? (
        <ArticleContextSummary articleContext={articleContext} />
      ) : null}

      <div className="mt-7">
        <label
          htmlFor="feedback-kind"
          className="font-semibold text-foreground"
        >
          What are you sharing?{" "}
          <span className="font-normal text-muted">(required)</span>
        </label>
        <select
          ref={kindRef}
          id="feedback-kind"
          name="kind"
          required
          aria-disabled={sending}
          value={fields.kind}
          aria-describedby={
            fieldErrors.kind ? "feedback-kind-error" : undefined
          }
          aria-invalid={fieldErrors.kind ? true : undefined}
          onChange={(event) => {
            if (sending) return;
            setFields((current) => ({
              ...current,
              kind: event.target.value as ProductFeedbackKind | "",
            }));
            setFieldErrors((current) => ({
              ...current,
              kind: undefined,
            }));
            setRequestError("");
            setSuccessMessage("");
          }}
          className="input-field mt-3"
        >
          <option value="">Choose the closest match</option>
          <option value="accessibility">
            Accessibility or ease-of-use barrier
          </option>
          <option value="product">Product idea or general feedback</option>
          <option value="technical">Something isn&apos;t working</option>
          <option value="other">Something else</option>
        </select>
        {fieldErrors.kind ? (
          <p
            id="feedback-kind-error"
            className="mt-2 text-sm font-semibold text-critical"
          >
            {fieldErrors.kind}
          </p>
        ) : null}
      </div>

      <div className="mt-7">
        <label
          htmlFor="feedback-message"
          className="font-semibold text-foreground"
        >
          What would you like us to know?{" "}
          <span className="font-normal text-muted">(required)</span>
        </label>
        <p id="feedback-message-help" className="mt-1 text-sm text-muted">
          If you hit a barrier, tell us what you were trying to do. Share only
          what you are comfortable sharing. Up to about 4,000 characters.
        </p>
        <textarea
          ref={messageRef}
          id="feedback-message"
          name="message"
          required
          readOnly={sending}
          aria-disabled={sending}
          rows={7}
          maxLength={MAX_PRODUCT_FEEDBACK_MESSAGE_BYTES}
          value={fields.message}
          aria-describedby={describedBy(
            "feedback-message-help",
            "feedback-message-error",
            Boolean(fieldErrors.message),
          )}
          aria-invalid={fieldErrors.message ? true : undefined}
          onChange={updateText("message")}
          className="input-field mt-3 min-h-44 resize-y"
        />
        {fieldErrors.message ? (
          <p
            id="feedback-message-error"
            className="mt-2 text-sm font-semibold text-critical"
          >
            {fieldErrors.message}
          </p>
        ) : null}
      </div>

      <div className="mt-7">
        <label
          htmlFor="feedback-environment"
          className="font-semibold text-foreground"
        >
          Browser, device, or access tools{" "}
          <span className="font-normal text-muted">(optional)</span>
        </label>
        <p id="feedback-environment-help" className="mt-1 text-sm text-muted">
          For example: VoiceOver with Safari on iPhone, NVDA with Firefox,
          keyboard only, or 400% zoom. Curio Garden does not add these details
          automatically.
        </p>
        <input
          ref={environmentRef}
          id="feedback-environment"
          name="environment"
          type="text"
          readOnly={sending}
          aria-disabled={sending}
          maxLength={MAX_PRODUCT_FEEDBACK_ENVIRONMENT_BYTES}
          value={fields.environment}
          aria-describedby={describedBy(
            "feedback-environment-help",
            "feedback-environment-error",
            Boolean(fieldErrors.environment),
          )}
          aria-invalid={fieldErrors.environment ? true : undefined}
          onChange={updateText("environment")}
          className="input-field mt-3"
        />
        {fieldErrors.environment ? (
          <p
            id="feedback-environment-error"
            className="mt-2 text-sm font-semibold text-critical"
          >
            {fieldErrors.environment}
          </p>
        ) : null}
      </div>

      <fieldset className="mt-7 rounded-xl border border-accent-border bg-accent-bg p-4">
        <legend className="px-1 font-display text-lg font-semibold text-foreground">
          Contact and research
        </legend>
        <label
          htmlFor="feedback-email"
          className="mt-1 block font-semibold text-foreground"
        >
          Email address{" "}
          <span className="font-normal text-muted">
            (optional unless you volunteer for research)
          </span>
        </label>
        <p id="feedback-email-help" className="mt-1 text-sm text-muted">
          Add an email if you want a reply. It is required if you check the
          research box.
        </p>
        <input
          ref={contactEmailRef}
          id="feedback-email"
          name="contactEmail"
          type="email"
          readOnly={sending}
          aria-disabled={sending}
          inputMode="email"
          autoComplete="email"
          maxLength={MAX_PRODUCT_FEEDBACK_CONTACT_EMAIL_BYTES}
          value={fields.contactEmail}
          aria-describedby={describedBy(
            "feedback-email-help",
            "feedback-email-error",
            Boolean(fieldErrors.contactEmail),
          )}
          aria-invalid={fieldErrors.contactEmail ? true : undefined}
          onChange={updateText("contactEmail")}
          className="input-field mt-3"
        />
        {fieldErrors.contactEmail ? (
          <p
            id="feedback-email-error"
            className="mt-2 text-sm font-semibold text-critical"
          >
            {fieldErrors.contactEmail}
          </p>
        ) : null}

        <label
          htmlFor="feedback-research"
          className="mt-5 flex min-h-11 cursor-pointer items-start gap-3"
        >
          <input
            id="feedback-research"
            name="researchOptIn"
            type="checkbox"
            aria-disabled={sending}
            checked={fields.researchOptIn}
            onChange={(event) => {
              if (sending) return;
              const researchOptIn = event.target.checked;
              setFields((current) => ({ ...current, researchOptIn }));
              setFieldErrors((current) => ({
                ...current,
                contactEmail:
                  !researchOptIn &&
                  current.contactEmail === RESEARCH_EMAIL_ERROR
                    ? undefined
                    : current.contactEmail,
              }));
              setRequestError("");
              setSuccessMessage("");
            }}
            className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="min-w-0 text-sm leading-[1.6] text-foreground-2">
            <span className="block font-semibold text-foreground">
              I&apos;m open to a short product research conversation.
            </span>
            This is an invitation, not a commitment. Seth may email you about a
            20–30 minute conversation; you can decline or stop at any time.
          </span>
        </label>
      </fieldset>

      <p className="mt-6 text-xs leading-[1.6] text-muted">
        Please do not include passwords, private podcast feed links, or other
        secrets.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className={`btn-primary min-h-11 w-full sm:w-auto ${
            sending ? "cursor-not-allowed opacity-60" : ""
          }`}
          aria-disabled={sending}
        >
          {sending ? "Sending…" : "Send feedback"}
        </button>
        <Link href="/privacy#privacy-feedback" className="text-sm text-accent">
          Read how feedback is handled
        </Link>
      </div>

      <p
        role="alert"
        aria-atomic="true"
        className="mt-5 text-sm text-critical empty:hidden"
      >
        {requestError}
      </p>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-3 text-sm font-semibold text-foreground empty:hidden"
      >
        {sending ? "Sending feedback." : successMessage}
      </p>
      {successMessage && articleContext ? (
        <Link
          href={`/article/${encodeURIComponent(articleContext.slug)}`}
          className="mt-3 inline-flex min-h-11 max-w-full min-w-0 items-center text-sm font-semibold text-accent underline underline-offset-2"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Return to {articleContext.title}
          </span>
        </Link>
      ) : null}
    </form>
  );
};
