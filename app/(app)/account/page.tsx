import type { Metadata } from "next";
import { AccountDataPage } from "@/components/AccountDataPage";

export const metadata: Metadata = {
  title: "Account & data — Curio Garden",
  description:
    "Review, export, or permanently delete the information connected to your signed-in Curio Garden account.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountDataPage />;
}
