import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).replace(/\/+$/u, "");

  const indexablePaths = [
    "",
    "/on-this-day",
    "/trending",
    "/podcasts",
    "/podcasts/featured",
    "/podcasts/trending",
    "/about",
    "/feedback",
    "/privacy",
    "/terms",
  ];

  return indexablePaths.map((path) => ({ url: `${siteUrl}${path}` }));
}
