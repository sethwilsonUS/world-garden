// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerKeyboardShortcuts } from "./PlayerKeyboardShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function press(
  key: string,
  target: EventTarget = document.body,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("PlayerKeyboardShortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actions = {
    onTogglePlayback: vi.fn(),
    onSkipBy: vi.fn(),
    onNextSection: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<PlayerKeyboardShortcuts {...actions} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("plays or pauses, seeks by ten seconds, and advances the queue", () => {
    expect(press(" ")).toBe(true);
    expect(press("ArrowLeft")).toBe(true);
    expect(press("ArrowRight")).toBe(true);
    expect(press("N", document.body, { shiftKey: true })).toBe(true);
    expect(actions.onTogglePlayback).toHaveBeenCalledOnce();
    expect(actions.onSkipBy.mock.calls).toEqual([[-10], [10]]);
    expect(actions.onNextSection).toHaveBeenCalledOnce();
  });

  it("scopes shortcuts to the player when navigating away and restores the article scope on return", () => {
    const play = document.createElement("button");
    container.appendChild(play);
    for (const scopeRef of [{ current: container }, undefined]) {
      act(() => root.render(<PlayerKeyboardShortcuts {...actions} scopeRef={scopeRef} />));
      for (const [key, options] of [
        [" ", {}],
        ["ArrowLeft", {}],
        ["ArrowRight", {}],
        ["N", { shiftKey: true }],
      ] as const) {
        expect(press(key, document.body, options)).toBe(scopeRef === undefined);
      }
      play.focus();
      expect(press("ArrowRight", play)).toBe(true);
      expect(press("N", play, { shiftKey: true })).toBe(true);
      expect(press(" ", play)).toBe(false);
    }
  });

  it("intercepts only available actions and releases keys when the player closes", () => {
    act(() =>
      root.render(
        <PlayerKeyboardShortcuts onNextSection={actions.onNextSection} />,
      ),
    );
    expect(press(" ")).toBe(false);
    expect(press("ArrowLeft")).toBe(false);
    expect(press("ArrowRight")).toBe(false);
    expect(press("N", document.body, { shiftKey: true })).toBe(true);
    act(() =>
      root.render(
        <PlayerKeyboardShortcuts onTogglePlayback={actions.onTogglePlayback} />,
      ),
    );
    expect(press("N", document.body, { shiftKey: true })).toBe(false);
    act(() => root.render(null));
    expect(press(" ")).toBe(false);
  });

  it("leaves composing, browser and widget key combinations alone", () => {
    for (const options of [
      { isComposing: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      expect(press("ArrowLeft", document.body, options)).toBe(false);
    }
    expect(press("n")).toBe(false);
    container.addEventListener("keydown", (event) => event.preventDefault(), {
      once: true,
    });
    press(" ", container);
    expect(actions.onTogglePlayback).not.toHaveBeenCalled();
    expect(actions.onSkipBy).not.toHaveBeenCalled();
  });

  it("preserves typing, native control activation and arrow navigation within widgets", () => {
    const form = document.createElement("div");
    form.innerHTML = `
      <input type="search"><textarea></textarea><select></select><input type="range">
      <div contenteditable="plaintext-only"><span>Write here</span></div>
      <div role="region" tabindex="0" aria-label="Scrollable chart"></div>
      <div role="textbox"></div><div role="tablist"><button role="tab">First</button></div>
    `;
    container.appendChild(form);
    for (const target of form.querySelectorAll(
      "input, textarea, select, span, [tabindex], [role=textbox], button",
    )) {
      expect(press(" ", target)).toBe(false);
      expect(press("ArrowRight", target)).toBe(false);
      expect(press("N", target, { shiftKey: true })).toBe(false);
    }
    for (const name of ["button", "a", "summary"]) {
      const control = document.createElement(name);
      if (control instanceof HTMLAnchorElement) control.href = "#article";
      container.appendChild(control);
      expect(press(" ", control)).toBe(false);
      expect(press("ArrowRight", control)).toBe(true);
    }
  });

  it("leaves a native or ARIA modal in charge even before focus moves inside", () => {
    for (const html of [
      "<dialog open></dialog>",
      '<div role="dialog" aria-modal="true"></div>',
    ]) {
      const modal = document.createElement("div");
      modal.innerHTML = html;
      container.appendChild(modal);
      expect(press("ArrowRight")).toBe(false);
      modal.remove();
    }
    expect(press("ArrowRight")).toBe(true);
  });

  it("does not repeat toggles or advance through multiple sections on a held key", () => {
    expect(press(" ", document.body, { repeat: true })).toBe(true);
    expect(press("N", document.body, { shiftKey: true, repeat: true })).toBe(
      true,
    );
    expect(actions.onTogglePlayback).not.toHaveBeenCalled();
    expect(actions.onNextSection).not.toHaveBeenCalled();
    expect(press("ArrowRight", document.body, { repeat: true })).toBe(true);
    expect(actions.onSkipBy).toHaveBeenCalledWith(10);
  });

  it("documents the keys and remembers the choice to disable shortcuts", () => {
    expect(container.querySelector("summary")?.textContent).toBe(
      "Keyboard shortcuts",
    );
    const checkbox = () =>
      container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(checkbox().labels?.[0]?.textContent).toContain(
      "Enable player shortcuts",
    );
    act(() => checkbox().click());
    expect(press(" ")).toBe(false);
    act(() => root.render(null));
    act(() => root.render(<PlayerKeyboardShortcuts {...actions} />));
    expect(checkbox().checked).toBe(false);
    expect(press("N", document.body, { shiftKey: true })).toBe(false);
    act(() => checkbox().click());
    expect(press(" ")).toBe(true);
  });
});
