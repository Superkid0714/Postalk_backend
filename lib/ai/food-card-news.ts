import type { SubmissionForGeneration } from "@/lib/ai/generation";

export type FoodCardNewsCardKey =
  | "cover_vertical_still_life"
  | "dark_flatlay_editorial"
  | "circular_editorial_layout"
  | "vertical_quote_band"
  | "closing_information";

export type FoodCardNewsPlanCard = {
  key: FoodCardNewsCardKey;
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
  key: FoodCardNewsCardKey;
  title: string;
  prompt: string;
};

function compactText(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

function optionalText(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function sanitizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeHashTagLabel(value: string) {
  return value.replace(/\s+/g, "");
}

function splitVerticalLabel(value: string, maxLength = 4) {
  const cleaned = sanitizeLabel(value).replace(/\s+/g, "");

  if (!cleaned) {
    return "한 / 장";
  }

  return cleaned
    .slice(0, maxLength)
    .split("")
    .join(" / ");
}

function buildFoodCardNewsContext(submission: SubmissionForGeneration) {
  const storeName = compactText(submission.stores?.store_name, "전통시장 음식점");
  const marketName = compactText(submission.stores?.market_name, "전통시장");
  const menuName = compactText(submission.target_menu_name, "대표 메뉴");
  const ownerName = compactText(submission.stores?.owner_name, "사장님");
  const priceText = optionalText(submission.price_text);
  const appealPoint = compactText(
    submission.appeal_point,
    "시장 현장에서 바로 먹고 싶어지는 식감과 온도감",
  );
  const extraMessage = compactText(
    submission.extra_message,
    "전통시장 현장의 온기와 정직한 손맛을 유지",
  );
  const caption = compactText(
    submission.caption,
    `${menuName}의 먹음직스러운 장면을 중심으로 카드뉴스 구성`,
  );

  return {
    storeName,
    marketName,
    menuName,
    ownerName,
    priceText,
    appealPoint,
    extraMessage,
    caption,
    menuVerticalLabel: splitVerticalLabel(menuName, 4),
    marketVerticalLabel: splitVerticalLabel(marketName, 4),
    storeHashLabel: sanitizeHashTagLabel(storeName),
    marketHashLabel: sanitizeHashTagLabel(marketName),
  };
}

function buildCommonSpec(submission: SubmissionForGeneration) {
  const context = buildFoodCardNewsContext(submission);
  const sourceFacts = [
    `- Store name: ${context.storeName}`,
    `- Market location label: ${context.marketName}`,
    `- Owner reference: ${context.ownerName}`,
    `- Featured menu: ${context.menuName}`,
    context.priceText ? `- Verified price cue: ${context.priceText}` : null,
    `- Appeal point from merchant: ${context.appealPoint}`,
    `- Extra merchant note: ${context.extraMessage}`,
    `- Caption direction reference: ${context.caption}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `
You are a senior editorial designer specializing in Korean food magazines and cookbook spreads.
Create exactly one Instagram card image for this turn. Never combine multiple cards into one sheet.
This series is FOOD ONLY and must look like a refined Korean editorial food campaign.

Series source facts:
${sourceFacts}

Mandatory production rules:
- Canvas: 1080 x 1350 vertical, one image only.
- Use a premium editorial direction inspired by a luxury cookbook spread and Michelin-level menu design.
- Respect this restrained palette only:
  - light page background #F6F1E4
  - dark page background #221D19
  - body text ink #2A2620
  - light-page secondary text #8B8175
  - dark-page secondary text #B5AB9C
  - photo overlay text #F0EADD
  - thin rules #D8CDB6
  - seal and color-band accent #7E2E24
- Typography mood: Korean serif or Myeongjo only, light or regular only, never bold display fonts.
- English, if any, must be Garamond-like serif and used sparingly.
- Use Korean vertical editorial composition tastefully.
- Only these Korean-aesthetic motifs are allowed: vertical typesetting, subtle cloud watermark line art, seal stamp.
- Forbidden motifs: taeguk, hanbok, lanterns, knots, fans, calligraphy brush fonts, torn paper textures, glow, neon, stickers, speech bubbles, icons, emojis, thick outlines.
- Food must remain realistic, delicious, and premium. No surreal food, no malformed utensils, no fake hands, no collage board.
- Avoid generic ad-template look. This should feel like an art-directed editorial food card.
- Keep on-image copy minimal and elegant. Never place long paragraphs everywhere.
- Never output placeholder copy such as "가격 정보는 후처리", "가격 문의", or invented dummy values.
- If verified price text is not provided, omit price copy entirely and lean on appetite, craft, atmosphere, and merchant appeal instead.
- If Korean text rendering quality becomes unreliable, prioritize layout fidelity, realistic food photography mood, and reserved placeholder-like short text treatment rather than broken text noise.
`.trim();
}

export function buildDefaultFoodCardNewsPlan(
  submission: SubmissionForGeneration,
): FoodCardNewsCreativePlan {
  const context = buildFoodCardNewsContext(submission);

  return {
    concept: `${context.marketName}의 ${context.storeName}를 요리책 지면형 인스타그램 카드뉴스 3장으로 구성`,
    tone: "전통시장 음식의 따뜻함 위에 고급 요리책 에디토리얼 무드를 덧입힌 톤",
    cards: [
      {
        key: "cover_vertical_still_life",
        title: "표지",
        visualFocus: `${context.menuName} 완성 접시를 전면 정물 히어로 컷으로 구성`,
        copyDirection: "세로쓰기 중심의 짧고 상징적인 표지 카피",
        composition: "풀블리드 음식 사진, 좌측 세로쓰기 3단, 우측 하단 낙관",
        forbidden: ["복잡한 배경", "카드 합성", "잡다한 소품"],
      },
      {
        key: "dark_flatlay_editorial",
        title: "속지 A",
        visualFocus: `${context.menuName}와 곁들임 요소를 어두운 플랫레이 지면으로 배치`,
        copyDirection: "짧은 제목 클러스터와 설명 덩어리 중심",
        composition: "짙은 상판 위 사물 55%, 빈 상판 45%, 텍스트는 빈 영역에만",
        forbidden: ["중앙 몰림", "음식 위 텍스트", "밝은 배경"],
      },
      {
        key: "circular_editorial_layout",
        title: "속지 B",
        visualFocus: `${context.menuName}의 클로즈업과 작업 장면을 원형 컷 2개로 편집`,
        copyDirection: "짧은 제목과 소제목, 세로 라벨 중심",
        composition: "밝은 지면, 원형 사진 2개, 좌측 세로 라벨, 넓은 여백",
        forbidden: ["사각형 사진 배열", "과도한 장식", "무거운 레이아웃"],
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

function buildPlanningLayer(
  plan: FoodCardNewsCreativePlan,
  cardKey: FoodCardNewsCardPrompt["key"],
) {
  const card = findPlanCard(plan, cardKey);

  return `
Creative planning layer:
- Campaign concept: ${plan.concept}
- Overall tone: ${plan.tone}
- Card role: ${card?.title ?? ""}
- Visual focus: ${card?.visualFocus ?? ""}
- Copy direction: ${card?.copyDirection ?? ""}
- Composition: ${card?.composition ?? ""}
- Forbidden: ${(card?.forbidden ?? []).join(", ")}
`.trim();
}

export function buildFoodCardNewsPrompts(
  submission: SubmissionForGeneration,
  plan?: FoodCardNewsCreativePlan | null,
): FoodCardNewsCardPrompt[] {
  const common = buildCommonSpec(submission);
  const creativePlan = plan ?? buildDefaultFoodCardNewsPlan(submission);
  const context = buildFoodCardNewsContext(submission);
  const coverPriceCue = context.priceText
    ? `  - short supporting cue: ${context.priceText}`
    : "  - omit price copy and keep the supporting cue focused on appetite and atmosphere";
  const bodyPriceCue = context.priceText
    ? `  - verified price cue: ${context.priceText}`
    : "  - no price cue; focus instead on craft, freshness, and the merchant's signature appeal";

  const prompts: FoodCardNewsCardPrompt[] = [
    {
      index: 0,
      key: "cover_vertical_still_life",
      title: "표지",
      prompt: `${common}

${buildPlanningLayer(creativePlan, "cover_vertical_still_life")}

Create card 1 only: cover card with vertical still-life composition.
- Full-bleed hero food photograph filling the entire 1080x1350 canvas.
- The featured dish is ${context.menuName}. It must look like the signature finished plate from ${context.storeName}.
- Place the dish around the lower third so the upper area feels visually calmer, like an editorial cover with breathing room.
- Use a textured single-tone wall or restrained backdrop behind the dish. Keep it elegant, quiet, and uncluttered.
- Add a soft dark veil from left to right to create legibility for vertical cover typography.
- Use refined Korean vertical editorial text treatment on the left side only, inspired by the fixed prompt structure.
- Include only very short cover text cues based on:
  - main vertical title: ${context.menuName}
  - market cue: ${context.marketName}
${coverPriceCue}
- Add a small traditional seal-like square accent at lower right in muted deep red.
- Do not use cloud watermark on this card.
- The overall result must feel like a premium Korean cookbook-meets-Instagram cover, not a cheap poster.`,
    },
    {
      index: 1,
      key: "dark_flatlay_editorial",
      title: "속지 A",
      prompt: `${common}

${buildPlanningLayer(creativePlan, "dark_flatlay_editorial")}

Create card 2 only: dark flat-lay editorial page.
- This card must be a dark page using an almost black-brown tabletop close to #221D19.
- Top-down flat-lay composition across the full canvas.
- Arrange the featured food, small side elements, and market-serving props diagonally from lower left to upper right.
- The objects should occupy about 55 percent of the frame, leaving about 45 percent as empty dark tabletop for editorial text clusters.
- Use only restrained short Korean text clusters placed in the empty tabletop area, never on top of food.
- Use a small vertical label near upper left based on ${context.marketVerticalLabel}.
- The text-cluster mood should communicate real selling points from merchant facts:
  - appeal point: ${context.appealPoint}
  - extra note: ${context.extraMessage}
  - caption direction: ${context.caption}
- Keep each text block short and elegant, like cookbook side notes.
- Lighting should create crisp but short shadows, emphasizing premium editorial food styling.
- No cloud watermark on this dark page.`,
    },
    {
      index: 2,
      key: "circular_editorial_layout",
      title: "속지 B",
      prompt: `${common}

${buildPlanningLayer(creativePlan, "circular_editorial_layout")}

Create card 3 only: bright editorial page with circular photo cutouts.
- Use a clean light page background #F6F1E4 with abundant negative space.
- Build the page around two circular photo windows placed diagonally, one large and one smaller.
- The large circular cutout should focus on the most appetizing close-up of ${context.menuName}.
- The smaller circular cutout should show a secondary action or preparation detail connected to the dish.
- On the left, create restrained vertical label columns inspired by editorial Myeongjo layout using ${context.menuVerticalLabel}.
- Add short title and note clusters only, in a calm high-end cookbook tone.
- Suggested short copy source:
  - menu: ${context.menuName}
${bodyPriceCue}
  - merchant appeal: ${context.appealPoint}
- Include one subtle cloud watermark only in a corner, cropped off the edge, as thin line art.
- The page must feel airy, balanced, and luxuriously sparse.`,
    },
    {
      index: 3,
      key: "vertical_quote_band",
      title: "속지 C",
      prompt: `${common}

${buildPlanningLayer(creativePlan, "vertical_quote_band")}

Create card 4 only: bright page with a strong vertical quote band.
- Use a light page background #F6F1E4.
- Build a tall deep-red vertical band on the right using #7E2E24, cropped at the top edge, ending around the upper-middle area.
- On that color band, place a short elegant vertical quote in Korean inspired by the merchant's real selling point.
- Quote source material must only come from merchant facts such as:
  - appeal point: ${context.appealPoint}
  - extra note: ${context.extraMessage}
  - caption direction: ${context.caption}
- Include a small upper-left caption box with only minimal store and market identifiers:
  - ${context.storeName}
  - ${context.marketName}
- Place one rectangular food or cooking-scene photo across the lower area, partially overlapping the lower end of the vertical band.
- This card should feel like a sophisticated editorial pull-quote spread.
- Do not add cloud motifs or extra headline blocks here.`,
    },
    {
      index: 4,
      key: "closing_information",
      title: "마감",
      prompt: `${common}

${buildPlanningLayer(creativePlan, "closing_information")}

Create card 5 only: closing information page without a large photo.
- Use a clean light page background #F6F1E4.
- Add two subtle cloud watermark line-art motifs, one cropped into the top-left corner and one cropped into the bottom-right corner.
- Build a centered editorial information stack.
- The page should feel like the final closing slide of a premium cookbook-style campaign.
- Use only concise centered information from verified merchant facts:
  - store name: ${context.storeName}
  - market name: ${context.marketName}
  - featured menu: ${context.menuName}
${bodyPriceCue}
  - closing mood from caption: ${context.caption}
- Add a refined short closing sentence in Korean based on the merchant's tone, but keep it minimal and elegant.
- Add one small seal accent near the lower center in deep red.
- No icons, no phone icons, no map pins, no UI elements, no fake QR.
- Make it feel finished, save-worthy, and brand-consistent with the previous four cards.`,
    },
  ];

  return prompts.slice(0, creativePlan.cards.length);
}
