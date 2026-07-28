import type { Metadata } from "next";
import { AccountDeletionResultPage } from "@/components/AccountDeletionResultPage";

export const metadata: Metadata = {
  title: "Account deletion in progress — Curio Garden",
  description: "Status of a Curio Garden account deletion request.",
  robots: { index: false, follow: false },
};

export default function AccountDeletionPendingPage() {
  return <AccountDeletionResultPage status="pending" />;
}
