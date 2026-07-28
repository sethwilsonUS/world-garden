import type { Metadata } from "next";
import { AccountDeletionResultPage } from "@/components/AccountDeletionResultPage";

export const metadata: Metadata = {
  title: "Account deleted — Curio Garden",
  description: "Confirmation that a Curio Garden account was deleted.",
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage() {
  return <AccountDeletionResultPage status="deleted" />;
}
