"use client";

import { SearchForm } from "@/components/SearchForm";
import { RecentlyListened } from "@/components/RecentlyListened";
import { HomeAuthStatusBanner } from "@/components/HomeAuthStatusBanner";
import { RandomArticleButton } from "@/components/RandomArticleButton";
import { TodayOnWikipedia } from "@/components/TodayOnWikipedia";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default function Home() {
  return (
    <>
      {!isLocal ? <HomeAuthStatusBanner /> : null}

      <div className="container mx-auto px-4 pt-16 pb-[100px] sm:pt-[88px]">
        <section
          className="max-w-xl mx-auto text-center"
          aria-labelledby="hero-heading"
        >
          <div className="animate-fade-in-up mb-12">
            <h1
              id="hero-heading"
              className="font-display text-[clamp(2.75rem,7vw,5rem)] font-semibold leading-[1.05] mb-6 text-foreground tracking-[-0.02em]"
            >
              Curio Garden
            </h1>

            <p className="text-lg leading-[1.7] text-foreground-2 max-w-[440px] mx-auto">
              Explore any Wikipedia article as clear, section-by-section audio,
              then keep listening wherever curiosity takes you.
            </p>
          </div>

          <div className="animate-fade-in-up-delay-1 max-w-[480px] mx-auto">
            <SearchForm autoFocus />
            <div className="mt-3">
              <RandomArticleButton />
            </div>
          </div>
        </section>

        <div className="max-w-5xl mx-auto animate-fade-in-up-delay-2">
          <TodayOnWikipedia />
        </div>

        <div className="max-w-xl mx-auto animate-fade-in-up-delay-3">
          <RecentlyListened />
        </div>
      </div>
    </>
  );
}
