import { readFile } from "node:fs/promises";

import { getTourismCorpusEnv } from "@/lib/env";

const SOURCE_NAME = "광주전라 관광 말뭉치 RAG 보고서";

export type TourismCorpusContext = {
  found: boolean;
  source: string;
  verified: boolean;
  selected_for_prompt: boolean;
  selection_reason: string | null;
  report_path: string | null;
  region_scope: string | null;
  examples: TourismCorpusExample[];
  error: string | null;
};

export type TourismCorpusExample = {
  place_name: string;
  category: string;
  excerpt: string;
  overlap_keywords: string[];
  score: number;
};

type TourismCorpusEntry = {
  place_name: string;
  category: string;
  marketing_text: string;
};

type TourismCorpusInput = {
  marketName: string | null;
  province: string | null;
  district: string | null;
  product: string;
  appealPoint: string;
  extraMessage: string | null;
};

type TourismCorpusDeps = {
  reportPath?: string | null;
  maxItems?: number;
  fileReader?: (path: string) => Promise<string>;
};

const reportCache = new Map<string, TourismCorpusEntry[]>();

function compactText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function tokenize(value: string) {
  const normalized = value.normalize("NFKC").toLowerCase();
  const matched = normalized.match(/[가-힣a-z0-9]{2,}/g) ?? [];

  return [...new Set(matched)];
}

function expandRegionTokens(value: string | null | undefined) {
  const compact = compactText(value);

  if (!compact) {
    return [];
  }

  const baseTokens = tokenize(compact);
  const shortened = compact
    .replace(/광역시|특별시|특별자치도|특별자치시|자치시|자치도|도|시|군|구$/gu, "")
    .trim();

  return [...new Set([...baseTokens, ...tokenize(shortened)])];
}

function getRegionScope(input: TourismCorpusInput) {
  const province = compactText(input.province);

  if (/광주|전라/u.test(province)) {
    return province;
  }

  return null;
}

function removeMetadataSuffix(value: string) {
  return value
    .split(
      /(주소\(AD\)|전화번호\(TE\)|우편번호\(PO\)|시간\(TI\)|일정\(DA\)|용어\(TM\)|가격\(PR\)|부대정보\(UN\))/u,
    )[0]
    .replace(/\s+/g, " ")
    .trim();
}

function parseTourismCorpusEntries(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const entries: TourismCorpusEntry[] = [];
  let currentTitle: string | null = null;
  let currentCategory: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentTitle || !currentCategory || currentBody.length === 0) {
      currentTitle = null;
      currentCategory = null;
      currentBody = [];
      return;
    }

    const rawText = currentBody.join(" ").replace(/\s+/g, " ").trim();
    const excerptStart = rawText.includes("개요")
      ? rawText.slice(rawText.indexOf("개요") + 2).trim()
      : rawText;
    const marketingText = removeMetadataSuffix(excerptStart);

    if (marketingText.length > 0) {
      entries.push({
        place_name: currentTitle,
        category: currentCategory,
        marketing_text: marketingText,
      });
    }

    currentTitle = null;
    currentCategory = null;
    currentBody = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^\d+\.\s+\[(.+?)\]\s+(.+)$/u);

    if (headingMatch) {
      flush();
      currentCategory = headingMatch[1].trim();
      currentTitle = headingMatch[2].trim();
      continue;
    }

    if (line.trim().startsWith(">")) {
      currentBody.push(line.replace(/^\s*>\s?/u, "").trim());
      continue;
    }

    if (currentBody.length > 0 && line.trim().length === 0) {
      flush();
    }
  }

  flush();

  return entries;
}

async function loadTourismCorpusEntries(
  reportPath: string,
  deps?: TourismCorpusDeps,
) {
  const cached = reportCache.get(reportPath);

  if (cached) {
    return cached;
  }

  const markdown = await (deps?.fileReader ?? readFile)(reportPath, "utf8");
  const entries = parseTourismCorpusEntries(markdown);
  reportCache.set(reportPath, entries);
  return entries;
}

function scoreExample(entry: TourismCorpusEntry, input: TourismCorpusInput) {
  const combinedText = `${entry.place_name} ${entry.marketing_text}`.toLowerCase();
  const overlapSource = [
    input.marketName,
    input.province,
    input.district,
    input.product,
    input.appealPoint,
    input.extraMessage,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const keywords = tokenize(overlapSource);
  const overlapKeywords = keywords.filter((keyword) => combinedText.includes(keyword));
  const provinceTokens = expandRegionTokens(input.province);
  const districtTokens = expandRegionTokens(input.district);
  const marketTokens = expandRegionTokens(input.marketName);

  let score = Math.min(4, overlapKeywords.length);

  if (
    provinceTokens.some((token) => token.length >= 2 && combinedText.includes(token))
  ) {
    score += 5;
  }

  if (
    districtTokens.some((token) => token.length >= 2 && combinedText.includes(token))
  ) {
    score += 3;
  }

  if (
    marketTokens.some((token) => token.length >= 2 && combinedText.includes(token))
  ) {
    score += 2;
  }

  return {
    overlapKeywords,
    score,
  };
}

export async function getTourismCorpusContext(
  input: TourismCorpusInput,
  deps?: TourismCorpusDeps,
): Promise<TourismCorpusContext> {
  const env = getTourismCorpusEnv();
  const reportPath = deps?.reportPath ?? env.reportPath;
  const maxItems = Math.max(1, deps?.maxItems ?? env.maxItems);
  const regionScope = getRegionScope(input);

  if (!reportPath) {
    return {
      found: false,
      source: SOURCE_NAME,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "관광 말뭉치 파일 경로가 설정되지 않음",
      report_path: null,
      region_scope: regionScope,
      examples: [],
      error: null,
    };
  }

  if (!regionScope) {
    return {
      found: false,
      source: SOURCE_NAME,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "광주·전라권 문맥이 아니어서 관광 말뭉치를 사용하지 않음",
      report_path: reportPath,
      region_scope: null,
      examples: [],
      error: null,
    };
  }

  try {
    const entries = await loadTourismCorpusEntries(reportPath, deps);
    const rankedExamples = entries
      .map((entry) => {
        const { overlapKeywords, score } = scoreExample(entry, input);

        return {
          place_name: entry.place_name,
          category: entry.category,
          excerpt: entry.marketing_text,
          overlap_keywords: overlapKeywords,
          score,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxItems);

    if (rankedExamples.length === 0) {
      return {
        found: false,
        source: SOURCE_NAME,
        verified: true,
        selected_for_prompt: false,
        selection_reason: "활용할 만한 관광 말뭉치 예시를 찾지 못함",
        report_path: reportPath,
        region_scope: regionScope,
        examples: [],
        error: null,
      };
    }

    return {
      found: true,
      source: SOURCE_NAME,
      verified: true,
      selected_for_prompt: true,
      selection_reason: "광주·전라권 관광 홍보 말뭉치에서 문체 참고 예시를 추출함",
      report_path: reportPath,
      region_scope: regionScope,
      examples: rankedExamples,
      error: null,
    };
  } catch (error) {
    return {
      found: false,
      source: SOURCE_NAME,
      verified: false,
      selected_for_prompt: false,
      selection_reason: "관광 말뭉치 파일을 읽지 못해 사용하지 않음",
      report_path: reportPath,
      region_scope: regionScope,
      examples: [],
      error: error instanceof Error ? error.message : "Unknown tourism corpus error",
    };
  }
}

export function clearTourismCorpusCache() {
  reportCache.clear();
}
