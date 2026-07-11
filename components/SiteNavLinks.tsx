"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show } from "@clerk/nextjs";

type SiteNavLinksProps = {
  variant: "desktop" | "mobile" | "footer";
  authEnabled?: boolean;
};

const commonLinks = [
  { href: "/", label: "Home" },
  { href: "/trending", label: "Trending" },
  { href: "/podcasts", label: "Podcasts" },
];

const linkClassByVariant: Record<SiteNavLinksProps["variant"], string> = {
  desktop:
    "text-foreground-2 no-underline py-[6px] px-3 rounded-lg text-sm font-medium transition-colors duration-200",
  mobile:
    "text-foreground no-underline py-3 px-3 rounded-lg text-sm font-medium transition-colors duration-200",
  footer: "text-foreground-2 no-underline text-sm",
};

export const SiteNavLinks = ({
  variant,
  authEnabled = false,
}: SiteNavLinksProps) => {
  const pathname = usePathname();
  const linkClass = linkClassByVariant[variant];

  const renderLink = (href: string, label: string) => {
    const isCurrent = href === "/" ? pathname === href : pathname.startsWith(href);

    return (
      <Link
        key={href}
        href={href}
        aria-current={isCurrent ? "page" : undefined}
        className={`${linkClass}${isCurrent ? " nav-link-current" : ""}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      {commonLinks.map((link) => renderLink(link.href, link.label))}
      {authEnabled ? (
        <>
          <Show when="signed-out">
            {renderLink("/library", "Library")}
          </Show>
          <Show when="signed-in">
            {renderLink("/dashboard", "Dashboard")}
          </Show>
        </>
      ) : (
        renderLink("/library", "Library")
      )}
      {variant === "footer" ? renderLink("/about", "About") : null}
    </>
  );
};
