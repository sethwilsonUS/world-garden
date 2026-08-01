"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
  const tooltipRef = useRef<HTMLSpanElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const trigger = wrapperRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const placeTooltip = () => {
      const margin = 16;
      const gap = 7;
      const triggerBox = trigger.getBoundingClientRect();
      const tooltipBox = tooltip.getBoundingClientRect();
      const width = Math.min(tooltipBox.width, window.innerWidth - margin * 2);
      const preferredLeft =
        align === "left" ? triggerBox.left : triggerBox.right - width;
      const left = Math.max(
        margin,
        Math.min(preferredLeft, window.innerWidth - width - margin),
      );
      const roomBelow = window.innerHeight - triggerBox.bottom - margin - gap;
      const roomAbove = triggerBox.top - margin - gap;
      const placeAbove = tooltipBox.height > roomBelow && roomAbove > roomBelow;
      const top = placeAbove
        ? Math.max(margin, triggerBox.top - tooltipBox.height - gap)
        : Math.min(
            triggerBox.bottom + gap,
            Math.max(margin, window.innerHeight - tooltipBox.height - margin),
          );

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.width = `${width}px`;
      tooltip.style.visibility = "visible";
    };

    placeTooltip();
    window.addEventListener("resize", placeTooltip);
    window.addEventListener("scroll", placeTooltip, true);
    return () => {
      window.removeEventListener("resize", placeTooltip);
      window.removeEventListener("scroll", placeTooltip, true);
    };
  }, [align, open, text]);

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
          // Focus and hover both reveal the tooltip before a click fires. Keep
          // pointer/touch activation open as well; Escape, blur, or an outside
          // press provide predictable dismissal without immediately toggling it
          // closed again.
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (
            !wrapperRef.current?.contains(event.relatedTarget as Node | null)
          ) {
            setOpen(false);
          }
        }}
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${buttonClassName}`.trim()}
      >
        {children ?? (
          <span
            aria-hidden="true"
            className="font-mono text-[0.6875rem] leading-none"
          >
            ?
          </span>
        )}
      </button>
      {open && (
        <span
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`fixed left-4 top-4 z-10 max-h-[calc(100dvh-32px)] w-[min(16rem,calc(100vw-32px))] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain break-words rounded-xl border px-[12px] py-[8px] text-left text-[0.75rem] font-normal leading-snug text-foreground shadow-2xl backdrop-blur-md [overflow-wrap:anywhere] invisible ${tooltipClassName}`.trim()}
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
