"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { SettingsButton } from "./SettingsPanel";

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

export const AccessibleLayout = ({ children }: { children: ReactNode }) => {
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
            <span className="text-base">World Garden</span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-foreground-2 no-underline py-[6px] px-3 rounded-lg text-sm font-medium transition-colors duration-200"
            >
              Home
            </Link>
            <Link
              href="/library"
              className="text-foreground-2 no-underline py-[6px] px-3 rounded-lg text-sm font-medium transition-colors duration-200"
            >
              Library
            </Link>
            <SettingsButton />
            <ThemeToggle />
          </div>
        </nav>
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
              Audio powered by your browser&rsquo;s speech engine or{" "}
              <a
                href="https://elevenlabs.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                ElevenLabs
                <span className="sr-only"> (opens in new tab)</span>
              </a>{" "}
              (bring your own key). Wikipedia&reg; is a registered trademark of
              the Wikimedia Foundation.
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
