import type { Metadata } from "next";
import Link from "next/link";
import { OnThisDayExplorer } from "@/components/OnThisDayExplorer";

export const metadata: Metadata = {
  title: "On This Day — Curio Garden",
  description:
    "Explore today's historical events, births, deaths, and holidays in an accessible timeline.",
};

export default function OnThisDayPage() {
  return (
    <div className="container mx-auto px-4 pb-20 pt-10">
      <div className="mx-auto max-w-5xl">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted no-underline"
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

        <header className="on-this-day-page-header">
          <p className="eyebrow">A daily walk through history</p>
          <h1 className="font-display text-[clamp(2rem,6vw,3.75rem)] font-bold leading-none text-foreground">
            On This Day
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted">
            Follow today across centuries through Wikipedia&apos;s curated
            highlights, events, notable lives, and holidays. Choose a category,
            then explore at your own pace.
          </p>
        </header>

        <OnThisDayExplorer />
      </div>
    </div>
  );
}
