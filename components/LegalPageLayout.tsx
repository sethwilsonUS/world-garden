import type { ReactNode } from "react";
import Link from "next/link";

type LegalPageLayoutProps = {
  title: string;
  description: string;
  lastUpdated: string;
  children: ReactNode;
};

type LegalSectionProps = {
  id: string;
  title: string;
  children: ReactNode;
};

export function LegalPageLayout({
  title,
  description,
  lastUpdated,
  children,
}: LegalPageLayoutProps) {
  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted text-sm no-underline"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={14}
              height={14}
              aria-hidden="true"
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </nav>

        <header className="mb-8">
          <p className="inline-flex items-center rounded-full border border-accent-border bg-accent-bg px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Legal
          </p>
          <h1 className="mt-4 font-display text-[2rem] sm:text-[2.45rem] font-bold text-foreground leading-[1.05]">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-[1.04rem] leading-[1.78] text-foreground-2">
            {description}
          </p>
          <p className="mt-3 text-xs text-muted">Last updated: {lastUpdated}</p>
        </header>

        <div className="space-y-5">{children}</div>
      </div>
    </div>
  );
}

export function LegalSection({ id, title, children }: LegalSectionProps) {
  return (
    <section aria-labelledby={id} className="garden-bed p-5 sm:p-6">
      <h2
        id={id}
        className="font-display text-[1.2rem] font-semibold text-foreground"
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-[1.8] text-foreground-2">
        {children}
      </div>
    </section>
  );
}
