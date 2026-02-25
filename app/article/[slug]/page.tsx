import { ArticleView } from "@/components/ArticleView";
import { BackButton } from "@/components/BackButton";
import { RandomRerollButton } from "@/components/RandomRerollButton";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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
