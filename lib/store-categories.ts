export const STORE_CATEGORY_OPTIONS = [
  {
    code: "restaurant_food",
    label: "식당·음식점",
  },
  {
    code: "cafe_dessert",
    label: "카페·간식·디저트",
  },
  {
    code: "fresh_produce_meat_seafood",
    label: "농·축·수산물",
  },
  {
    code: "grocery_banchan_dried",
    label: "식료품·반찬·건어물",
  },
  {
    code: "fashion_clothing_goods",
    label: "패션·의류·잡화",
  },
  {
    code: "home_furniture_appliance",
    label: "생활용품·가구·가전",
  },
  {
    code: "professional_service_repair",
    label: "전문 서비스·수리",
  },
] as const;

export type StoreCategoryCode = (typeof STORE_CATEGORY_OPTIONS)[number]["code"];

const STORE_CATEGORY_CODE_SET = new Set<string>(
  STORE_CATEGORY_OPTIONS.map((option) => option.code),
);

export function isStoreCategoryCode(value: string | null | undefined): value is StoreCategoryCode {
  return typeof value === "string" && STORE_CATEGORY_CODE_SET.has(value.trim());
}

export function getStoreCategoryLabel(code: string | null | undefined) {
  if (!code) {
    return null;
  }

  return (
    STORE_CATEGORY_OPTIONS.find((option) => option.code === code)?.label ?? null
  );
}
