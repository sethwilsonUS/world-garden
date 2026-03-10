import type { MouseEventHandler, ReactNode } from "react";

type SharedProps = {
  label: string;
  ariaLabel: string;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
};

type AudioDownloadButtonAsButton = SharedProps & {
  href?: never;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  download?: never;
};

type AudioDownloadButtonAsLink = SharedProps & {
  href: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  disabled?: never;
  download?: boolean | string;
};

type AudioDownloadButtonProps =
  | AudioDownloadButtonAsButton
  | AudioDownloadButtonAsLink;

const baseClassName =
  "inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-5 py-2.5 text-sm font-semibold text-foreground-2 transition-colors duration-200";

const interactiveClassName =
  "cursor-pointer hover:border-accent-border hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const disabledClassName = "cursor-not-allowed opacity-70";

const DownloadIcon = ({ className = "shrink-0" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={16}
    height={16}
    aria-hidden="true"
    className={className}
  >
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const DownloadSpinnerIcon = ({
  className = "animate-spin shrink-0",
}: {
  className?: string;
}) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    width={16}
    height={16}
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

export const AudioDownloadButton = (props: AudioDownloadButtonProps) => {
  const className = [
    baseClassName,
    "disabled" in props && props.disabled
      ? disabledClassName
      : interactiveClassName,
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = props.children ?? (
    <>
      <DownloadIcon className={props.iconClassName} />
      {props.label}
    </>
  );

  if ("href" in props) {
    const linkProps = props as AudioDownloadButtonAsLink;
    return (
      <a
        href={linkProps.href}
        onClick={linkProps.onClick}
        download={linkProps.download ?? true}
        aria-label={linkProps.ariaLabel}
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      className={className}
    >
      {content}
    </button>
  );
};
