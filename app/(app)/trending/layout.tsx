import type { Metadata } from "next";

const title = "Trending Wikipedia Articles Today — Curio Garden";
const description =
  "Explore the most-read Wikipedia articles today and hear Curio Garden's accessible daily audio briefing about why they are trending.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/trending" },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Curio Garden",
    url: "/trending",
  },
};

export default function TrendingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
