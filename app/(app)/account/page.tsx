import type { Metadata } from "next";
import { AccountDataPage } from "@/components/AccountDataPage";

export const metadata: Metadata = {
  title: "Account & data — Curio Garden",
  description:
    "Review what Curio Garden stores for your signed-in account and export a portable copy of that data.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountDataPage />;
}
