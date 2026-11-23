import type { ReactNode } from "react";

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
        <header className="mb-8">
          <h1 className="type-page-title font-display text-[1.75rem] font-bold text-foreground">
            {title}
          </h1>
          <p className="mt-1 max-w-3xl text-base leading-[1.6] text-foreground-2">
            {description}
          </p>
          <p className="mt-2 text-xs text-muted">Last updated: {lastUpdated}</p>
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
        className="type-section-title scroll-mt-[calc(var(--site-header-height)+16px)] font-display text-[1.2rem] font-semibold text-foreground"
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-[1.8] text-foreground-2">
        {children}
      </div>
    </section>
  );
}
