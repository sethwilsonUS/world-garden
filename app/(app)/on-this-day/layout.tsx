import type { ReactNode } from "react";
import { OnThisDaySessionProvider } from "@/components/OnThisDaySessionProvider";

export default function OnThisDayLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <OnThisDaySessionProvider>{children}</OnThisDaySessionProvider>;
}
