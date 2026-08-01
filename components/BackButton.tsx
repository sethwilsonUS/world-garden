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
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg border-none bg-transparent px-2 py-1 text-sm text-muted cursor-pointer"
    >
      {chevronLeft}
      Back
    </button>
  );
};
