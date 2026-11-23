import type { Metadata } from "next";
import { SearchForm } from "@/components/SearchForm";
import { RecentlyOpened } from "@/components/RecentlyOpened";
import { HomeAuthStatusBanner } from "@/components/HomeAuthStatusBanner";
import { RandomArticleButton } from "@/components/RandomArticleButton";
import { TodayOnWikipedia } from "@/components/TodayOnWikipedia";
import { HomeHowItWorks } from "@/components/HomeHowItWorks";

const isLocal = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export const metadata: Metadata = {
  title: "Curio Garden — Listen to Wikipedia",
  description:
    "Explore Wikipedia through accessible section-by-section audio, save your place, and follow featured articles and trending stories as podcasts.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <div className="container mx-auto px-4 pt-12 pb-16 sm:pt-20">
      <section
        aria-labelledby="hero-heading"
        data-home-hero=""
        className="animate-fade-in-up mx-auto max-w-2xl text-center"
      >
        <h1
          id="hero-heading"
          className="type-page-title font-display font-semibold leading-[1.08] tracking-[-0.02em] text-foreground"
        >
          Listen to any Wikipedia article
        </h1>
        <p
          id="home-search-description"
          className="mx-auto mt-4 max-w-[34rem] text-lg leading-[1.6] text-foreground-2"
        >
          Search a topic, choose the sections you want, and press play.
          Curio Garden keeps your place while curiosity wanders.
        </p>

        <div className="mt-8 text-left" data-home-search-pane="">
          <SearchForm variant="workbench" describedBy="home-search-description" />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <RandomArticleButton />
          <a href="#how-it-works" className="btn-tertiary">
            New here? Hear how it works
          </a>
        </div>

        {!isLocal ? <HomeAuthStatusBanner /> : null}
      </section>

      <div className="animate-fade-in-up-delay-1 mx-auto max-w-5xl">
        <RecentlyOpened />
      </div>

      <div
        data-home-content=""
        className="animate-fade-in-up-delay-2 mx-auto max-w-5xl"
      >
        <TodayOnWikipedia />
      </div>

      <div className="mx-auto max-w-5xl">
        <HomeHowItWorks />
      </div>
    </div>
  );
}
