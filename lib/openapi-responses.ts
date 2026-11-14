const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const timestamp = { type: "string", format: "date-time" };
const url = { type: "string", format: "uri" };
const boolean = { type: "boolean" };
const integer = { type: "integer" };
const number = { type: "number" };

const nullable = (schema: object) => ({ ...schema, nullable: true });
const array = (items: object) => ({ type: "array", items });
const choices = (...values: string[]) => ({ type: "string", enum: values });
const object = (properties: Record<string, object>, optional: string[] = []) => ({
  type: "object",
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  properties,
});

type ResponseExample = { summary: string; message: string; data: object };

function ok(description: string, data: object, examples: Record<string, ResponseExample>) {
  return {
    description,
    content: {
      "application/json": {
        schema: object({ success: { ...boolean, enum: [true] }, message: string, data }),
        examples: Object.fromEntries(
          Object.entries(examples).map(([name, { summary, message, data }]) => [
            name,
            { summary, value: { success: true, message, data } },
          ]),
        ),
      },
    },
  };
}

const sessionId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const submissionId = "33333333-3333-4333-8333-333333333333";
const generationJobId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-11-14T09:00:00Z";
const updatedAt = "2026-11-14T09:05:00Z";
const signedUrl = (filePath: string) => `https://storage.example.com/${filePath}?token=example`;
const generatedCards = [1, 2, 3].map((index) => {
  const filePath = `${storeId}/${submissionId}/generated/${generationJobId}-${index}.png`;
  return {
    assetId: `55555555-5555-4555-8555-55555555555${index}`,
    filePath,
    promptKey: `card-${index}`,
    url: signedUrl(filePath),
  };
});
const imageUrl = generatedCards[0].url;
const videoUrl = `https://storage.example.com/stores/${storeId}/reel.mp4?token=example`;
const caption = "시장에서 만나는 매콤한 제육볶음";
const hashtags = ["#제육볶음", "#전통시장"];
const store = {
  marketName: "중앙시장",
  storeName: "시장식당",
  ownerName: null,
  category: null,
  categoryLabel: null,
  locationAddress: null,
  primarySubject: "제육볶음",
};

const mediaType = choices("photo", "video");
const submissionStatus = choices("draft", "published");
const sessionStatus = choices("collecting", "ready_for_generation", "generating", "completed", "failed");
const captureAssetType = choices("menu_board", "food_photo", "video_clip");
const storeSchema = object({
  marketName: string,
  storeName: string,
  ownerName: nullable(string),
  category: nullable(string),
  categoryLabel: nullable(string),
  locationAddress: nullable(string),
  primarySubject: string,
});
const captureFields = {
  shotKey: string,
  assetType: captureAssetType,
  prompt: string,
  helperText: string,
};
const photoRequest = {
  shotKey: "card_zoom",
  assetType: "food_photo",
  prompt: "대표 메뉴를 가까이에서 찍어주세요.",
  helperText: "음식의 디테일이 보이도록 촬영해 주세요.",
};
const videoRequest = {
  shotKey: "video_signature_menu",
  assetType: "video_clip",
  prompt: "제육볶음",
  helperText: "제육볶음이 잘 보이도록 촬영해주세요.",
};

const generation = {
  jobId: generationJobId,
  status: "completed",
  stylePreset: "food_card_news",
  modelName: "postalk-cardnews",
  failureReason: null,
  imageCount: generatedCards.length,
  resultUrl: imageUrl,
  generatedAssets: generatedCards,
  templateSlots: null,
  completedAt: updatedAt,
};
const emptyDraft = { caption: null, hashtags: [], preparedAt: null, assetCount: 0, promptCount: 0 };
const collectedPhotos = ["card_bowl", "card_zoom", "card_food1", "card_food2", "card_store1", "card_store2"].map(
  (shotKey, sortOrder) => ({
    assetId: `66666666-6666-4666-8666-66666666666${sortOrder}`,
    shotKey,
    assetType: "food_photo",
    filePath: `stores/${storeId}/food_photo/${shotKey}.jpg`,
    sortOrder,
    reviewPassed: true,
    reviewScore: null,
    reviewSummary: "사진을 받았어요.",
    reviewFeedback: [],
    createdAt,
  }),
);
const collectedVideos = [
  "video_storefront_sign",
  "video_signature_menu",
  "video_signature_interaction",
  "video_storefront_entry",
].map((shotKey, sortOrder) => ({
  ...collectedPhotos[sortOrder],
  shotKey,
  assetType: "video_clip",
  filePath: `stores/${storeId}/video_clip/${shotKey}.mp4`,
  reviewScore: 100,
  reviewSummary: "영상이 정상적으로 승인되었습니다.",
}));
const sessionResult = {
  sessionId,
  adType: "photo",
  status: "completed",
  stylePreset: "food_card_news",
  introText: "제육볶음. 매일 직접 만드는 양념.",
  intro: {
    menuIntro: "제육볶음",
    storeSpecialty: "매일 직접 만드는 양념",
    combinedText: "제육볶음. 매일 직접 만드는 양념.",
  },
  createdAt,
  updatedAt,
  store,
  draft: emptyDraft,
  currentRequest: null,
  collectedAssets: collectedPhotos,
  submission: { submissionId, caption: "시장식당\n\n제육볶음\n\n매일 직접 만드는 양념", hashtags: [], status: "draft" },
  generation,
};

export const sessionResultResponse = ok(
  "현재 촬영 요청, 수집 파일, 제출물 및 생성 결과를 반환합니다.",
  object({
    sessionId: uuid,
    adType: mediaType,
    status: sessionStatus,
    stylePreset: string,
    introText: string,
    intro: object({ menuIntro: nullable(string), storeSpecialty: nullable(string), combinedText: string }),
    createdAt: timestamp,
    updatedAt: timestamp,
    store: storeSchema,
    draft: object({
      caption: nullable(string),
      hashtags: array(string),
      preparedAt: nullable(timestamp),
      assetCount: integer,
      promptCount: integer,
    }),
    currentRequest: nullable(object({
      ...captureFields,
      response: choices("success"),
      status: choices("collecting"),
    })),
    collectedAssets: array(object({
      assetId: uuid,
      shotKey: string,
      assetType: captureAssetType,
      filePath: string,
      sortOrder: integer,
      reviewPassed: boolean,
      reviewScore: nullable(integer),
      reviewSummary: nullable(string),
      reviewFeedback: array(string),
      createdAt: timestamp,
    })),
    submission: nullable(object({
      submissionId: uuid,
      caption: nullable(string),
      hashtags: array(string),
      status: submissionStatus,
    })),
    generation: nullable(object({
      jobId: uuid,
      status: choices("queued", "processing", "completed", "failed"),
      stylePreset: string,
      modelName: string,
      failureReason: nullable(string),
      imageCount: nullable(integer),
      resultUrl: nullable(url),
      generatedAssets: array(object({
        assetId: nullable(string),
        filePath: nullable(string),
        promptKey: nullable(string),
        url: nullable(url),
      })),
      templateSlots: { type: "object", nullable: true, additionalProperties: true },
      completedAt: nullable(timestamp),
    }, ["imageCount", "templateSlots"])),
  }),
  {
    photoCompleted: {
      summary: "카드뉴스 제작 완료",
      message: "Ad session loaded",
      data: sessionResult,
    },
    videoCompleted: {
      summary: "릴스 제작 완료",
      message: "Ad session loaded",
      data: {
        ...sessionResult,
        adType: "video",
        collectedAssets: collectedVideos,
        submission: { submissionId, caption, hashtags, status: "draft" },
        generation: {
          ...generation,
          stylePreset: "market_story",
          modelName: "postalk-reels",
          imageCount: null,
          resultUrl: videoUrl,
          generatedAssets: [],
        },
      },
    },
    collecting: {
      summary: "촬영 파일 수집 중",
      message: "Ad session loaded",
      data: {
        ...sessionResult,
        status: "collecting",
        currentRequest: { ...photoRequest, response: "success", status: "collecting" },
        collectedAssets: collectedPhotos.slice(0, 1),
        submission: null,
        generation: null,
      },
    },
  },
);

const checkStatus = choices("pass", "warning", "fail", "not_applicable");
const reviewChecks = {
  focus: "not_applicable",
  brightness: "not_applicable",
  framing: "not_applicable",
  subjectVisibility: "not_applicable",
  guideMatch: "not_applicable",
  textReadability: "not_applicable",
};
const reviewFields = { passed: boolean, summary: string, feedback: array(string) };
const photoReviewSchema = object({
  ...reviewFields,
  score: nullable(integer),
  recommendedAction: choices("proceed", "retake"),
  checks: object({
    focus: checkStatus,
    brightness: checkStatus,
    framing: checkStatus,
    subjectVisibility: checkStatus,
    guideMatch: checkStatus,
    textReadability: checkStatus,
  }),
});
const videoReviewSchema = object({
  ...reviewFields,
  score: integer,
  payload: { type: "object", properties: { durationSeconds: number } },
});
const photoReview = {
  passed: true,
  score: null,
  recommendedAction: "proceed",
  summary: "사진을 받았어요.",
  feedback: [],
  checks: reviewChecks,
};
const videoReview = {
  passed: true,
  score: 100,
  summary: "영상이 정상적으로 승인되었습니다.",
  feedback: [],
  payload: { durationSeconds: 4.5 },
};

function acceptedMedia(reviewSchema: object, assetType: object) {
  const common = { sessionId: uuid, response: choices("success"), store: storeSchema, review: reviewSchema };
  return [
    object({
      ...common,
      status: choices("collecting"),
      request: object({ ...captureFields, assetType }),
    }),
    object({
      ...common,
      status: choices("generating"),
      state: choices("끝"),
      submissionId: uuid,
      generationJobId: uuid,
    }),
  ];
}

const collectingMedia = { sessionId, response: "success", status: "collecting", store };
const generatingMedia = { sessionId, response: "success", status: "generating", state: "끝", store, submissionId, generationJobId };
const photoAssetType = choices("menu_board", "food_photo");
const retryMessage = "사진이 흐리게 나왔습니다. 다시 찍어주세요.";

export const submitPhotoResponse = ok(
  "다음 촬영 요청, 제작 시작 정보 또는 재촬영 안내를 반환합니다. 재촬영이 필요하면 HTTP 200에서 data.response가 fail입니다.",
  {
    oneOf: [
      ...acceptedMedia(photoReviewSchema, photoAssetType),
      object({
        sessionId: uuid,
        response: choices("fail"),
        status: choices("collecting"),
        request: object({ ...captureFields, assetType: photoAssetType }),
        review: photoReviewSchema,
        retryMessage: string,
      }),
    ],
  },
  {
    nextShot: {
      summary: "사진 승인 및 다음 촬영 요청",
      message: "Photo accepted",
      data: { ...collectingMedia, request: photoRequest, review: photoReview },
    },
    generationStarted: {
      summary: "마지막 사진 승인 및 제작 시작",
      message: "Photo accepted and generation started",
      data: { ...generatingMedia, review: photoReview },
    },
    retake: {
      summary: "사진 재촬영 필요",
      message: "Photo needs retake",
      data: {
        sessionId,
        response: "fail",
        status: "collecting",
        request: { ...photoRequest, shotKey: "signature_menu", prompt: "대표 메뉴를 찍어주세요." },
        review: {
          passed: false,
          score: 35,
          recommendedAction: "retake",
          summary: "초점이 맞지 않아요.",
          feedback: [retryMessage],
          checks: {
            focus: "fail",
            brightness: "pass",
            framing: "pass",
            subjectVisibility: "warning",
            guideMatch: "pass",
            textReadability: "not_applicable",
          },
        },
        retryMessage,
      },
    },
  },
);

export const submitVideoResponse = ok(
  "다음 영상 촬영 요청 또는 마지막 영상 승인 후 제작 시작 정보를 반환합니다.",
  { oneOf: acceptedMedia(videoReviewSchema, choices("video_clip")) },
  {
    nextShot: {
      summary: "영상 승인 및 다음 촬영 요청",
      message: "Video accepted",
      data: { ...collectingMedia, request: videoRequest, review: videoReview },
    },
    generationStarted: {
      summary: "마지막 영상 승인 및 제작 시작",
      message: "Video accepted and generation started",
      data: { ...generatingMedia, review: videoReview },
    },
  },
);

const adFields = {
  submissionId: uuid,
  thumbnailUrl: nullable(url),
  title: string,
  status: submissionStatus,
  statusLabel: string,
};
const draftAd = {
  submissionId,
  thumbnailUrl: imageUrl,
  title: "제육볶음",
  status: "draft",
  statusLabel: "보관 중",
};

export const archiveResponse = ok(
  "선택한 매체 유형의 보관함 집계와 생성물 목록을 반환합니다. 서명 URL을 만들 수 없으면 해당 URL은 null입니다.",
  object({
    summary: object({
      storeId: uuid,
      storeName: string,
      ownerName: string,
      marketName: string,
      mediaType,
      selectedStatus: choices("all", "draft", "published"),
      counts: object({ all: integer, draft: integer, published: integer }),
    }),
    items: array(object({
      ...adFields,
      generatedAssetUrl: nullable(url),
      storeName: nullable(string),
      marketName: nullable(string),
      createdAt: timestamp,
      updatedAt: timestamp,
      mediaType,
      publishCaption: nullable(string),
      instagramPermalink: nullable(url),
      previewAssets: array(object({
        index: integer,
        assetType: choices("generated_image", "generated_video", "video_thumbnail"),
        sortOrder: integer,
        url: nullable(url),
      })),
    })),
  }),
  {
    photoArchive: {
      summary: "카드뉴스 보관함",
      message: "Archive data loaded",
      data: {
        summary: {
          storeId,
          storeName: store.storeName,
          ownerName: "사장님",
          marketName: store.marketName,
          mediaType: "photo",
          selectedStatus: "all",
          counts: { all: 1, draft: 1, published: 0 },
        },
        items: [{
          ...draftAd,
          generatedAssetUrl: imageUrl,
          storeName: store.storeName,
          marketName: store.marketName,
          createdAt,
          updatedAt,
          mediaType: "photo",
          publishCaption: sessionResult.submission.caption,
          instagramPermalink: null,
          previewAssets: generatedCards.map(({ url }, index) => ({
            index,
            assetType: "generated_image",
            sortOrder: index,
            url,
          })),
        }],
      },
    },
  },
);

export const homeResponse = ok(
  "점포별 광고 집계, 확인할 보관 중 광고(최대 5건), 최근 광고(최대 10건)를 반환합니다.",
  object({
    summary: object({
      ownerName: string,
      storeName: string,
      draftCount: integer,
      publishedCount: integer,
      totalCount: integer,
    }),
    attentionItems: array(object({ ...adFields, message: string, updatedAt: timestamp })),
    myAds: array(object({ ...adFields, createdAt: timestamp })),
  }),
  {
    home: {
      summary: "보관 중 광고 1건이 있는 홈",
      message: "Home data loaded",
      data: {
        summary: { ownerName: "사장님", storeName: store.storeName, draftCount: 1, publishedCount: 0, totalCount: 1 },
        attentionItems: [{ ...draftAd, message: "완성된 광고를 확인하고 직접 게시할 수 있어요", updatedAt }],
        myAds: [{ ...draftAd, createdAt }],
      },
    },
  },
);
