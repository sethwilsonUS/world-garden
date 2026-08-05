"use client";

import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { articleRouteFromTitle } from "@curio-garden/domain";
import { usePrefetch } from "@/hooks/usePrefetch";

type NextLinkProps = ComponentPropsWithoutRef<typeof Link>;

type ArticleLinkProps = Omit<NextLinkProps, "href"> & {
  articleTitle: string;
  href?: NextLinkProps["href"];
};

export const articleTitleToArticleHref = (title: string): string =>
  articleRouteFromTitle(title).canonicalPath;

export const ArticleLink = forwardRef<HTMLAnchorElement, ArticleLinkProps>(
  (
    {
      articleTitle,
      href,
      onMouseEnter,
      onFocus,
      onPointerDown,
      onTouchStart,
      ...props
    },
    ref,
  ) => {
    let destinationHref = href;
    let prefetchTitle = articleTitle;
    if (destinationHref === undefined) {
      const fallbackRoute = articleRouteFromTitle(articleTitle);
      destinationHref = fallbackRoute.canonicalPath;
      prefetchTitle = fallbackRoute.slug;
    }

    const prefetch = usePrefetch();
    const warm = () => prefetch(prefetchTitle);

    return (
      <Link
        ref={ref}
        {...props}
        href={destinationHref}
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
  },
);

ArticleLink.displayName = "ArticleLink";
