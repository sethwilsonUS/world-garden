import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About the project — Curio Garden",
  description:
    "How Curio Garden turns Wikipedia articles into an accessible listening library and podcast experience.",
  alternates: { canonical: "/about" },
};

const engineeringHighlights = [
  {
    title: "Revision-aware Wikipedia ingestion",
    text: "Articles retain their source revision, contributor-history link, citations, related topics, and media provenance while being reshaped for listening.",
  },
  {
    title: "Resilient audio delivery",
    text: "Section-level synthesis, provider-aware caching and fallback, resumable playback, and downloadable articles keep listening useful when one service is under pressure.",
  },
  {
    title: "Web and podcast, one pipeline",
    text: "The same structured article audio powers browser playback, featured-article episodes, clearly labeled AI-generated trending briefings, and private personal playlist feeds.",
  },
  {
    title: "Accessibility in the architecture",
    text: "Semantic controls, keyboard navigation, visible focus, live status updates, reduced motion, local persistence, and screen-reader-friendly structure are treated as product behavior.",
  },
];

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 pb-20 pt-10">
      <article className="mx-auto max-w-4xl [overflow-wrap:anywhere]">
        <nav aria-label="Back navigation" className="mb-8">
          <Link
            href="/"
            className="inline-flex min-h-11 max-w-full items-center gap-1 text-sm text-muted no-underline"
          >
            <span aria-hidden="true">←</span>
            Back to the garden
          </Link>
        </nav>

        <header className="relative overflow-hidden rounded-[32px] border border-accent-border bg-surface-2 px-6 py-10 sm:px-10 sm:py-14">
          <div
            className="pattern-leaves absolute inset-0 opacity-70"
            aria-hidden="true"
          />
          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              About this project
            </p>
            <h1 className="type-hero-title mt-4 font-display font-semibold leading-[1.02] tracking-[-0.025em] text-foreground">
              Free knowledge, made listenable.
            </h1>
            <p className="mt-6 max-w-xl text-[1.05rem] leading-[1.8] text-foreground-2">
              Curio Garden is an accessibility-first experiment in turning the
              depth and serendipity of Wikipedia into a calm listening library.
              Search an article, choose a section, save your place, or carry a
              queue into your podcast app.
            </p>
          </div>
        </header>

        <section
          aria-labelledby="why-heading"
          className="mx-auto mt-14 max-w-3xl"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            The idea
          </p>
          <h2
            id="why-heading"
            className="type-section-title-lg mt-2 font-display text-3xl font-semibold text-foreground"
          >
            Curiosity should not depend on a screen.
          </h2>
          <div className="mt-5 space-y-4 text-base leading-[1.8] text-foreground-2">
            <p>
              Curio Garden began with a specific access need. Its founder, Seth
              Wilson, is visually impaired and wanted a calmer way to explore
              long Wikipedia articles by listening without giving up structure,
              source context, or control. That experience made audio the
              starting point—not an afterthought bolted onto a wall of text.
            </p>
            <p>
              That origin is context, not a claim to represent everyone. Blind
              and low-vision people use different tools, have different
              preferences, and encounter different barriers; people affected by
              fatigue, mobility, cognitive access, or a temporary situation add
              still more perspectives. One person&apos;s workflow is one data
              point, so Curio Garden has to keep learning from people whose
              experiences differ from Seth&apos;s.
            </p>
            <p>
              It also tries to honor the thing that makes Wikipedia possible:
              transparent sourcing, contributor history, open licenses, and the
              invitation to keep learning beyond this interface.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="research-heading"
          className="garden-bed mx-auto mt-10 max-w-3xl overflow-hidden p-6 sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Help the garden learn
          </p>
          <h2
            id="research-heading"
            className="type-section-title-lg mt-2 font-display text-2xl font-semibold text-foreground"
          >
            Your experience can shape what grows next.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-[1.8] text-foreground-2">
            If you use a screen reader, magnification, voice control, keyboard
            navigation, or another access approach, Curio Garden would like to
            learn what works and what gets in your way. Product feedback from
            every visitor is welcome, too. You do not need to share a diagnosis,
            and you can choose whether to volunteer for a possible short
            research conversation. Volunteering is not a mailing list or a
            commitment.
          </p>
          <Link
            href="/feedback"
            className="btn-primary mt-6 max-w-full flex-wrap text-center no-underline"
          >
            Share feedback or volunteer for research
          </Link>
        </section>

        <section aria-labelledby="engineering-heading" className="mt-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              Under the garden bed
            </p>
            <h2
              id="engineering-heading"
              className="type-section-title-lg mt-2 font-display text-3xl font-semibold text-foreground"
            >
              A product, not a prototype shell.
            </h2>
          </div>
          <ol
            className="mt-7 grid list-none gap-4 p-0 sm:grid-cols-2"
            role="list"
          >
            {engineeringHighlights.map((highlight, index) => (
              <li
                key={highlight.title}
                className="garden-bed relative overflow-hidden p-6"
              >
                <span
                  className="font-mono text-xs text-accent"
                  aria-hidden="true"
                >
                  0{index + 1}
                </span>
                <h3 className="mt-3 font-display text-xl font-semibold text-foreground">
                  {highlight.title}
                </h3>
                <p className="mt-3 text-sm leading-[1.75] text-foreground-2">
                  {highlight.text}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="ai-transparency-heading"
          className="mx-auto mt-16 max-w-3xl"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Plain-language provenance
          </p>
          <h2
            id="ai-transparency-heading"
            className="type-section-title-lg mt-2 font-display text-3xl font-semibold text-foreground"
          >
            Wikipedia text and generated context stay distinct.
          </h2>
          <div className="mt-5 space-y-4 text-base leading-[1.8] text-foreground-2">
            <p>
              Article text remains tied to an exact Wikipedia revision. Curio
              Garden&apos;s Trending summaries and podcast scripts are generated
              with OpenAI from Wikimedia pageview data and linked reporting;
              they are labeled as AI-generated on the page, in podcast metadata,
              and at the beginning of the audio.
            </p>
            <p>
              Rich context notes start from deterministic source extraction.
              When AI helps make a description clearer, that assistance and the
              model are disclosed beside the source revision. Generated material
              may contain errors, and readers can report a problem from each
              note.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="modes-heading"
          className="mx-auto mt-16 max-w-3xl"
        >
          <h2
            id="modes-heading"
            className="type-section-title-lg font-display text-3xl font-semibold text-foreground"
          >
            Built to be explored and inspected.
          </h2>
          <p className="mt-5 text-base leading-[1.8] text-foreground-2">
            Local mode works without accounts or a database for quick
            inspection. The full deployment adds Convex caching and storage,
            Clerk-backed accounts, synced libraries, private podcast feeds,
            analytics, and scheduled publishing. The source, tests, setup notes,
            and tradeoffs are available in the public repository.
          </p>
          <a
            href="https://github.com/sethwilsonUS/world-garden"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-7 max-w-full flex-wrap text-center no-underline"
          >
            View the source on GitHub
            <span className="sr-only"> (opens in new tab)</span>
            <span aria-hidden="true">↗</span>
          </a>
        </section>

        <aside className="mt-16 rounded-2xl border border-border bg-accent-bg px-6 py-5 text-sm leading-[1.75] text-foreground-2">
          <p>
            Curio Garden was designed and built by{" "}
            <strong className="text-foreground">Seth Wilson</strong>. It is an
            independent project and is not endorsed by or affiliated with the
            Wikimedia Foundation. Wikipedia article text is used under CC BY-SA
            4.0; media may carry separate licenses shown alongside each work.
          </p>
        </aside>
      </article>
    </div>
  );
}
