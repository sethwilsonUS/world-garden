import type { Metadata } from "next";
import Link from "next/link";
import { FeedbackForm } from "@/components/FeedbackForm";
import {
  getProductFeedbackWriteSecret,
  MAX_PRODUCT_FEEDBACK_ARTICLE_REVISION_ID_DIGITS,
  MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
  MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
} from "@/lib/product-feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feedback and research — Curio Garden",
  description:
    "Share accessibility or product feedback and volunteer for Curio Garden research conversations.",
  alternates: { canonical: "/feedback" },
};

const canDeliverProductFeedback = (): boolean =>
  (process.env.NODE_ENV !== "production" &&
    process.env.CURIO_E2E_FEEDBACK_FORM_AVAILABLE === "true") ||
  (process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
    Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim()) &&
    Boolean(getProductFeedbackWriteSecret()));

type FeedbackSearchParams = Record<string, string | string[] | undefined>;

type FeedbackPageProps = {
  searchParams?: Promise<FeedbackSearchParams>;
};

const encoder = new TextEncoder();

const readBoundedSingleLine = (
  value: string | string[] | undefined,
  maxBytes: number,
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    !normalized ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(normalized) ||
    encoder.encode(normalized).byteLength > maxBytes
  ) {
    return undefined;
  }
  return normalized;
};

const parseArticleFeedbackContext = (searchParams: FeedbackSearchParams) => {
  const title = readBoundedSingleLine(
    searchParams.articleTitle,
    MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
  );
  const slug = readBoundedSingleLine(
    searchParams.articleSlug,
    MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
  );
  if (!title || !slug) return undefined;

  const revisionCandidate =
    typeof searchParams.articleRevisionId === "string"
      ? searchParams.articleRevisionId.trim()
      : "";
  const revisionId = new RegExp(
    `^\\d{1,${MAX_PRODUCT_FEEDBACK_ARTICLE_REVISION_ID_DIGITS}}$`,
    "u",
  ).test(revisionCandidate)
    ? revisionCandidate
    : undefined;

  return { title, slug, ...(revisionId ? { revisionId } : {}) };
};

export default async function FeedbackPage({
  searchParams = Promise.resolve({}),
}: FeedbackPageProps) {
  const articleContext = parseArticleFeedbackContext(await searchParams);
  const backHref = articleContext
    ? `/article/${encodeURIComponent(articleContext.slug)}`
    : "/";
  const backLabel = articleContext
    ? `Back to ${articleContext.title}`
    : "Back to the garden";

  return (
    <div className="container mx-auto px-4 pb-20 pt-10">
      <div className="mx-auto max-w-4xl">
        <nav aria-label="Back navigation" className="mb-8">
          <Link
            href={backHref}
            className="inline-flex min-h-8 max-w-full min-w-0 items-center gap-1 text-sm text-muted no-underline"
          >
            <span aria-hidden="true">←</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {backLabel}
            </span>
          </Link>
        </nav>

        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Feedback &amp; research
          </p>
          <h1 className="mt-3 font-display text-[clamp(2.25rem,6vw,4rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground">
            Help the garden learn.
          </h1>
          <p className="mt-5 max-w-2xl text-[1.05rem] leading-[1.8] text-foreground-2">
            Found a barrier, spotted something confusing, or have an idea? Share
            what happened. You can send feedback without signing in, and you
            choose whether to leave contact details. No diagnosis is required.
          </p>
        </header>

        <div className="mt-10 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <FeedbackForm
            deliveryAvailable={canDeliverProductFeedback()}
            articleContext={articleContext}
          />

          <aside
            aria-labelledby="research-note-heading"
            className="rounded-2xl border border-accent-border bg-accent-bg p-5"
          >
            <h2
              id="research-note-heading"
              className="font-display text-xl font-semibold text-foreground"
            >
              A note about research
            </h2>
            <p className="mt-3 text-sm leading-[1.75] text-foreground-2">
              Curio Garden began with one person&apos;s access needs, but one
              experience cannot represent everyone. If you are open to a short
              conversation, check the research box. Sharing feedback does not
              sign you up automatically.
            </p>
            <Link
              href="/privacy#privacy-feedback"
              className="mt-4 inline-flex min-h-11 items-center text-sm text-accent"
            >
              Read how feedback is handled
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
