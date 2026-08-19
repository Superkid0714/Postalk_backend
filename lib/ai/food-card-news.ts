import type { SubmissionForGeneration } from "@/lib/ai/generation";

export type FoodCardNewsPlanCard = {
  key: "hero_cover" | "signature_detail" | "action_shot" | "closing_cta";
  title: string;
  visualFocus: string;
  copyDirection: string;
  composition: string;
  forbidden: string[];
};

export type FoodCardNewsCreativePlan = {
  concept: string;
  tone: string;
  cards: FoodCardNewsPlanCard[];
};

export type FoodCardNewsCardPrompt = {
  index: number;
  key: "hero_cover" | "signature_detail" | "action_shot" | "closing_cta";
  title: string;
  prompt: string;
};

function compactText(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

function buildFoodCardNewsCommonSpec(submission: SubmissionForGeneration) {
  const storeName = compactText(submission.stores?.store_name, "전통시장 음식점");
  const marketName = compactText(submission.stores?.market_name, "전통시장");
  const menuName = compactText(submission.target_menu_name, "대표 메뉴");
  const ownerName = compactText(submission.stores?.owner_name, "사장님");
  const priceText = compactText(submission.price_text, "가격 정보는 후처리로 표기");
  const appealPoint = compactText(submission.appeal_point, "현장에서 바로 먹고 싶은 식감과 온도감");
  const extraMessage = compactText(
    submission.extra_message,
    "전통시장 현장의 온기와 정직한 음식의 무드를 유지",
  );
  const shortCaption = compactText(
    submission.caption,
    `${menuName} 어떠세요? ${appealPoint}`,
  );

  return `
You are a world-class Korean food advertising art director creating one premium Instagram card image.
Create exactly one card image for this turn. Never create a collage, grid, or multi-page sheet.
This is FOOD ONLY. Do not reinterpret the subject as fashion, goods, or service content.

Merchant facts:
- Store name: ${storeName}
- Market: ${marketName}
- Owner reference: ${ownerName}
- Featured menu: ${menuName}
- Price text reference: ${priceText}
- Appeal point: ${appealPoint}
- Extra note: ${extraMessage}
- Suggested caption direction: ${shortCaption}

Global design rules:
- Canvas ratio: 1080x1350 vertical.
- This must feel like a luxury food advertisement prepared for a real merchant, not a generic card template.
- Focus on real-food photography quality, premium composition, believable texture, appetizing gloss, natural steam when appropriate, and strong subject separation.
- The dish must look richer, more tempting, and more professionally lit than a casual phone snapshot, while staying realistic.
- Use restrained Korean editorial styling with premium restaurant-poster energy.
- Avoid bland beige layouts, empty filler space, generic brochure compositions, collage chaos, fake icons, fake UI, stock-template mood, or obvious AI poster cheapness.
- If any text appears inside the image, keep it extremely minimal: at most one bold Korean headline plus one small price or store cue.
- Korean text should be short, thick, high-contrast, and naturally integrated. Never place long paragraphs or many labels.
- No unreadable tiny text. No distorted Hangul. No random English slogans unless naturally part of the design.
- Food must be the hero. No illustrated food, no fake 3D, no surreal garnish, no duplicated pieces, no malformed chopsticks or hands.
- Background and props should support the dish, not compete with it.
`.trim();
}

export function buildDefaultFoodCardNewsPlan(
  submission: SubmissionForGeneration,
): FoodCardNewsCreativePlan {
  const menuName = compactText(submission.target_menu_name, "대표 메뉴");
  const storeName = compactText(submission.stores?.store_name, "전통시장 음식점");
  const marketName = compactText(submission.stores?.market_name, "전통시장");
  const appealPoint = compactText(submission.appeal_point, "정직한 맛");

  return {
    concept: `${marketName}의 ${storeName}가 만드는 ${menuName}를 프리미엄 푸드 광고 카드뉴스로 표현`,
    tone: "진하고 고급스럽고 실제 음식 광고 같은 톤",
    cards: [
      {
        key: "hero_cover",
        title: "표지",
        visualFocus: `${menuName} 완성 접시의 히어로 컷, 강한 김, 윤기, 선명한 질감`,
        copyDirection: "메뉴 이름 중심의 매우 짧은 강한 헤드라인",
        composition: "세로형 풀블리드, 음식이 화면 대부분을 차지, 상단에 헤드라인 공간",
        forbidden: ["밋밋한 템플릿", "정보과다", "잡다한 소품"],
      },
      {
        key: "signature_detail",
        title: "시그니처",
        visualFocus: `${menuName}의 핵심 질감과 양념 디테일, ${appealPoint}`,
        copyDirection: "먹고 싶게 만드는 한 줄",
        composition: "타이트한 클로즈업, 음식 확대, 텍스트는 최소",
        forbidden: ["여백만 많은 잡지 레이아웃", "불필요한 메뉴판 재현"],
      },
      {
        key: "action_shot",
        title: "액션",
        visualFocus: `젓가락이나 집게로 ${menuName}를 들어 올리는 순간`,
        copyDirection: "행동을 유도하는 짧은 문장 또는 무카피",
        composition: "손과 음식의 상호작용이 자연스럽게 보이는 역동적 구도",
        forbidden: ["비정상적인 손", "어색한 젓가락", "비현실적 음식 구조"],
      },
      {
        key: "closing_cta",
        title: "마감",
        visualFocus: `${storeName}와 ${marketName}의 정체성이 살아있는 마감 포스터`,
        copyDirection: "저장하고 방문하고 싶게 만드는 마감형 카피",
        composition: "조금 더 정돈된 포스터 구도, 음식과 짧은 브랜드 정보",
        forbidden: ["정보 페이지 느낌", "단순 배경 카드", "전단지 느낌"],
      },
    ],
  };
}

function findPlanCard(
  plan: FoodCardNewsCreativePlan | null | undefined,
  key: FoodCardNewsCardPrompt["key"],
) {
  return plan?.cards.find((card) => card.key === key) ?? null;
}

export function isFoodCardNewsEligible(submission: SubmissionForGeneration) {
  const source = `${submission.store_type} ${submission.target_menu_name}`.toLowerCase();

  return /식당|음식|카페|디저트|간식|분식|반찬|수산|축산|농산|food|cafe|dessert|bakery|restaurant|market/.test(
    source,
  );
}

export function buildFoodCardNewsPrompts(
  submission: SubmissionForGeneration,
  plan?: FoodCardNewsCreativePlan | null,
): FoodCardNewsCardPrompt[] {
  const common = buildFoodCardNewsCommonSpec(submission);
  const creativePlan = plan ?? buildDefaultFoodCardNewsPlan(submission);
  const menuName = compactText(submission.target_menu_name, "대표 메뉴");
  const storeName = compactText(submission.stores?.store_name, "전통시장 음식점");
  const marketName = compactText(submission.stores?.market_name, "전통시장");

  return [
    {
      index: 0,
      key: "hero_cover",
      title: "표지",
      prompt: `${common}

Creative planning layer:
- Campaign concept: ${creativePlan.concept}
- Overall tone: ${creativePlan.tone}
- Card role: ${findPlanCard(creativePlan, "hero_cover")?.title ?? "표지"}
- Visual focus: ${findPlanCard(creativePlan, "hero_cover")?.visualFocus ?? ""}
- Copy direction: ${findPlanCard(creativePlan, "hero_cover")?.copyDirection ?? ""}
- Composition: ${findPlanCard(creativePlan, "hero_cover")?.composition ?? ""}
- Forbidden: ${(findPlanCard(creativePlan, "hero_cover")?.forbidden ?? []).join(", ")}

Create card 1 only: hero cover card.
- Full-bleed hero food advertisement image for ${menuName}.
- The dish should dominate the frame with immediate craving appeal.
- Show the food at its most delicious moment: rich sauce, steam, gloss, juicy texture, clear ingredient detail.
- Lighting should feel premium and cinematic, like a restaurant campaign poster.
- Use a darker or cleaner background so the food pops hard.
- If text appears, allow only one short bold Korean headline such as the menu name and optionally one small price cue.
- The result must feel high-end, premium, and instantly postable on Instagram.`,
    },
    {
      index: 1,
      key: "signature_detail",
      title: "시그니처",
      prompt: `${common}

Creative planning layer:
- Campaign concept: ${creativePlan.concept}
- Overall tone: ${creativePlan.tone}
- Card role: ${findPlanCard(creativePlan, "signature_detail")?.title ?? "시그니처"}
- Visual focus: ${findPlanCard(creativePlan, "signature_detail")?.visualFocus ?? ""}
- Copy direction: ${findPlanCard(creativePlan, "signature_detail")?.copyDirection ?? ""}
- Composition: ${findPlanCard(creativePlan, "signature_detail")?.composition ?? ""}
- Forbidden: ${(findPlanCard(creativePlan, "signature_detail")?.forbidden ?? []).join(", ")}

Create card 2 only: signature detail card.
- Tighter composition focusing on the strongest selling detail of ${menuName}.
- Emphasize texture, sauce, char, crispness, moisture, steam, or filling depending on the dish.
- Make it feel like the shot that makes a customer stop scrolling immediately.
- Use close-up food advertising photography, not a magazine spread with lots of empty space.
- Show strong premium styling with a few restrained props only if they increase appetite.
- If text appears, keep it to one short selling phrase only.`,
    },
    {
      index: 2,
      key: "action_shot",
      title: "액션",
      prompt: `${common}

Creative planning layer:
- Campaign concept: ${creativePlan.concept}
- Overall tone: ${creativePlan.tone}
- Card role: ${findPlanCard(creativePlan, "action_shot")?.title ?? "액션"}
- Visual focus: ${findPlanCard(creativePlan, "action_shot")?.visualFocus ?? ""}
- Copy direction: ${findPlanCard(creativePlan, "action_shot")?.copyDirection ?? ""}
- Composition: ${findPlanCard(creativePlan, "action_shot")?.composition ?? ""}
- Forbidden: ${(findPlanCard(creativePlan, "action_shot")?.forbidden ?? []).join(", ")}

Create card 3 only: action shot card.
- Capture a dynamic serving or eating moment around ${menuName}: chopsticks lifting, spoon scooping, sauce pouring, slicing, plating, or steam rising.
- The action must feel believable, clean, appetizing, and energetic.
- Hands, utensils, and food proportions must look anatomically and physically correct.
- Composition should still feel premium and controlled, not messy.
- This card should feel alive and social-media strong, while still looking like a professional ad.
- If text appears, use only a tiny cue or no text.`,
    },
    {
      index: 3,
      key: "closing_cta",
      title: "마감",
      prompt: `${common}

Creative planning layer:
- Campaign concept: ${creativePlan.concept}
- Overall tone: ${creativePlan.tone}
- Card role: ${findPlanCard(creativePlan, "closing_cta")?.title ?? "마감"}
- Visual focus: ${findPlanCard(creativePlan, "closing_cta")?.visualFocus ?? ""}
- Copy direction: ${findPlanCard(creativePlan, "closing_cta")?.copyDirection ?? ""}
- Composition: ${findPlanCard(creativePlan, "closing_cta")?.composition ?? ""}
- Forbidden: ${(findPlanCard(creativePlan, "closing_cta")?.forbidden ?? []).join(", ")}

Create card 4 only: closing call-to-action card.
- Make a cleaner poster-like closing image featuring ${menuName} with strong brand finish.
- Include the feeling of a final memorable ad slide for ${storeName} in ${marketName}.
- Allow one short bold headline and a subtle store or market cue if text appears.
- Keep the image visually simpler than the hero card but still delicious and premium.
- This should feel like the final save-worthy slide of a polished food campaign, not an information sheet.`,
    },
  ];
}
