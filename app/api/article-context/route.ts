import { NextRequest, NextResponse } from "next/server";
import { getPublishedArticleContext } from "@/lib/article-context-persistence";
import {
  ArticleContextInputError,
  ArticleContextUpstreamError,
} from "@/lib/article-context-extractor";
import {
  consumeArticleContextRouteQuota,
  parseArticleContextRequest,
} from "@/lib/article-context-route";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

export const POST = async (request: NextRequest) => {
  const quota = consumeArticleContextRouteQuota(request.headers);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "Article context is being requested too often. Try again later." },
      {
        status: 429,
        headers: {
          ...NO_CACHE_HEADERS,
          "Retry-After": String(quota.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const input = await parseArticleContextRequest(request);
    const result = await getPublishedArticleContext(input);
    return NextResponse.json(result, {
      status: 200,
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    if (error instanceof ArticleContextInputError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_CACHE_HEADERS },
      );
    }
    if (error instanceof ArticleContextUpstreamError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode, headers: NO_CACHE_HEADERS },
      );
    }
    console.error("[/api/article-context] Context generation failed", error);
    return NextResponse.json(
      { error: "Unable to build article context right now." },
      { status: 502, headers: NO_CACHE_HEADERS },
    );
  }
};
