import Link from "next/link";
import { SearchForm } from "@/components/SearchForm";

export default function NotFound() {
  return (
    <div className="container mx-auto px-4 py-[100px]">
      <div className="max-w-xl mx-auto text-center animate-fade-in-up">
        <p className="mb-5 font-mono text-sm font-semibold tracking-[0.12em] text-accent">
          404
        </p>

        <h1 className="font-display text-[clamp(2.25rem,6vw,4rem)] font-semibold leading-[1.05] mb-4 text-foreground tracking-[-0.02em]">
          Page not found
        </h1>

        <p className="text-lg leading-[1.7] text-foreground-2 max-w-[440px] mx-auto mb-10">
          This part of the garden hasn&apos;t been planted yet. Try searching
          for something, or head back home.
        </p>

        <div className="max-w-[480px] mx-auto mb-6">
          <SearchForm />
        </div>

        <Link href="/" className="btn-secondary">
          Back to home
        </Link>
      </div>
    </div>
  );
}
