import type { Metadata } from "next";
import { DashboardHub } from "@/components/DashboardHub";

export const metadata: Metadata = {
  title: "Dashboard — Curio Garden",
  description:
    "Your Curio Garden account hub for the synced Library, personal podcast Playlist, private feed, and listening progress.",
};

export default function DashboardPage() {
  return <DashboardHub />;
}
