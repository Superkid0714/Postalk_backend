import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import type { SubmissionForGeneration } from "@/lib/ai/generation";
import type {
  FoodCardNewsSourceSlotKey,
  ReviewedFoodCardNewsPlan,
} from "@/lib/ai/food-card-news-review";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const BRIGHT_BG = "#F6F1E4";
const DARK_BG = "#221D19";
const INK = "#2A2620";
const SUBTLE_BRIGHT = "#8B8175";
const PAPER = "#F0EADD";
const LINE = "#D8CDB6";
const ACCENT = "#7E2E24";
const FONT_FAMILY = "PostalkCardNewsKR";

let embeddedFontFaceCss: string | null = null;

function getEmbeddedFontFaceCss() {
  if (embeddedFontFaceCss) {
    return embeddedFontFaceCss;
  }

  const fontPath = path.join(
    process.cwd(),
    "assets",
    "fonts",
    "NotoSansCJKkr-Regular.otf",
  );
  const fontBytes = fs.readFileSync(fontPath);
  const fontBase64 = fontBytes.toString("base64");

  embeddedFontFaceCss = `
    @font-face {
      font-family: '${FONT_FAMILY}';
      src: url("data:font/otf;base64,${fontBase64}") format("opentype");
      font-weight: 400 700;
      font-style: normal;
    }
  `.trim();

  return embeddedFontFaceCss;
}

export type FoodCardNewsSourceAssets = {
  menuBoard: Buffer;
  coverPhoto: Buffer;
  flatlayPhoto: Buffer;
  detailPhoto: Buffer;
  cookingPhoto: Buffer;
  infoPhoto: Buffer;
};

type RenderCardSource = {
  title: string;
  subtitle: string;
  body: string[];
  selectedSlot: FoodCardNewsSourceSlotKey;
};

type RenderedFoodCardNewsCard = {
  index: number;
  key: "cover" | "flat_lay" | "circle_layout" | "quote_strip" | "info_page";
  title: string;
  bytes: Buffer;
  promptText: string;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactText(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  return value.trim();
}

function buildShortLine(value: string | null | undefined, fallback: string, maxLength: number) {
  const cleaned = compactText(value, fallback).replace(/\s+/g, " ").trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function splitKoreanText(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function truncateLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) {
    return lines;
  }

  const trimmed = lines.slice(0, maxLines);
  const lastIndex = trimmed.length - 1;
  trimmed[lastIndex] = `${trimmed[lastIndex].replace(/[.!\s]+$/g, "")}...`;
  return trimmed;
}

function buildTextBlockSvg(params: {
  x: number;
  y: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  fill: string;
  fontWeight?: number | string;
  letterSpacing?: number;
  textAnchor?: "start" | "middle" | "end";
}) {
  const {
    x,
    y,
    lines,
    fontSize,
    lineHeight,
    fill,
    fontWeight = 400,
    letterSpacing = 0,
    textAnchor = "start",
  } = params;

  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${fontWeight}" letter-spacing="${letterSpacing}" text-anchor="${textAnchor}">${lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("")}</text>`;
}

function svgBuffer(svg: string) {
  return Buffer.from(svg);
}

function pickSlotBuffer(
  assets: FoodCardNewsSourceAssets,
  slot: FoodCardNewsSourceSlotKey,
) {
  return assets[slot];
}

async function coverFoodPhoto(
  source: Buffer,
  width: number,
  height: number,
  gravity:
    | "center"
    | "north"
    | "south"
    | "east"
    | "west"
    | "northeast"
    | "northwest"
    | "southeast"
    | "southwest" = "center",
) {
  return sharp(source)
    .resize(width, height, {
      fit: "cover",
      position: gravity,
    })
    .png()
    .toBuffer();
}

async function containPhoto(
  source: Buffer,
  width: number,
  height: number,
  background: string,
) {
  return sharp(source)
    .resize(width, height, {
      fit: "contain",
      background,
    })
    .png()
    .toBuffer();
}

async function createCircularPhoto(source: Buffer, diameter: number) {
  const resized = await sharp(source)
    .resize(diameter, diameter, {
      fit: "cover",
      position: "center",
    })
    .png()
    .toBuffer();

  const circleMask = svgBuffer(`
    <svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="#ffffff" />
    </svg>
  `);

  return sharp(resized)
    .composite([
      {
        input: circleMask,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

function buildCardText(submission: SubmissionForGeneration) {
  const menu = compactText(submission.target_menu_name, "대표 메뉴");
  const market = compactText(submission.stores?.market_name, "전통시장");
  const store = compactText(submission.stores?.store_name, "가게명");
  const appeal = compactText(submission.appeal_point, "시장 한복판에서 눈길이 가는 대표 메뉴");
  const extra = compactText(
    submission.extra_message,
    "가게만의 인상과 분위기가 자연스럽게 느껴지는 한 끼",
  );
  const caption = compactText(
    submission.caption,
    `${menu} 어떠세요? ${appeal} ${extra}`,
  );
  const price = compactText(submission.price_text, "가격 문의");
  const coverTitle = buildShortLine(menu, "대표 메뉴", 10);
  const coverSummary = buildShortLine(appeal, "시장 한복판에서 먼저 눈길이 가는 메뉴", 24);
  const detailSummary = buildShortLine(extra, "가게만의 매력이 자연스럽게 느껴지는 한 접시", 26);
  const quote = buildShortLine(`${appeal}. ${extra}`, "정직한 한 끼의 매력이 남는 메뉴입니다", 34);
  const closing = buildShortLine(caption, `${menu}이 생각나는 순간 다시 찾고 싶은 한 끼`, 36);

  return {
    menu,
    market,
    store,
    appeal,
    extra,
    caption,
    price,
    coverTitle,
    coverSummary,
    detailSummary,
    quote,
    closing,
  };
}

async function renderCoverCard(
  submission: SubmissionForGeneration,
  assets: FoodCardNewsSourceAssets,
  reviewedCard: RenderCardSource,
) {
  const text = buildCardText(submission);
  const background = await coverFoodPhoto(
    pickSlotBuffer(assets, reviewedCard.selectedSlot),
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    "south",
  );
  const overlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
        <linearGradient id="coverShade" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1F1814" stop-opacity="0.78" />
          <stop offset="52%" stop-color="#261E18" stop-opacity="0.42" />
          <stop offset="100%" stop-color="#261E18" stop-opacity="0.06" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#coverShade)" />
      ${buildTextBlockSvg({
        x: 110,
        y: 180,
        lines: splitKoreanText(reviewedCard.title || text.menu, 6),
        fontSize: 84,
        lineHeight: 94,
        fill: PAPER,
        fontWeight: 700,
      })}
      ${buildTextBlockSvg({
        x: 116,
        y: 420,
        lines: [reviewedCard.subtitle || text.market, text.store],
        fontSize: 28,
        lineHeight: 40,
        fill: PAPER,
      })}
      <line x1="116" y1="510" x2="360" y2="510" stroke="${LINE}" stroke-width="2" opacity="0.9" />
      ${buildTextBlockSvg({
        x: 116,
        y: 575,
        lines: truncateLines(reviewedCard.body.length > 0 ? reviewedCard.body : splitKoreanText(text.coverSummary, 18), 2),
        fontSize: 34,
        lineHeight: 48,
        fill: PAPER,
        fontWeight: 500,
      })}
      <rect x="116" y="1120" rx="24" ry="24" width="220" height="78" fill="${ACCENT}" opacity="0.92" />
      ${buildTextBlockSvg({
        x: 226,
        y: 1172,
        lines: [buildShortLine(text.appeal, "정직한 손맛", 10)],
        fontSize: 30,
        lineHeight: 34,
        fill: PAPER,
        fontWeight: 700,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 874,
        y: 1180,
        lines: [text.price],
        fontSize: 28,
        lineHeight: 34,
        fill: PAPER,
        fontWeight: 600,
        textAnchor: "end",
      })}
    </svg>
  `);

  return sharp(background).composite([{ input: overlay }]).png().toBuffer();
}

async function renderFlatLayCard(
  submission: SubmissionForGeneration,
  assets: FoodCardNewsSourceAssets,
  reviewedCard: RenderCardSource,
) {
  const text = buildCardText(submission);
  const food = await coverFoodPhoto(
    pickSlotBuffer(assets, reviewedCard.selectedSlot),
    880,
    540,
    "center",
  );
  const menu = await containPhoto(assets.menuBoard, 250, 320, BRIGHT_BG);
  const baseOverlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${DARK_BG}" />
      <rect x="70" y="70" width="940" height="1210" rx="44" fill="#2B241F" />
      <rect x="110" y="970" width="860" height="220" rx="30" fill="#312924" />
      <line x1="110" y1="350" x2="970" y2="350" stroke="#5C5046" stroke-width="1.5" opacity="0.7" />
    </svg>
  `);
  const textOverlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="110" y="106" width="180" height="48" rx="24" fill="${ACCENT}" />
      ${buildTextBlockSvg({
        x: 200,
        y: 139,
        lines: ["대표 메뉴"],
        fontSize: 22,
        lineHeight: 28,
        fill: PAPER,
        fontWeight: 700,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 110,
        y: 225,
        lines: [reviewedCard.title || text.coverTitle],
        fontSize: 58,
        lineHeight: 56,
        fill: PAPER,
        fontWeight: 700,
      })}
      ${buildTextBlockSvg({
        x: 110,
        y: 308,
        lines: truncateLines(
          reviewedCard.body.length > 0
            ? reviewedCard.body
            : splitKoreanText(text.detailSummary, 20),
          2,
        ),
        fontSize: 28,
        lineHeight: 40,
        fill: "#C9BCAE",
      })}
      ${buildTextBlockSvg({
        x: 390,
        y: 1038,
        lines: ["가게 정보"],
        fontSize: 24,
        lineHeight: 28,
        fill: "#B8AA9A",
        fontWeight: 700,
      })}
      ${buildTextBlockSvg({
        x: 390,
        y: 1105,
        lines: [text.market, text.store],
        fontSize: 34,
        lineHeight: 42,
        fill: PAPER,
        fontWeight: 600,
      })}
      ${buildTextBlockSvg({
        x: 390,
        y: 1182,
        lines: [reviewedCard.subtitle || buildShortLine(text.appeal, "대표 메뉴의 인상", 18), text.price],
        fontSize: 26,
        lineHeight: 38,
        fill: "#C9BCAE",
        fontWeight: 600,
      })}
      ${buildTextBlockSvg({
        x: 920,
        y: 1224,
        lines: ["02"],
        fontSize: 24,
        lineHeight: 26,
        fill: "#B8AA9A",
        letterSpacing: 3,
      })}
    </svg>
  `);

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: DARK_BG,
    },
  })
    .composite([
      { input: baseOverlay },
      { input: food, left: 110, top: 390 },
      { input: menu, left: 120, top: 920 },
      { input: textOverlay },
    ])
    .png()
    .toBuffer();
}

async function renderCircleLayoutCard(
  submission: SubmissionForGeneration,
  assets: FoodCardNewsSourceAssets,
  reviewedCard: RenderCardSource,
) {
  const text = buildCardText(submission);
  const bigCircle = await createCircularPhoto(
    pickSlotBuffer(assets, reviewedCard.selectedSlot),
    540,
  );
  const smallCircle = await createCircularPhoto(assets.cookingPhoto, 220);
  const overlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${BRIGHT_BG}" />
      <rect x="76" y="74" width="928" height="1202" rx="42" fill="#FBF7EF" />
      <circle cx="700" cy="490" r="292" fill="none" stroke="#E5DAC6" stroke-width="2" />
      <circle cx="840" cy="1025" r="126" fill="none" stroke="#E5DAC6" stroke-width="2" />
      <rect x="110" y="106" width="184" height="48" rx="24" fill="${INK}" />
      ${buildTextBlockSvg({
        x: 202,
        y: 139,
        lines: ["한 입 포인트"],
        fontSize: 22,
        lineHeight: 28,
        fill: PAPER,
        fontWeight: 700,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 110,
        y: 236,
        lines: [reviewedCard.title || text.coverTitle],
        fontSize: 56,
        lineHeight: 52,
        fill: INK,
        fontWeight: 700,
      })}
      ${buildTextBlockSvg({
        x: 110,
        y: 320,
        lines: truncateLines(
          reviewedCard.body.length > 0
            ? reviewedCard.body
            : splitKoreanText(text.detailSummary, 18),
          2,
        ),
        fontSize: 24,
        lineHeight: 36,
        fill: SUBTLE_BRIGHT,
      })}
      <rect x="110" y="930" width="860" height="250" rx="28" fill="${PAPER}" />
      ${buildTextBlockSvg({
        x: 150,
        y: 1015,
        lines: [text.market],
        fontSize: 38,
        lineHeight: 50,
        fill: INK,
        fontWeight: 700,
      })}
      ${buildTextBlockSvg({
        x: 150,
        y: 1078,
        lines: [text.store, `포인트: ${reviewedCard.subtitle || buildShortLine(text.appeal, text.appeal, 16)}`, `가격: ${text.price}`],
        fontSize: 24,
        lineHeight: 36,
        fill: SUBTLE_BRIGHT,
      })}
      ${buildTextBlockSvg({
        x: 940,
        y: 1220,
        lines: ["03"],
        fontSize: 24,
        lineHeight: 26,
        fill: SUBTLE_BRIGHT,
      })}
    </svg>
  `);

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: BRIGHT_BG,
    },
  })
    .composite([
      { input: overlay },
      { input: bigCircle, left: 430, top: 220 },
      { input: smallCircle, left: 730, top: 915 },
    ])
    .png()
    .toBuffer();
}

async function renderQuoteStripCard(
  submission: SubmissionForGeneration,
  assets: FoodCardNewsSourceAssets,
  reviewedCard: RenderCardSource,
) {
  const text = buildCardText(submission);
  const food = await coverFoodPhoto(
    pickSlotBuffer(assets, reviewedCard.selectedSlot),
    1080,
    640,
    "center",
  );
  const baseOverlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${BRIGHT_BG}" />
      <rect x="86" y="700" width="908" height="540" rx="36" fill="#FBF7EF" />
      <rect x="0" y="0" width="${CANVAS_WIDTH}" height="640" fill="#000000" opacity="0.18" />
    </svg>
  `);
  const textOverlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="86" y="734" width="170" height="46" rx="23" fill="${ACCENT}" />
      ${buildTextBlockSvg({
        x: 171,
        y: 765,
        lines: [reviewedCard.title || "사장님 추천"],
        fontSize: 20,
        lineHeight: 24,
        fill: PAPER,
        fontWeight: 700,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 86,
        y: 830,
        lines: truncateLines(
          reviewedCard.body.length > 0
            ? reviewedCard.body
            : splitKoreanText(text.quote, 19),
          3,
        ),
        fontSize: 44,
        lineHeight: 58,
        fill: INK,
        fontWeight: 700,
      })}
      ${buildTextBlockSvg({
        x: 86,
        y: 1048,
        lines: [reviewedCard.subtitle || `${text.store} · ${text.market}`, `${text.menu} · ${text.price}`],
        fontSize: 26,
        lineHeight: 38,
        fill: SUBTLE_BRIGHT,
        fontWeight: 600,
      })}
      ${buildTextBlockSvg({
        x: 938,
        y: 1280,
        lines: ["04"],
        fontSize: 24,
        lineHeight: 26,
        fill: SUBTLE_BRIGHT,
      })}
    </svg>
  `);

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: BRIGHT_BG,
    },
  })
    .composite([
      { input: baseOverlay },
      { input: food, left: 0, top: 0 },
      { input: textOverlay },
    ])
    .png()
    .toBuffer();
}

async function renderInfoCard(
  submission: SubmissionForGeneration,
  assets: FoodCardNewsSourceAssets,
  reviewedCard: RenderCardSource,
) {
  const text = buildCardText(submission);
  const food = await coverFoodPhoto(
    pickSlotBuffer(assets, reviewedCard.selectedSlot),
    420,
    420,
    "center",
  );
  const baseOverlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${BRIGHT_BG}" />
      <rect x="80" y="80" width="920" height="1190" rx="44" fill="#FBF7EF" />
      <circle cx="170" cy="170" r="120" fill="none" stroke="#E8DCC8" stroke-width="1.5" opacity="0.9" />
      <circle cx="920" cy="1180" r="140" fill="none" stroke="#E8DCC8" stroke-width="1.5" opacity="0.9" />
    </svg>
  `);
  const textOverlay = svgBuffer(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${getEmbeddedFontFaceCss()}
        </style>
      </defs>
      <rect x="406" y="118" width="268" height="52" rx="26" fill="${ACCENT}" />
      ${buildTextBlockSvg({
        x: 540,
        y: 152,
        lines: ["POSTALK 추천"],
        fontSize: 22,
        lineHeight: 28,
        fill: PAPER,
        fontWeight: 700,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 540,
        y: 250,
        lines: [reviewedCard.title || "오늘 눈여겨볼 메뉴", reviewedCard.subtitle || text.coverTitle],
        fontSize: 52,
        lineHeight: 70,
        fill: INK,
        fontWeight: 700,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 540,
        y: 820,
        lines: truncateLines(
          reviewedCard.body.length > 0
            ? reviewedCard.body
            : splitKoreanText(text.closing, 24),
          3,
        ),
        fontSize: 30,
        lineHeight: 42,
        fill: SUBTLE_BRIGHT,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 540,
        y: 990,
        lines: [text.store, text.market, `매력: ${text.appeal}`, `가격: ${text.price}`],
        fontSize: 32,
        lineHeight: 54,
        fill: INK,
        textAnchor: "middle",
      })}
      ${buildTextBlockSvg({
        x: 980,
        y: 1260,
        lines: ["05"],
        fontSize: 24,
        lineHeight: 26,
        fill: SUBTLE_BRIGHT,
      })}
    </svg>
  `);

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: BRIGHT_BG,
    },
  })
    .composite([
      { input: baseOverlay },
      { input: food, left: 330, top: 350 },
      { input: textOverlay },
    ])
    .png()
    .toBuffer();
}

export async function renderFoodCardNewsCards(
  submission: SubmissionForGeneration,
  assets: FoodCardNewsSourceAssets,
  reviewedPlan: ReviewedFoodCardNewsPlan,
): Promise<RenderedFoodCardNewsCard[]> {
  const [cover, flatLay, circleLayout, quoteStrip, infoPage] = reviewedPlan.cards;
  const cards = await Promise.all([
    renderCoverCard(submission, assets, cover),
    renderFlatLayCard(submission, assets, flatLay),
    renderCircleLayoutCard(submission, assets, circleLayout),
    renderQuoteStripCard(submission, assets, quoteStrip),
    renderInfoCard(submission, assets, infoPage),
  ]);

  return [
    {
      index: 0,
      key: "cover",
      title: "표지",
      bytes: cards[0],
      promptText: "template-rendered-cover-card",
    },
    {
      index: 1,
      key: "flat_lay",
      title: "속지 A",
      bytes: cards[1],
      promptText: "template-rendered-flat-lay-card",
    },
    {
      index: 2,
      key: "circle_layout",
      title: "속지 B",
      bytes: cards[2],
      promptText: "template-rendered-circle-layout-card",
    },
    {
      index: 3,
      key: "quote_strip",
      title: "속지 C",
      bytes: cards[3],
      promptText: "template-rendered-quote-strip-card",
    },
    {
      index: 4,
      key: "info_page",
      title: "정보 카드",
      bytes: cards[4],
      promptText: "template-rendered-info-card",
    },
  ];
}
