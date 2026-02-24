"use client";

import { ReactNode, useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

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

export const AccessibleLayout = ({ children }: { children: ReactNode }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

      <header className="navbar" role="banner">
        <nav
          className="container mx-auto px-4 h-full flex items-center justify-between"
          aria-label="Main navigation"
        >
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold font-display text-foreground no-underline"
          >
            <LeafIcon size={22} />
            <span className="text-sm sm:text-base whitespace-nowrap">World Garden</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-3">
            <Link
              href="/"
              className="text-foreground-2 no-underline py-[6px] px-3 rounded-lg text-sm font-medium transition-colors duration-200"
            >
              Home
            </Link>
            <Link
              href="/trending"
              className="text-foreground-2 no-underline py-[6px] px-3 rounded-lg text-sm font-medium transition-colors duration-200"
            >
              Trending
            </Link>
            <Link
              href="/library"
              className="text-foreground-2 no-underline py-[6px] px-3 rounded-lg text-sm font-medium transition-colors duration-200"
            >
              Library
            </Link>
            <ThemeToggle />
          </div>

          {/* Mobile: theme toggle + hamburger */}
          <div className="flex sm:hidden items-center gap-1">
            <ThemeToggle />
            <button
              ref={hamburgerRef}
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-controls={MOBILE_MENU_ID}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-foreground bg-transparent border-0 cursor-pointer transition-colors duration-200"
            >
              {mobileMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
            </button>
          </div>
        </nav>

        {/* Mobile menu panel */}
        {mobileMenuOpen && (
          <div
            id={MOBILE_MENU_ID}
            ref={menuRef}
            role="navigation"
            aria-label="Mobile navigation"
            className="sm:hidden absolute top-full left-0 right-0 bg-surface-nav backdrop-blur-2xl border-b border-border shadow-lg"
          >
            <div className="container mx-auto px-4 py-4 flex flex-col gap-1">
              <Link
                href="/"
                className="text-foreground no-underline py-3 px-3 rounded-lg text-sm font-medium transition-colors duration-200"
              >
                Home
              </Link>
              <Link
                href="/trending"
                className="text-foreground no-underline py-3 px-3 rounded-lg text-sm font-medium transition-colors duration-200"
              >
                Trending
              </Link>
              <Link
                href="/library"
                className="text-foreground no-underline py-3 px-3 rounded-lg text-sm font-medium transition-colors duration-200"
              >
                Library
              </Link>
            </div>
          </div>
        )}
      </header>

      <main
        id="main-content"
        role="main"
        tabIndex={-1}
        className="pt-12"
        style={{ minHeight: "calc(100vh - 48px)" }}
      >
        {children}
      </main>

      <footer
        role="contentinfo"
        className="border-t border-border py-8"
      >
        <div className="container mx-auto px-4">
          <div
            className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6"
          >
            <div className="flex items-center gap-2">
              <LeafIcon size={20} />
              <span className="font-display font-semibold text-foreground">
                World Garden
              </span>
            </div>
            <nav
              aria-label="Footer navigation"
              className="flex gap-4"
            >
              <Link
                href="/"
                className="text-foreground-2 no-underline text-sm"
              >
                Home
              </Link>
              <Link
                href="/trending"
                className="text-foreground-2 no-underline text-sm"
              >
                Trending
              </Link>
              <Link
                href="/library"
                className="text-foreground-2 no-underline text-sm"
              >
                Library
              </Link>
            </nav>
          </div>

          <hr className="garden-divider" />

          <div className="text-center text-muted text-xs leading-[1.6]">
            <p>
              World Garden uses content from{" "}
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
              Audio powered by Edge TTS. Wikipedia&reg; is a registered
              trademark of the Wikimedia Foundation.
            </p>
            <p className="mt-3 font-display italic">
              Tended with care.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
};
