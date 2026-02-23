import Link from "next/link";
import { ArticleView } from "@/components/ArticleView";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;

  return (
    <div className="container mx-auto px-4 pt-7 pb-16">
      <div className="max-w-3xl mx-auto">
        <nav aria-label="Back navigation" className="mb-4">
          <Link
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
          </Link>
        </nav>

        <ArticleView slug={decodeURIComponent(slug)} />
      </div>
    </div>
  );
}
