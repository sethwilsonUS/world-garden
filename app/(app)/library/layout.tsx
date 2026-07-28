import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Library — Curio Garden",
  description: "Open the Wikipedia articles saved in your Curio Garden Library.",
  alternates: { canonical: "/library" },
  robots: { index: false, follow: true },
};

export default function LibraryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
