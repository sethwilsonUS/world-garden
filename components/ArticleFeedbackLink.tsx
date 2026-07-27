import Link from "next/link";
import {
  MAX_PRODUCT_FEEDBACK_ARTICLE_REVISION_ID_DIGITS,
  MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
  MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
} from "@/lib/product-feedback";

type ArticleFeedbackLinkProps = {
  title: string;
  slug: string;
  revisionId?: string;
};

const encoder = new TextEncoder();

const normalizeBoundedSingleLine = (
  value: string,
  maxBytes: number,
): string => {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  let result = "";
  let byteLength = 0;

  for (const character of normalized) {
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }

  return result;
};

export const buildArticleFeedbackHref = ({
  title,
  slug,
  revisionId,
}: ArticleFeedbackLinkProps): string => {
  const articleTitle = normalizeBoundedSingleLine(
    title,
    MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
  );
  const articleSlug = normalizeBoundedSingleLine(
    slug,
    MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
  );
  const articleRevisionId = revisionId?.trim();
  const params = new URLSearchParams();

  if (articleTitle && articleSlug) {
    params.set("articleTitle", articleTitle);
    params.set("articleSlug", articleSlug);
    if (
      articleRevisionId &&
      new RegExp(
        `^\\d{1,${MAX_PRODUCT_FEEDBACK_ARTICLE_REVISION_ID_DIGITS}}$`,
        "u",
      ).test(articleRevisionId)
    ) {
      params.set("articleRevisionId", articleRevisionId);
    }
  }

  const query = params.toString();
  return query ? `/feedback?${query}` : "/feedback";
};

export const ArticleFeedbackLink = (props: ArticleFeedbackLinkProps) => (
  <Link
    href={buildArticleFeedbackHref(props)}
    className="btn-secondary min-h-10 px-4 py-2 text-sm no-underline"
  >
    Give feedback on this article
  </Link>
);
