import {
  archiveResponse,
  homeResponse,
  generationProgressResponse,
  instagramPublishResponse,
  sessionResultResponse,
  sessionStartResponse,
  submitPhotoResponse,
  submitVideoResponse,
} from "./openapi-responses";

const successEnvelope = {
  type: "object",
  required: ["success", "message", "data"],
  properties: {
    success: { type: "boolean", example: true },
    message: { type: "string" },
    data: { type: "object", additionalProperties: true },
  },
};

const errorEnvelope = {
  type: "object",
  required: ["success", "message", "error"],
  properties: {
    success: { type: "boolean", example: false },
    message: { type: "string" },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        details: {},
      },
    },
  },
};

const guestSecurity = [{ GuestSession: [] }];
const storeSecurity = [...guestSecurity, { MerchantQr: [] }];
const json = (schema: object, examples?: Record<string, { summary: string; value: object }>) => ({
  content: { "application/json": { schema, ...(examples ? { examples } : {}) } },
});
const success = (description: string, schema: object = successEnvelope) => ({
  description,
  content: { "application/json": { schema } },
});
const standardErrors = {
  "400": success("입력값이 올바르지 않습니다.", errorEnvelope),
  "401": success("작업 공간 키가 없거나 유효하지 않습니다.", errorEnvelope),
  "403": success("다른 작업 공간의 자료에는 접근할 수 없습니다.", errorEnvelope),
  "503": success("저장소 또는 외부 서비스 연결을 확인할 수 없습니다.", errorEnvelope),
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "POSTALK Frontend API",
    version: "1.0.0",
    description: "게스트 작업 공간에서 카드뉴스와 릴스를 만들고 결과를 조회하기 위한 운영 API입니다. AI 서버 API와 서비스 역할 키는 포함하지 않습니다.",
  },
  servers: [{ url: "https://postalkbackend-production.up.railway.app", description: "Production" }],
  tags: [
    { name: "Health", description: "서버와 의존성 상태 확인" },
    { name: "Workspace", description: "게스트 작업 공간" },
    { name: "Uploads", description: "사진·영상 업로드" },
    { name: "Creation", description: "카드뉴스·릴스 제작" },
    { name: "Results", description: "생성 진행률과 보관함" },
    { name: "Instagram", description: "게스트·상인이 직접 요청한 광고 게시" },
  ],
  paths: {
    "/api/health": {
      get: { tags: ["Health"], summary: "서버 상태", responses: { "200": success("서버가 실행 중입니다.") } },
    },
    "/api/health/ready": {
      get: { tags: ["Health"], summary: "DB·Storage 준비 상태", responses: { "200": success("의존성 상태를 반환합니다.") } },
    },
    "/api/guest-session": {
      post: {
        tags: ["Workspace"],
        summary: "게스트 작업 공간 열기",
        description: "같은 x-guest-session 키로 다시 요청하면 같은 작업 공간을 반환합니다. Instagram 연결이 설정되면 canPublish=true이며, 같은 키로 본인이 만든 광고를 연결된 Instagram 계정에 게시할 수 있습니다.",
        security: guestSecurity,
        requestBody: {
          required: false,
          content: { "application/json": { schema: { type: "object", properties: { storeName: { type: "string", maxLength: 100 }, marketName: { type: "string", maxLength: 100 } } } } },
        },
        responses: { "200": success("기존 작업 공간을 반환합니다."), "400": standardErrors["400"], "404": success("게스트 제작 기능이 비활성화되었습니다.", errorEnvelope), "503": standardErrors["503"] },
      },
    },
    "/api/uploads": {
      post: {
        tags: ["Uploads"], summary: "원본 사진 또는 영상 업로드", security: guestSecurity,
        description: "food_photo는 JPEG, PNG, WebP를 파일당 최대 10 MiB까지 받습니다. video_clip은 video/mp4, video/quicktime, video/webm을 파일당 최대 50 MiB까지 받습니다. WebM 원본을 그대로 제출할 수 있으며 완성된 릴스는 MP4로 제공됩니다.",
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file", "storeId", "assetType"], properties: { file: { type: "string", format: "binary" }, storeId: { type: "string", format: "uuid" }, assetType: { type: "string", enum: ["food_photo", "video_clip"] } } } } } },
        responses: { "201": success("업로드된 파일의 bucket, filePath, mimeType 등을 반환합니다."), ...standardErrors, "413": success("파일 크기가 제한을 넘었습니다.", errorEnvelope), "415": success("지원하지 않는 파일 MIME 타입입니다.", errorEnvelope) },
      },
    },
    "/api/ad-sessions/start": {
      post: {
        tags: ["Creation"], summary: "카드뉴스 또는 릴스 제작 시작", security: storeSecurity,
        description: "먼저 게스트 작업 공간을 열고 반환된 storeId와 동일한 x-guest-session 키를 사용합니다. 카드뉴스(adType=photo)는 reelsMenus 없이 시작하며, cardNewsTheme은 minimal 또는 christmas입니다(기본 minimal). 카드뉴스 서비스 연결 시 대표 음식 전체(card_bowl)부터 사진 6장을 요청합니다. 릴스(adType=video)는 reelsMenus에 메뉴를 1~3개 전달할 수 있습니다. 메뉴 수에 따라 간판·메뉴별 클로즈업/상세·입구 순서로 영상 4·6·8개를 요청합니다. reelsMenus를 생략하면 menuIntro를 메뉴 1개로 처리합니다. 릴스 메뉴 배열은 사진 제작에 필요하지 않습니다.",
        requestBody: { required: true, ...json({
          type: "object",
          required: ["storeId", "adType", "menuIntro", "storeSpecialty"],
          properties: {
            storeId: { type: "string", format: "uuid" },
            adType: { type: "string", enum: ["photo", "video"] },
            menuIntro: { type: "string" },
            storeSpecialty: { type: "string" },
            cardNewsTheme: { type: "string", enum: ["minimal", "christmas"], default: "minimal", description: "사진 카드뉴스 테마" },
            cardNewsStyle: { type: "string", maxLength: 500 },
            reelsConcept: { type: "string", enum: ["simple", "christmas"], description: "영상 릴스 콘셉트(기본 simple)" },
            reelsMenus: {
              type: "array", minItems: 1, maxItems: 3, description: "영상 릴스용 메뉴 1~3개. 사진 요청에서는 생략합니다. 영상 요청에서 생략하면 menuIntro를 메뉴 1개로 사용합니다.",
              items: {
                type: "object", required: ["name"],
                properties: {
                  name: { type: "string", maxLength: 80 },
                  description: { type: "string", maxLength: 300 },
                },
              },
            },
          },
        }, {
          photo: { summary: "사진 카드뉴스: reelsMenus 없이 시작", value: { storeId: "22222222-2222-4222-8222-222222222222", adType: "photo", menuIntro: "제육볶음", storeSpecialty: "매일 직접 만드는 양념", cardNewsTheme: "minimal" } },
          video: { summary: "릴스: menuIntro를 메뉴 1개로 사용", value: { storeId: "22222222-2222-4222-8222-222222222222", adType: "video", menuIntro: "제육볶음", storeSpecialty: "매일 직접 만드는 양념", reelsConcept: "simple" } },
          videoThreeMenus: { summary: "릴스: 메뉴 3개, 영상 8개 촬영", value: { storeId: "22222222-2222-4222-8222-222222222222", adType: "video", menuIntro: "제육볶음, 순대, 튀김", storeSpecialty: "매일 직접 만드는 양념", reelsMenus: [{ name: "제육볶음" }, { name: "순대" }, { name: "튀김" }], reelsConcept: "simple" } },
        }) },
        responses: { "201": sessionStartResponse, ...standardErrors, "404": success("점포를 찾을 수 없습니다.", errorEnvelope), "500": success("제작 세션을 시작하지 못했습니다.", errorEnvelope) },
      },
    },
    "/api/ad-sessions/{sessionId}": {
      get: {
        tags: ["Creation"], summary: "제작 세션과 생성 결과 조회", security: storeSecurity,
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        responses: { "200": sessionResultResponse, ...standardErrors, "404": success("제작 세션을 찾을 수 없습니다.", errorEnvelope) },
      },
    },
    "/api/ad-sessions/{sessionId}/photos": {
      post: {
        tags: ["Creation"], summary: "카드뉴스 사진 제출", security: storeSecurity,
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: json({ $ref: "#/components/schemas/UploadedFile" }),
        responses: { "200": submitPhotoResponse, ...standardErrors, "409": success("같은 카드뉴스 사진을 재사용했습니다.", errorEnvelope) },
      },
    },
    "/api/ad-sessions/{sessionId}/videos": {
      post: {
        tags: ["Creation"], summary: "릴스 영상 제출", security: storeSecurity,
        parameters: [{ $ref: "#/components/parameters/SessionId" }],
        requestBody: json({
          allOf: [
            { $ref: "#/components/schemas/UploadedFile" },
            {
              type: "object",
              properties: {
                durationSeconds: { type: "number", nullable: true },
                durationMs: { type: "number", nullable: true },
              },
            },
          ],
        }),
        responses: { "200": submitVideoResponse, ...standardErrors },
      },
    },
    "/api/generation-jobs/{jobId}/progress": {
      get: {
        tags: ["Results"], summary: "생성 진행률 조회", security: guestSecurity,
        description: "같은 작업 공간 키로 약 2초 간격으로 조회합니다. 단계별 진행률: queued 0% → preparing 10% → scripting 25% → designing 40% → rendering 60% → uploading 80% → saving 95% → completed 100%. 실제 단계 변경 시 갱신하므로 빠르게 끝나는 단계는 폴링 사이에 지나갈 수 있습니다. estimated=true는 작업 단계에 부여한 가중치이며 남은 시간의 비율이 아닙니다. 업로드만 끝나면 100%가 되지 않고 보관함 저장까지 성공해야 status=completed와 percent=100이 됩니다. 실패 시 status=failed와 failureReason을 확인합니다.",
        parameters: [{ $ref: "#/components/parameters/JobId" }],
        responses: { "200": generationProgressResponse, ...standardErrors, "404": success("생성 작업을 찾을 수 없습니다.", errorEnvelope) },
      },
    },
    "/api/submissions/{id}/publish": {
      post: {
        tags: ["Instagram"], summary: "광고를 Instagram에 게시하고 완료 확인", security: storeSecurity,
        description: "게스트 키 또는 상인 QR로 본인 작업 공간의 광고만 게시합니다. 본문 없이 호출할 수 있고 사진·영상 형식은 생성물에서 판단합니다. 실제 Instagram 게시 완료를 확인한 경우에만 HTTP 200, data.status=published를 반환합니다. 409 INSTAGRAM_PROCESSING이면 인스타 처리 중이므로 잠시 후 같은 경로를 재호출해 확인합니다. 409 INSTAGRAM_VERIFICATION_REQUIRED이면 외부 계정에서 게시 여부를 확인해야 하며 자동 재게시하지 않습니다. 같은 광고를 재호출해도 게시 완료된 광고를 중복 게시하지 않습니다.",
        parameters: [{ $ref: "#/components/parameters/SubmissionId" }],
        requestBody: json({ type: "object", properties: { mediaType: { type: "string", enum: ["photo", "video"] }, captionOverride: { type: "string" } } }),
        responses: { "200": instagramPublishResponse, ...standardErrors, "409": success("Instagram 처리 중 또는 게시 결과 확인이 필요합니다. error.code를 확인합니다.", errorEnvelope), "502": success("Instagram 게시 처리에 실패했습니다.", errorEnvelope) },
      },
    },
    "/api/submissions/{id}/instagram-publish": {
      post: {
        tags: ["Instagram"], summary: "Instagram 게시 요청 접수", security: storeSecurity,
        description: "비동기 연동용입니다. HTTP 202/data.status=processing은 완료가 아닙니다. POST /api/submissions/{id}/instagram-publish/sync를 약 2초 간격으로 호출해야 실제 게시가 진행됩니다. 완료 확인을 한 요청에서 처리하려면 /publish를 사용합니다.",
        parameters: [{ $ref: "#/components/parameters/SubmissionId" }],
        responses: { "200": instagramPublishResponse, "202": success("Instagram 처리 중이며 /sync 호출이 필요합니다."), ...standardErrors, "409": success("게시 처리가 이미 진행 중입니다.", errorEnvelope), "502": success("Instagram 게시 실패", errorEnvelope) },
      },
      get: {
        tags: ["Instagram"], summary: "저장된 Instagram 게시 상태 조회", security: storeSecurity,
        description: "저장된 상태만 조회하며 실제 게시를 실행하지 않습니다.",
        parameters: [{ $ref: "#/components/parameters/SubmissionId" }],
        responses: { "200": instagramPublishResponse, ...standardErrors, "404": success("게시 상태가 없습니다.", errorEnvelope) },
      },
    },
    "/api/submissions/{id}/instagram-publish/sync": {
      post: {
        tags: ["Instagram"], summary: "Instagram 처리 상태를 확인하고 준비 완료 시 게시", security: storeSecurity,
        parameters: [{ $ref: "#/components/parameters/SubmissionId" }],
        responses: { "200": instagramPublishResponse, "202": success("Instagram이 아직 처리 중입니다."), ...standardErrors, "409": success("게시 처리가 이미 진행 중입니다.", errorEnvelope), "502": success("Instagram 게시 실패", errorEnvelope) },
      },
    },
    "/api/archive": {
      get: {
        tags: ["Results"], summary: "보관함 조회", security: storeSecurity,
        parameters: [
          { $ref: "#/components/parameters/StoreId" },
          { name: "mediaType", in: "query", schema: { type: "string", enum: ["photo", "video"], default: "photo" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["all", "draft", "published"], default: "all" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
          { name: "submissionId", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": archiveResponse, ...standardErrors },
      },
    },
    "/api/home": {
      get: {
        tags: ["Results"], summary: "홈 요약 조회", security: storeSecurity,
        parameters: [{ $ref: "#/components/parameters/StoreId" }],
        responses: {
          "200": homeResponse,
          ...standardErrors,
          "404": success("점포를 찾을 수 없습니다.", errorEnvelope),
          "500": success("홈 요약을 불러오지 못했습니다.", errorEnvelope),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      GuestSession: { type: "apiKey", in: "header", name: "x-guest-session", description: "브라우저별 64자리 게스트 작업 공간 키" },
      MerchantQr: { type: "apiKey", in: "header", name: "x-merchant-qr-token", description: "활성화된 상인 QR 토큰" },
    },
    parameters: {
      StoreId: { name: "storeId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
      SessionId: { name: "sessionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      JobId: { name: "jobId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      SubmissionId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    },
    schemas: {
      UploadedFile: { type: "object", required: ["bucket", "filePath"], properties: { bucket: { type: "string", example: "uploads" }, filePath: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" }, fileSize: { type: "integer", minimum: 1 } } },
    },
  },
} as const;
