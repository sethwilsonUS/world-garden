import type { Metadata } from "next";
import { SearchForm } from "@/components/SearchForm";
import { SearchResultsList } from "@/components/SearchResultsList";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export const metadata: Metadata = {
  title: "Search Wikipedia — Curio Garden",
  description:
    "Search Wikipedia and open an article in Curio Garden's accessible listening experience.",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const term = params.q?.trim() ?? "";

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-3xl mx-auto">
        <section aria-labelledby="search-heading">
          <h1
            id="search-heading"
            className="type-page-title font-display text-[1.75rem] font-bold text-foreground [overflow-wrap:anywhere]"
          >
            {term ? `Results for \u201c${term}\u201d` : "Search Wikipedia"}
          </h1>
          <p className="mt-1 mb-5 text-base leading-[1.6] text-foreground-2">
            Find any Wikipedia article and open it as audio.
          </p>

          {/* Pre-filled so readers can refine without hunting for the field. */}
          <div className="mb-8">
            <SearchForm key={term} defaultValue={term} />
          </div>

          {!term ? (
            <div className="garden-bed text-center py-12 px-6">
              <p className="font-display font-semibold text-lg text-foreground">
                Plant a seed
              </p>
              <p className="text-muted text-sm mt-2">
                Enter a topic above to search Wikipedia.
              </p>
            </div>
          ) : (
            <SearchResultsList term={term} />
          )}
        </section>
      </div>
    </div>
  );
}
