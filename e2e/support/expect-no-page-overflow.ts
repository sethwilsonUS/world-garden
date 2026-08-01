import { expect, type Page } from "@playwright/test";

export const expectNoPageOverflow = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const suspects = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const overflowX = getComputedStyle(element).overflowX;
        const localOverflow = element.scrollWidth - element.clientWidth;
        return {
          element: element.id
            ? `${element.tagName.toLowerCase()}#${element.id}`
            : `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join(".")}`,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          localOverflow,
          overflowX,
          text: (element.textContent ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80),
        };
      })
      .filter(
        ({ left, right, localOverflow, overflowX }) =>
          left < -1 ||
          right > clientWidth + 1 ||
          (localOverflow > 1 && !["auto", "scroll"].includes(overflowX)),
      )
      .sort(
        (left, right) =>
          Math.max(right.right - clientWidth, right.localOverflow) -
          Math.max(left.right - clientWidth, left.localOverflow),
      )
      .slice(0, 8);

    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      suspects,
    };
  });
  expect(
    geometry.scrollWidth - geometry.clientWidth,
    `Page-wide overflow: ${geometry.scrollWidth - geometry.clientWidth}px; body width: ${geometry.bodyScrollWidth}; suspects: ${JSON.stringify(geometry.suspects)}`,
  ).toBeLessThanOrEqual(1);
};
