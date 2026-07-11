import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About the project — Curio Garden",
  description:
    "How Curio Garden turns Wikipedia articles into an accessible listening library and podcast experience.",
};

const engineeringHighlights = [
  {
    title: "Revision-aware Wikipedia ingestion",
    text: "Articles retain their source revision, contributor-history link, citations, related topics, and media provenance while being reshaped for listening.",
  },
  {
    title: "Resilient audio delivery",
    text: "Section-level synthesis, provider-aware caching, resumable playback, downloadable articles, and an Edge TTS fallback keep listening useful when one service is under pressure.",
  },
  {
    title: "Web and podcast, one pipeline",
    text: "The same structured article audio powers browser playback, featured-article episodes, trending briefings, and private personal playlist feeds.",
  },
  {
    title: "Accessibility in the architecture",
    text: "Semantic controls, keyboard navigation, visible focus, live status updates, reduced motion, local persistence, and screen-reader-friendly structure are treated as product behavior.",
  },
];

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 pb-20 pt-10">
      <article className="mx-auto max-w-4xl">
        <nav aria-label="Back navigation" className="mb-8">
          <Link
            href="/"
            className="inline-flex min-h-8 items-center gap-1 text-sm text-muted no-underline"
          >
            <span aria-hidden="true">←</span>
            Back to the garden
          </Link>
        </nav>

        <header className="relative overflow-hidden rounded-[2rem] border border-accent-border bg-surface-2 px-6 py-10 sm:px-10 sm:py-14">
          <div className="pattern-leaves absolute inset-0 opacity-70" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              About this project
            </p>
            <h1 className="mt-4 font-display text-[clamp(2.5rem,7vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.025em] text-foreground">
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

        <section aria-labelledby="why-heading" className="mx-auto mt-14 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            The idea
          </p>
          <h2 id="why-heading" className="mt-2 font-display text-3xl font-semibold text-foreground">
            Curiosity should not depend on a screen.
          </h2>
          <div className="mt-5 space-y-4 text-base leading-[1.8] text-foreground-2">
            <p>
              Reading a long encyclopedia article can be difficult when vision,
              fatigue, mobility, or context makes a visual interface a poor fit.
              Curio Garden treats audio as a first-class way to explore—not an
              afterthought bolted onto a wall of text.
            </p>
            <p>
              It also tries to honor the thing that makes Wikipedia possible:
              transparent sourcing, contributor history, open licenses, and the
              invitation to keep learning beyond this interface.
            </p>
          </div>
        </section>

        <section aria-labelledby="engineering-heading" className="mt-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              Under the garden bed
            </p>
            <h2 id="engineering-heading" className="mt-2 font-display text-3xl font-semibold text-foreground">
              A product, not a prototype shell.
            </h2>
          </div>
          <ol className="mt-7 grid list-none gap-4 p-0 sm:grid-cols-2" role="list">
            {engineeringHighlights.map((highlight, index) => (
              <li key={highlight.title} className="garden-bed relative overflow-hidden p-6">
                <span className="font-mono text-xs text-accent" aria-hidden="true">
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

        <section aria-labelledby="modes-heading" className="mx-auto mt-16 max-w-3xl">
          <h2 id="modes-heading" className="font-display text-3xl font-semibold text-foreground">
            Built to be explored and inspected.
          </h2>
          <p className="mt-5 text-base leading-[1.8] text-foreground-2">
            Local mode works without accounts or a database for quick inspection.
            The full deployment adds Convex caching and storage, Clerk-backed
            accounts, synced libraries, private podcast feeds, analytics, and
            scheduled publishing. The source, tests, setup notes, and tradeoffs
            are available in the public repository.
          </p>
          <a
            href="https://github.com/sethwilsonUS/world-garden"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-7 no-underline"
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
