import {
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayCategory,
  type OnThisDayOrder,
} from "@/lib/on-this-day-contracts";

export const DEFAULT_ON_THIS_DAY_CATEGORY: OnThisDayCategory = "selected";
export const DEFAULT_ON_THIS_DAY_ORDER: OnThisDayOrder = "newest";

export const parseOnThisDayCategory = (
  value: string | null | undefined,
): OnThisDayCategory => {
  if (
    value &&
    ON_THIS_DAY_CATEGORIES.includes(value as OnThisDayCategory)
  ) {
    return value as OnThisDayCategory;
  }
  return DEFAULT_ON_THIS_DAY_CATEGORY;
};

export const parseOnThisDayOrder = (
  value: string | null | undefined,
  category: OnThisDayCategory,
): OnThisDayOrder => {
  if (category === "holidays") return DEFAULT_ON_THIS_DAY_ORDER;
  return value === "oldest" ? "oldest" : DEFAULT_ON_THIS_DAY_ORDER;
};

export const buildOnThisDayHref = (
  pathname: string,
  {
    category,
    order,
  }: {
    category: OnThisDayCategory;
    order: OnThisDayOrder;
  },
): string => {
  const params = new URLSearchParams();
  if (category !== DEFAULT_ON_THIS_DAY_CATEGORY) {
    params.set("category", category);
  }
  if (category !== "holidays" && order !== DEFAULT_ON_THIS_DAY_ORDER) {
    params.set("order", order);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};
