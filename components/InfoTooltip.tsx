"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

type InfoTooltipProps = {
  text: string;
  label: string;
  align?: "left" | "right";
  buttonClassName?: string;
  tooltipClassName?: string;
  children?: ReactNode;
};

export const InfoTooltip = ({
  text,
  label,
  align = "right",
  buttonClassName = "",
  tooltipClassName = "",
  children,
}: InfoTooltipProps) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
        className={`inline-flex size-8 items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${buttonClassName}`.trim()}
      >
        {children ?? (
          <span aria-hidden="true" className="font-mono text-[0.6875rem] leading-none">
            ?
          </span>
        )}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-[calc(100%+0.45rem)] z-10 w-56 rounded-xl border px-3 py-2 text-left text-[0.75rem] font-normal leading-snug text-foreground shadow-2xl backdrop-blur-md ${tooltipClassName}`.trim()}
          style={{
            backgroundColor: "var(--color-surface)",
            borderColor: "var(--color-border)",
            boxShadow:
              "0 18px 42px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.16)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
};
