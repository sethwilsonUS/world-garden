"use client";

import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { usePrefetch } from "@/hooks/usePrefetch";

type NextLinkProps = ComponentPropsWithoutRef<typeof Link>;

type ArticleLinkProps = Omit<NextLinkProps, "href"> & {
  articleTitle: string;
  href?: NextLinkProps["href"];
};

export const articleTitleToArticleHref = (title: string): string =>
  `/article/${encodeURIComponent(title.replace(/ /g, "_"))}`;

export const ArticleLink = forwardRef<HTMLAnchorElement, ArticleLinkProps>(({
  articleTitle,
  href,
  onMouseEnter,
  onFocus,
  onPointerDown,
  onTouchStart,
  ...props
}, ref) => {
  const prefetch = usePrefetch();
  const warm = () => prefetch(articleTitle);

  return (
    <Link
      ref={ref}
      {...props}
      href={href ?? articleTitleToArticleHref(articleTitle)}
      onMouseEnter={(event) => {
        warm();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        warm();
        onFocus?.(event);
      }}
      onPointerDown={(event) => {
        warm();
        onPointerDown?.(event);
      }}
      onTouchStart={(event) => {
        warm();
        onTouchStart?.(event);
      }}
    />
  );
});

ArticleLink.displayName = "ArticleLink";
