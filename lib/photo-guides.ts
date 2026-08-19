import type { StoreCategoryCode } from "@/lib/store-categories";

export type PhotoGuideShot = {
  order: number;
  title: string;
  description: string;
  emphasis?: "required" | "recommended" | "highlight";
};

export type PhotoGuide = {
  category: StoreCategoryCode;
  commonShots: PhotoGuideShot[];
  categoryShots: PhotoGuideShot[];
  totalRecommendedShots: number;
};

const COMMON_SHOTS: PhotoGuideShot[] = [
  {
    order: 1,
    title: "간판이 보이는 정면",
    description: "가게 이름이 보이도록 정면에서 또렷하게 찍어주세요.",
    emphasis: "required",
  },
  {
    order: 2,
    title: "매장 입구",
    description: "손님이 들어가는 느낌이 보이도록 입구 전경을 찍어주세요.",
    emphasis: "recommended",
  },
  {
    order: 3,
    title: "내부 전체 분위기",
    description: "매장 안 분위기와 진열 상태가 보이게 한 컷 담아주세요.",
    emphasis: "recommended",
  },
];

const CATEGORY_PHOTO_GUIDES: Record<StoreCategoryCode, PhotoGuideShot[]> = {
  restaurant_food: [
    {
      order: 4,
      title: "메뉴판",
      description: "대표 메뉴와 가격이 보이도록 메뉴판을 찍어주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "사장님이 요리하는 모습",
      description: "직접 조리하는 순간을 자연스럽게 담아주세요.",
      emphasis: "recommended",
    },
    {
      order: 6,
      title: "전체 밥상",
      description: "반찬까지 다 나온 상차림을 위에서 또는 45도로 찍어주세요.",
      emphasis: "recommended",
    },
    {
      order: 7,
      title: "건더기 들어 올리기",
      description: "젓가락이나 숟가락으로 핵심 재료를 들어 올리는 장면을 찍어주세요.",
      emphasis: "highlight",
    },
    {
      order: 8,
      title: "한 입 포인트",
      description: "고기를 소스에 찍거나 밥 위에 올린 가까운 장면을 찍어주세요.",
      emphasis: "recommended",
    },
  ],
  cafe_dessert: [
    {
      order: 4,
      title: "메뉴판",
      description: "음료와 디저트 이름, 가격이 보이게 찍어주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "진열대",
      description: "빵이나 디저트가 풍성하게 보이도록 진열대를 담아주세요.",
      emphasis: "recommended",
    },
    {
      order: 6,
      title: "제작 과정",
      description: "커피를 내리거나 빵을 만드는 모습을 찍어주세요.",
      emphasis: "recommended",
    },
    {
      order: 7,
      title: "완성 메뉴",
      description: "그릇이나 컵에 담긴 대표 메뉴를 정면 또는 45도로 찍어주세요.",
      emphasis: "highlight",
    },
    {
      order: 8,
      title: "디테일 액션",
      description: "빵을 자르거나 음료를 젓는 장면을 가까이서 담아주세요.",
      emphasis: "recommended",
    },
  ],
  fresh_produce_meat_seafood: [
    {
      order: 4,
      title: "매대 전체",
      description: "물건이 쌓인 매대 전체가 보이도록 찍어주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "대표 상품",
      description: "가장 추천하는 상품 하나를 또렷하게 찍어주세요.",
      emphasis: "highlight",
    },
    {
      order: 6,
      title: "손질 장면",
      description: "과일을 자르거나 고기, 생선을 손질하는 모습을 담아주세요.",
      emphasis: "recommended",
    },
    {
      order: 7,
      title: "포장 장면",
      description: "손질된 상품을 담거나 포장하는 순간을 찍어주세요.",
      emphasis: "recommended",
    },
  ],
  grocery_banchan_dried: [
    {
      order: 4,
      title: "메뉴판 또는 품목표",
      description: "반찬이나 건어물 종류, 가격이 보이도록 찍어주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "대표 추천 메뉴",
      description: "사장님이 제일 추천하는 품목을 중심으로 찍어주세요.",
      emphasis: "highlight",
    },
    {
      order: 6,
      title: "담는 장면",
      description: "반찬이나 건어물을 통 또는 용기에 담는 모습을 찍어주세요.",
      emphasis: "recommended",
    },
    {
      order: 7,
      title: "포장 완료",
      description: "뚜껑을 닫거나 포장을 마친 결과물을 가까이서 담아주세요.",
      emphasis: "recommended",
    },
  ],
  fashion_clothing_goods: [
    {
      order: 4,
      title: "매장 전체 상품",
      description: "옷이나 잡화가 진열된 전체 분위기를 담아주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "오늘의 추천 상품",
      description: "대표로 홍보할 상품 하나를 전체가 보이게 찍어주세요.",
      emphasis: "highlight",
    },
    {
      order: 6,
      title: "소재 디테일",
      description: "천, 단추, 재질을 손으로 만지는 장면을 가까이서 찍어주세요.",
      emphasis: "recommended",
    },
    {
      order: 7,
      title: "착용 또는 사용 느낌",
      description: "실제 사용감이 느껴지는 각도로 상품을 담아주세요.",
      emphasis: "recommended",
    },
  ],
  home_furniture_appliance: [
    {
      order: 4,
      title: "매장 내부 전체",
      description: "물건이 쌓여 있는 매장 전체 모습을 넓게 찍어주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "대표 판매 상품",
      description: "가장 잘 팔리는 대표 상품 하나를 중심으로 찍어주세요.",
      emphasis: "highlight",
    },
    {
      order: 6,
      title: "작동 장면",
      description: "가구나 가전을 실제로 작동시키는 모습을 찍어주세요.",
      emphasis: "recommended",
    },
    {
      order: 7,
      title: "기능 디테일",
      description: "핵심 기능이나 질감이 보이는 가까운 장면을 담아주세요.",
      emphasis: "recommended",
    },
  ],
  professional_service_repair: [
    {
      order: 4,
      title: "작업 전 상태",
      description: "수선 또는 수리 전 상태를 분명하게 보여주세요.",
      emphasis: "required",
    },
    {
      order: 5,
      title: "전문 도구",
      description: "가위, 재봉틀, 공구 등 작업 도구를 찍어주세요.",
      emphasis: "recommended",
    },
    {
      order: 6,
      title: "작업 중 장면",
      description: "직접 고치거나 다듬는 핵심 순간을 담아주세요.",
      emphasis: "highlight",
    },
    {
      order: 7,
      title: "작업 후 결과",
      description: "완성된 결과물을 전후 비교가 되게 찍어주세요.",
      emphasis: "recommended",
    },
  ],
};

export function getPhotoGuideByCategory(category: StoreCategoryCode): PhotoGuide {
  const categoryShots = CATEGORY_PHOTO_GUIDES[category];

  return {
    category,
    commonShots: COMMON_SHOTS,
    categoryShots,
    totalRecommendedShots: COMMON_SHOTS.length + categoryShots.length,
  };
}

export function findPhotoGuideShot(
  category: StoreCategoryCode,
  shotOrder: number,
) {
  const guide = getPhotoGuideByCategory(category);

  return (
    guide.commonShots.find((shot) => shot.order === shotOrder) ??
    guide.categoryShots.find((shot) => shot.order === shotOrder) ??
    null
  );
}
