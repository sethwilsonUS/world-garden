import { ArticleView } from "@/components/ArticleView";
import { BackButton } from "@/components/BackButton";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;

  return (
    <div className="container mx-auto px-4 pt-7 pb-16">
      <div className="max-w-3xl mx-auto">
        <BackButton />

        <ArticleView slug={decodeURIComponent(slug)} />
      </div>
    </div>
  );
}
