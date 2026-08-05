import type { Metadata } from "next";
import {
  articleRouteFromTitle,
  parseCanonicalArticlePath,
} from "@curio-garden/domain";
import { ArticleView } from "@/components/ArticleView";
import { BackButton } from "@/components/BackButton";
import { RandomRerollButton } from "@/components/RandomRerollButton";
import { fetchWikiSummary, slugToTitle } from "@/lib/wiki-summary";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await fetchWikiSummary(slug);
  const parsedRoute = parseCanonicalArticlePath(`/article/${slug}`);
  const title =
    article?.title ??
    parsedRoute?.slug.replaceAll("_", " ") ??
    slugToTitle(slug);
  const description =
    article?.extract ?? `Listen to "${title}" on Curio Garden`;
  const canonicalPath = articleRouteFromTitle(title).canonicalPath;

  return {
    title: `${title} — Curio Garden`,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      type: "article",
      siteName: "Curio Garden",
      url: canonicalPath,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ArticlePage({
  params,
  searchParams,
}: ArticlePageProps) {
  const { slug } = await params;
  const { from } = await searchParams;

  return (
    <div className="container mx-auto px-4 pt-7 pb-16">
      <div className="max-w-3xl mx-auto">
        <nav
          aria-label="Article navigation"
          className="flex items-center justify-between mb-4"
        >
          <BackButton />
          {from === "random" && <RandomRerollButton />}
        </nav>

        <ArticleView slug={decodeURIComponent(slug)} />
      </div>
    </div>
  );
}
