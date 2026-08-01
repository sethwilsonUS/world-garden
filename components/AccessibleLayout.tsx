"use client";

import {
  ReactNode,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { SiteNavLinks } from "./SiteNavLinks";

const MOBILE_MENU_ID = "mobile-nav-menu";

const LeafIcon = ({ size = 24 }: { size?: number }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
      className="text-accent"
    >
      <path d="M12 2C6.5 6 4 11 4 15c0 3.5 3.5 6 8 7 4.5-1 8-3.5 8-7 0-4-2.5-9-8-13z" />
      <path d="M12 2v20" />
      <path d="M12 8l-3 3" />
      <path d="M12 8l3 3" />
      <path d="M12 13l-4 3" />
      <path d="M12 13l4 3" />
    </svg>
  );
};

const HamburgerIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    width={20}
    height={20}
    aria-hidden="true"
  >
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    width={20}
    height={20}
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const AccessibleLayout = ({
  children,
  authControls,
  mobileAuthControls,
  authEnabled = false,
}: {
  children: ReactNode;
  authControls?: ReactNode;
  mobileAuthControls?: ReactNode;
  authEnabled?: boolean;
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [mobileMenuTop, setMobileMenuTop] = useState(0);
  const pathname = usePathname();

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    hamburgerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMobileMenu();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileMenuOpen, closeMobileMenu]);

  useEffect(() => {
    if (!mobileMenuOpen || !menuRef.current) return;
    const firstLink = menuRef.current.querySelector<HTMLElement>("a, button");
    firstLink?.focus();
  }, [mobileMenuOpen]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const root = document.documentElement;
    let initialHashFrame = 0;
    const publishHeaderHeight = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height > 0) {
        root.style.setProperty("--site-header-height", `${height}px`);
      }
    };

    publishHeaderHeight();
    if (window.location.hash) {
      let targetId = window.location.hash.slice(1);
      try {
        targetId = decodeURIComponent(targetId);
      } catch {
        // A malformed fragment cannot identify a target; native behavior is
        // the safest fallback.
      }
      const target = document.getElementById(targetId);
      if (target) {
        initialHashFrame = requestAnimationFrame(() =>
          target.scrollIntoView({ block: "start" }),
        );
      }
    }
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publishHeaderHeight);
    observer?.observe(header);
    window.addEventListener("resize", publishHeaderHeight, { passive: true });

    return () => {
      if (initialHashFrame) cancelAnimationFrame(initialHashFrame);
      observer?.disconnect();
      window.removeEventListener("resize", publishHeaderHeight);
      root.style.removeProperty("--site-header-height");
    };
  }, []);

  useLayoutEffect(() => {
    if (!mobileMenuOpen) return;
    const updateMenuTop = () => {
      const headerBottom =
        headerRef.current?.getBoundingClientRect().bottom ?? 0;
      setMobileMenuTop(Math.max(0, Math.min(window.innerHeight, headerBottom)));
    };

    updateMenuTop();
    window.addEventListener("resize", updateMenuTop, { passive: true });
    window.addEventListener("scroll", updateMenuTop, { passive: true });
    window.visualViewport?.addEventListener("resize", updateMenuTop, {
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", updateMenuTop);
      window.removeEventListener("scroll", updateMenuTop);
      window.visualViewport?.removeEventListener("resize", updateMenuTop);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen || !menuRef.current) return;
    const menu = menuRef.current;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = menu.querySelectorAll<HTMLElement>(
        'a[href], button, input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileMenuOpen]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header
        ref={headerRef}
        className="navbar min-h-12"
        role="banner"
        style={{ position: "sticky", height: "auto" }}
      >
        <nav
          className="container mx-auto flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-1"
          aria-label="Main navigation"
        >
          <Link
            href="/"
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg font-semibold font-display text-foreground no-underline"
          >
            <LeafIcon size={22} />
            <span className="min-w-0 text-sm leading-tight sm:text-base">
              Curio Garden
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden min-w-0 flex-1 flex-wrap items-center justify-end gap-2 lg:flex">
            <SiteNavLinks variant="desktop" authEnabled={authEnabled} />
            <ThemeToggle />
            {authControls}
          </div>

          {/* Mobile: theme toggle + hamburger */}
          <div className="flex items-center gap-1 lg:hidden">
            <ThemeToggle />
            <button
              ref={hamburgerRef}
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-controls={MOBILE_MENU_ID}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-foreground transition-colors duration-200"
            >
              {mobileMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
            </button>
          </div>
        </nav>
      </header>

      {/* Keep the panel inside the current visual viewport even when an
          in-flow notice places the sticky header below its resting position. */}
      {mobileMenuOpen && (
        <div
          id={MOBILE_MENU_ID}
          ref={menuRef}
          role="navigation"
          aria-label="Mobile navigation"
          className="fixed inset-x-0 z-40 overflow-y-auto overscroll-contain border-b border-border bg-surface-nav shadow-lg backdrop-blur-2xl lg:hidden"
          style={{
            top: mobileMenuTop,
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="container mx-auto px-4 py-4 flex flex-col gap-1">
            <SiteNavLinks variant="mobile" authEnabled={authEnabled} />
            {mobileAuthControls ? (
              <div className="pt-3 mt-2 border-t border-border">
                {mobileAuthControls}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <main
        id="main-content"
        role="main"
        tabIndex={-1}
        className="min-h-[calc(100svh_-_var(--site-header-height,48px))]"
      >
        {children}
      </main>

      <footer role="contentinfo" className="border-t border-border py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2">
              <LeafIcon size={20} />
              <span className="font-display font-semibold text-foreground">
                Curio Garden
              </span>
            </div>
            <nav
              aria-label="Footer navigation"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
            >
              <SiteNavLinks variant="footer" authEnabled={authEnabled} />
              <Link
                href="/privacy"
                className="text-foreground-2 no-underline text-sm"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-foreground-2 no-underline text-sm"
              >
                Terms
              </Link>
            </nav>
          </div>

          <hr className="garden-divider" />

          <div className="text-center text-muted text-xs leading-[1.6]">
            <p>
              Curio Garden uses content from{" "}
              <a
                href="https://en.wikipedia.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Wikipedia
                <span className="sr-only"> (opens in new tab)</span>
              </a>
              , which is licensed under the{" "}
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Creative Commons Attribution-ShareAlike License (CC BY-SA)
                <span className="sr-only"> (opens in new tab)</span>
              </a>
              .
            </p>
            <p className="mt-1">
              Audio uses synthetic speech from Edge TTS and OpenAI. Curio Garden
              is an independent project and is not endorsed by or affiliated
              with the Wikimedia Foundation. Wikipedia is a trademark of the
              Wikimedia Foundation.
            </p>
            <p className="mt-3 font-display italic">Tended with care.</p>
          </div>
        </div>
      </footer>
    </>
  );
};
