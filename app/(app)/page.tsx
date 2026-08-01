import type { Metadata } from "next";
import { SearchForm } from "@/components/SearchForm";
import { RecentlyOpened } from "@/components/RecentlyOpened";
import { HomeAuthStatusBanner } from "@/components/HomeAuthStatusBanner";
import { RandomArticleButton } from "@/components/RandomArticleButton";
import { TodayOnWikipedia } from "@/components/TodayOnWikipedia";
import { HomeListeningSample } from "@/components/HomeListeningSample";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export const metadata: Metadata = {
  title: "Curio Garden — Listen to Wikipedia",
  description:
    "Explore Wikipedia through accessible section-by-section audio, save your place, and follow featured articles and trending stories as podcasts.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      {!isLocal ? <HomeAuthStatusBanner /> : null}

      <div className="container mx-auto px-4 pt-16 pb-[100px] sm:pt-[88px]">
        <section className="mx-auto text-center" aria-labelledby="hero-heading">
          <div className="animate-fade-in-up mx-auto mb-12 max-w-xl">
            <h1
              id="hero-heading"
              className="type-hero-title font-display font-semibold leading-[1.05] mb-6 text-foreground tracking-[-0.02em]"
            >
              Curio Garden
            </h1>

            <p className="text-lg leading-[1.7] text-foreground-2 max-w-[440px] mx-auto">
              Explore any Wikipedia article as clear, section-by-section audio,
              then keep listening wherever curiosity takes you.
            </p>
          </div>

          <div className="animate-fade-in-up-delay-1 mx-auto max-w-[1200px]">
            <div
              data-home-search-workbench=""
              className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:overflow-hidden lg:rounded-3xl lg:border lg:border-border lg:bg-surface lg:text-left lg:shadow-[0_14px_36px_rgba(0,0,0,0.08)]"
            >
              <section
                data-home-search-pane=""
                aria-labelledby="home-search-heading"
                className="mx-auto max-w-[480px] text-center lg:mx-0 lg:min-h-[416px] lg:max-w-none lg:bg-surface-2 lg:px-9 lg:py-8 lg:text-left xl:px-11 xl:py-10"
              >
                <div className="hidden lg:block">
                  <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-accent">
                    Your next curiosity
                  </p>
                  <h2
                    id="home-search-heading"
                    className="mt-2 font-display text-4xl font-semibold leading-[1.12] tracking-[-0.015em] text-foreground"
                  >
                    Find a topic. Follow the thread.
                  </h2>
                  <p
                    id="home-search-description"
                    className="mt-3 max-w-2xl text-base leading-[1.65] text-foreground-2"
                  >
                    Search any Wikipedia article, then choose the sections you
                    want to hear.
                  </p>
                </div>

                <div className="lg:mt-7">
                  <SearchForm variant="workbench" />
                </div>

                <div className="mt-3 lg:flex lg:items-center lg:gap-4">
                  <RandomArticleButton />
                  <p className="hidden text-xs leading-relaxed text-muted lg:block">
                    No account needed to begin.
                  </p>
                </div>
              </section>

              <HomeListeningSample />
            </div>
          </div>
        </section>

        <div
          data-home-content=""
          className="mx-auto max-w-5xl animate-fade-in-up-delay-2"
        >
          <TodayOnWikipedia />
        </div>

        <div className="max-w-xl mx-auto animate-fade-in-up-delay-3">
          <RecentlyOpened />
        </div>
      </div>
    </>
  );
}
