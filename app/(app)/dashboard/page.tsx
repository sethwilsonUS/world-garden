import type { Metadata } from "next";
import { DashboardHub } from "@/components/DashboardHub";

export const metadata: Metadata = {
  title: "Dashboard — Curio Garden",
  description:
    "Your account hub for Curio Garden, including the synced library and future listening and progress features.",
};

export default function DashboardPage() {
  return <DashboardHub />;
}
