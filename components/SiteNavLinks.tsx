import Link from "next/link";
import { Show } from "@clerk/nextjs";

type SiteNavLinksProps = {
  variant: "desktop" | "mobile" | "footer";
  authEnabled?: boolean;
};

const commonLinks = [
  { href: "/", label: "Home" },
  { href: "/trending", label: "Trending" },
  { href: "/did-you-know", label: "Did you know?" },
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
  const linkClass = linkClassByVariant[variant];

  const renderLink = (href: string, label: string) => (
    <Link key={href} href={href} className={linkClass}>
      {label}
    </Link>
  );

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
    </>
  );
};
