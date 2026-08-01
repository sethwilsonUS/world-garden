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
  { href: "/on-this-day", label: "On This Day" },
  { href: "/trending", label: "Trending" },
  { href: "/podcasts", label: "Podcasts" },
];

const linkClassByVariant: Record<SiteNavLinksProps["variant"], string> = {
  desktop:
    "inline-flex min-h-11 items-center text-foreground-2 no-underline py-2 px-3 rounded-lg text-sm font-medium leading-snug transition-colors duration-200",
  mobile:
    "inline-flex min-h-11 items-center text-foreground no-underline py-2 px-3 rounded-lg text-sm font-medium leading-snug transition-colors duration-200",
  footer:
    "inline-flex min-h-11 items-center text-foreground-2 no-underline text-sm leading-snug",
};

export const isSiteNavHrefCurrent = (
  pathname: string,
  href: string,
): boolean =>
  href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);

export const SiteNavLinks = ({
  variant,
  authEnabled = false,
}: SiteNavLinksProps) => {
  const pathname = usePathname();
  const linkClass = linkClassByVariant[variant];

  const renderLink = (href: string, label: string) => {
    const isCurrent = isSiteNavHrefCurrent(pathname, href);

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
          <Show when="signed-out">{renderLink("/library", "Library")}</Show>
          <Show when="signed-in">{renderLink("/dashboard", "Dashboard")}</Show>
        </>
      ) : (
        renderLink("/library", "Library")
      )}
      {variant === "footer" ? (
        <>
          {renderLink("/feedback", "Feedback")}
          {renderLink("/about", "About")}
        </>
      ) : null}
    </>
  );
};
