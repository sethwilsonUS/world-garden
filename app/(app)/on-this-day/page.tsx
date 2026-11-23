import type { Metadata } from "next";
import { OnThisDayExplorer } from "@/components/OnThisDayExplorer";

export const metadata: Metadata = {
  title: "On This Day — Curio Garden",
  description:
    "Explore today's historical events, births, deaths, and holidays in an accessible timeline.",
};

export default function OnThisDayPage() {
  return (
    <div className="on-this-day-page container mx-auto px-4 pb-20 pt-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="type-page-title font-display text-[1.75rem] font-bold text-foreground">
            On This Day
          </h1>
          <p className="mt-1 max-w-3xl text-base leading-[1.6] text-foreground-2">
            Today across the centuries: events, notable lives, and holidays from
            Wikipedia.
          </p>
        </header>

        <OnThisDayExplorer />
      </div>
    </div>
  );
}
