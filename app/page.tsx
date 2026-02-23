"use client";

import { SearchForm } from "@/components/SearchForm";
import { RecentlyListened } from "@/components/RecentlyListened";
import { FeaturedArticle } from "@/components/FeaturedArticle";
import { CuriousAbout } from "@/components/CuriousAbout";
import { RandomArticleButton } from "@/components/RandomArticleButton";

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-[100px]">
      <section
        className="max-w-xl mx-auto text-center"
        aria-labelledby="hero-heading"
      >
        <div className="animate-fade-in-up mb-12">
          <div className="inline-flex items-center gap-2 py-[6px] px-3.5 rounded-full bg-accent-bg border border-accent-border mb-7 text-[0.8125rem] text-accent font-semibold tracking-[0.01em]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={15}
              height={15}
              aria-hidden="true"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            Audio-first Wikipedia
          </div>

          <h1
            id="hero-heading"
            className="font-display text-[clamp(2.75rem,7vw,5rem)] font-semibold leading-[1.05] mb-6 text-foreground tracking-[-0.02em]"
          >
            World Garden
          </h1>

          <p className="text-lg leading-[1.7] text-foreground-2 max-w-[440px] mx-auto">
            Plant a seed of curiosity. Search for any topic and listen to it
            read aloud.
          </p>
        </div>

        <div className="animate-fade-in-up-delay-1 max-w-[480px] mx-auto">
          <SearchForm autoFocus />
          <div className="mt-3">
            <RandomArticleButton />
          </div>
        </div>

      </section>

      <div className="max-w-xl mx-auto animate-fade-in-up-delay-2">
        <FeaturedArticle />
      </div>

      <div className="max-w-xl mx-auto animate-fade-in-up-delay-3">
        <CuriousAbout />
      </div>

      <div className="max-w-xl mx-auto animate-fade-in-up-delay-4">
        <RecentlyListened />
      </div>
    </div>
  );
}
