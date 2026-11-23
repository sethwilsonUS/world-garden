"use client";

import { useEffect, useEffectEvent, useState, type RefObject } from "react";

const PREFERENCE_KEY = "curio-player-keyboard-shortcuts";
export const SKIP_SECONDS = 10;

type PlayerShortcutActions = {
  onTogglePlayback?: () => void;
  onSkipBy?: (seconds: number) => void;
  onPreviousSection?: () => void;
  onNextSection?: () => void;
};

// These widgets use arrows, Space, or typed characters for their own navigation.
const widgetSelector = [
  "input, textarea, select, audio, video, dialog, [contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'], button, a, summary)",
  "[aria-activedescendant], [role='application'], [role='dialog'], [role='alertdialog']",
  "[role='textbox'], [role='searchbox'], [role='combobox'], [role='slider'], [role='spinbutton']",
  "[role='listbox'], [role='menu'], [role='menubar'], [role='grid'], [role='tree'], [role='treegrid']",
  "[role='tablist'], [role='radiogroup'], [role='toolbar'], [role='checkbox'], [role='switch']",
].join(", ");

function readShortcutsEnabled() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== "false";
  } catch (error) {
    console.debug("Could not read the player shortcuts preference.", error);
    return true;
  }
}

function shortcutAction(
  event: KeyboardEvent,
  {
    onTogglePlayback,
    onSkipBy,
    onPreviousSection,
    onNextSection,
  }: PlayerShortcutActions,
) {
  if (event.shiftKey) {
    switch (event.key.toLowerCase()) {
      case "n":
        return onNextSection;
      case "p":
        return onPreviousSection;
      default:
        return undefined;
    }
  }
  switch (event.key) {
    case " ":
      return onTogglePlayback;
    case "ArrowLeft":
      return onSkipBy && (() => onSkipBy(-SKIP_SECONDS));
    case "ArrowRight":
      return onSkipBy && (() => onSkipBy(SKIP_SECONDS));
  }
}

export function PlayerKeyboardShortcuts({
  scopeRef,
  ...actions
}: PlayerShortcutActions & { scopeRef?: RefObject<HTMLElement | null> }) {
  const [enabled, setEnabled] = useState(readShortcutsEnabled);
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const action = shortcutAction(event, actions);
    if (!action) return;
    const target = event.composedPath()[0];
    if (target instanceof Element) {
      if (target.closest(widgetSelector)) return;
      if (
        event.key === " " &&
        target.closest(
          "button, a[href], summary, [role='button'], [role='link']",
        )
      ) {
        return;
      }
    }
    if (
      document.querySelector(
        "dialog[open], [aria-modal='true']:not([hidden], [aria-hidden='true'])",
      )
    ) {
      return;
    }

    event.preventDefault();
    // Holding Space, Shift+N, or Shift+P must not toggle repeatedly or skip
    // through a whole article.
    if (!event.repeat || event.key.startsWith("Arrow")) action();
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event);
    const scope = scopeRef ? scopeRef.current : document.documentElement;
    scope?.addEventListener("keydown", onKeyDown);
    return () => scope?.removeEventListener("keydown", onKeyDown);
  }, [enabled, scopeRef]);

  function changePreference(next: boolean) {
    setEnabled(next);
    try {
      window.localStorage.setItem(PREFERENCE_KEY, String(next));
    } catch (error) {
      console.debug("Could not save the player shortcuts preference.", error);
    }
  }

  return (
    <details className="max-w-full text-sm text-foreground-2 open:w-full">
      <summary className="min-h-11 w-fit cursor-pointer content-center rounded-lg px-2 font-semibold">
        Keyboard shortcuts
      </summary>
      <p className="px-2">
        Use these keys on the article you’re listening to. On other pages, focus
        a Now Playing control first. Text fields and dialogs keep their usual
        keys.
      </p>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          <kbd>Space</kbd> to play or pause.
        </li>
        <li>
          <kbd>Left Arrow</kbd> or <kbd>Right Arrow</kbd> to move back or
          forward {SKIP_SECONDS} seconds.
        </li>
        <li>
          <kbd>Shift</kbd> + <kbd>N</kbd> for the next section.
        </li>
        <li>
          <kbd>Shift</kbd> + <kbd>P</kbd> for the previous section.
        </li>
      </ul>
      <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg px-2 font-semibold">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => changePreference(event.currentTarget.checked)}
          className="size-5 shrink-0 accent-accent"
        />
        Enable player shortcuts
      </label>
    </details>
  );
}
