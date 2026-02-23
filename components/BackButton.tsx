"use client";

import { useRouter } from "next/navigation";

const chevronLeft = (
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
);

export const BackButton = () => {
  const router = useRouter();

  return (
    <nav aria-label="Back navigation" className="mb-4">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-muted text-sm bg-transparent border-none cursor-pointer p-0"
      >
        {chevronLeft}
        Back
      </button>
    </nav>
  );
};
