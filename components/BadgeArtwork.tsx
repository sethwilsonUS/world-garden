import type { BadgeKey } from "@/lib/badges";

type BadgeArtworkProps = {
  badgeKey: BadgeKey;
  className?: string;
};

const commonProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const BadgeArtwork = ({ badgeKey, className }: BadgeArtworkProps) => {
  switch (badgeKey) {
    case "history":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <path d="M13 12h14a5 5 0 0 1 5 5v19H18a5 5 0 0 0-5 5z" />
          <path d="M32 36V17a5 5 0 0 1 5-5h1v24h-1a5 5 0 0 0-5 5" />
          <path d="M19 19h8" />
          <path d="M19 24h10" />
          <path d="M19 29h7" />
          <path d="M11 16v20" />
        </svg>
      );
    case "geography":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <circle cx="24" cy="24" r="14" />
          <path d="M24 10c4.5 4.7 6.8 9.3 6.8 14S28.5 33.3 24 38" />
          <path d="M24 10c-4.5 4.7-6.8 9.3-6.8 14S19.5 33.3 24 38" />
          <path d="M10 24h28" />
          <path d="M13.5 17.5h21" />
          <path d="M13.5 30.5h21" />
        </svg>
      );
    case "biography":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <circle cx="24" cy="18" r="6" />
          <path d="M14 35c1.8-5.8 6.1-9 10-9s8.2 3.2 10 9" />
          <path d="M10 38h28" />
          <path d="M18 12l2-3h8l2 3" />
        </svg>
      );
    case "society_politics":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <path d="M10 18h28" />
          <path d="M14 18v15" />
          <path d="M24 18v15" />
          <path d="M34 18v15" />
          <path d="M10 33h28" />
          <path d="M8 18l16-8 16 8" />
          <path d="M8 38h32" />
        </svg>
      );
    case "arts_culture":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <path d="M16 32V14a4 4 0 0 1 4-4h10v18" />
          <path d="M30 14h4a4 4 0 0 1 4 4v10" />
          <circle cx="16" cy="34" r="4" />
          <circle cx="30" cy="34" r="4" />
          <path d="M20 18h10" />
        </svg>
      );
    case "science":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <circle cx="24" cy="24" r="3" />
          <path d="M24 8c5 0 9 7.2 9 16s-4 16-9 16-9-7.2-9-16 4-16 9-16z" />
          <path d="M10 18c4.4-2.6 12.5-.7 19.4 4 6.9 4.7 10 10.4 7.6 13" />
          <path d="M38 18c-4.4-2.6-12.5-.7-19.4 4-6.9 4.7-10 10.4-7.6 13" />
        </svg>
      );
    case "technology":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <circle cx="24" cy="24" r="5" />
          <path d="M24 10v5" />
          <path d="M24 33v5" />
          <path d="M10 24h5" />
          <path d="M33 24h5" />
          <path d="m14.5 14.5 3.5 3.5" />
          <path d="m30 30 3.5 3.5" />
          <path d="m33.5 14.5-3.5 3.5" />
          <path d="m18 30-3.5 3.5" />
          <circle cx="24" cy="24" r="11" />
        </svg>
      );
    case "nature":
      return (
        <svg viewBox="0 0 48 48" className={className} aria-hidden="true" {...commonProps}>
          <path d="M24 38c7-4.4 11-11.3 11-19-8.6.2-14.6 4.7-18 12.2" />
          <path d="M24 38c-6.7-3.6-10.8-9.6-11-18 7.2 0 12.2 3.2 15.3 8.6" />
          <path d="M24 38V16" />
        </svg>
      );
  }
};
