import type { Metadata } from "next";
import Link from "next/link";
import { DidYouKnowAudioPlayer } from "@/components/DidYouKnowAudioPlayer";
import { fetchWikipediaFeaturedSnapshot } from "@/lib/featured-article";

export const metadata: Metadata = {
  title: "Did you know? — Curio Garden",
  description:
    "Daily Wikipedia facts, with the linked articles routed back into Curio Garden.",
};

export const revalidate = 900;

function formatFeedDate(isoDate: string): string {
  try {
    const date = new Date(`${isoDate}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return isoDate;

    return date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

export default async function DidYouKnowPage() {
  const { didYouKnow, feedDateIso } = await fetchWikipediaFeaturedSnapshot();

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted text-sm no-underline"
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
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </nav>

        <section aria-labelledby="did-you-know-heading">
          <div className="mb-8">
            <h1
              id="did-you-know-heading"
              className="font-display text-[2rem] sm:text-[2.45rem] font-bold mb-4 text-foreground leading-[1.05]"
            >
              Did you know?
            </h1>

            <p className="text-[1.04rem] leading-[1.78] text-foreground-2 max-w-3xl">
              Daily curiosity prompts from Wikipedia&apos;s featured feed, with
              article links routed back into Curio Garden.
            </p>

            <p className="text-muted text-xs mt-3" aria-live="polite">
              Last updated: {formatFeedDate(feedDateIso)}
            </p>
          </div>

          <DidYouKnowAudioPlayer feedDateIso={feedDateIso} />

          {didYouKnow.length === 0 ? (
            <div className="garden-bed p-6">
              <p className="text-sm leading-[1.7] text-foreground-2">
                Wikipedia didn&apos;t return any Did you know items for this feed
                right now. The garden is momentarily out of trivia.
              </p>
            </div>
          ) : (
            <ol className="list-none p-0 m-0 space-y-4">
              {didYouKnow.map((item, index) => (
                <li key={`${feedDateIso}-${index}`}>
                  <article className="garden-bed p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                      <span
                        aria-hidden="true"
                        className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent-border bg-accent-bg text-sm font-semibold text-accent"
                      >
                        {index + 1}
                      </span>

                      <p className="min-w-0 text-[1.02rem] leading-[1.95] text-foreground-2">
                        {item.segments.map((segment, segmentIndex) =>
                          segment.type === "link" ? (
                            <Link
                              key={`${index}-${segmentIndex}-${segment.slug}`}
                              href={`/article/${encodeURIComponent(segment.slug)}`}
                              className="text-accent underline decoration-accent/50 underline-offset-[0.16em]"
                            >
                              {segment.text}
                            </Link>
                          ) : (
                            <span key={`${index}-${segmentIndex}`}>
                              {segment.text}
                            </span>
                          ),
                        )}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="did-you-know-source-heading"
          className="mt-10 garden-bed p-5 sm:p-6"
        >
          <h2
            id="did-you-know-source-heading"
            className="font-display text-[1.2rem] font-semibold text-foreground"
          >
            Source
          </h2>
          <p className="text-sm leading-[1.75] text-foreground-2 mt-3">
            These facts come from Wikipedia&apos;s daily featured feed. The inline
            article links above point into Curio Garden, but the underlying
            content is still Wikipedia content under CC BY-SA.
          </p>
          <p className="mt-3">
            <a
              href="https://en.wikipedia.org/wiki/Main_Page"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent underline"
            >
              View Wikipedia&apos;s Main Page
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
