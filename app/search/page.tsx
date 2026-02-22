import { SearchForm } from "@/components/SearchForm";
import { SearchResultsList } from "@/components/SearchResultsList";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const term = params.q?.trim() ?? "";

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-3xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <a
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
          </a>
        </nav>

        <section aria-labelledby="search-heading">
          <h1
            id="search-heading"
            className="font-display text-[1.75rem] font-bold mb-5 text-foreground"
          >
            {term ? `Results for \u201c${term}\u201d` : "Search Wikipedia"}
          </h1>

          {!term ? (
            <div>
              <div className="mb-8">
                <SearchForm autoFocus />
              </div>
              <div
                className="garden-bed text-center py-12 px-6"
                role="status"
              >
                <p className="font-display font-semibold text-lg text-foreground">
                  Plant a seed
                </p>
                <p className="text-muted text-sm mt-2">
                  Enter a topic above to search Wikipedia.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Results first for faster access */}
              <div className="mb-8">
                <SearchResultsList term={term} />
              </div>

              {/* Search form below for refinement */}
              <div className="border-t border-border pt-6">
                <p className="text-[0.8125rem] text-muted mb-3 font-medium">
                  Refine your search
                </p>
                <SearchForm defaultValue={term} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
