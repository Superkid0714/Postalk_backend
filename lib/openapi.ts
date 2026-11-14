import {
  archiveResponse,
  homeResponse,
  sessionResultResponse,
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
const json = (schema: object) => ({
  content: { "application/json": { schema } },
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
        description: "같은 x-guest-session 키로 다시 요청하면 같은 작업 공간을 반환합니다.",
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
        requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file", "storeId", "assetType"], properties: { file: { type: "string", format: "binary" }, storeId: { type: "string", format: "uuid" }, assetType: { type: "string", enum: ["food_photo", "video_clip"] } } } } } },
        responses: { "201": success("업로드된 파일의 bucket과 filePath를 반환합니다."), ...standardErrors, "413": success("파일 크기가 제한을 넘었습니다.", errorEnvelope) },
      },
    },
    "/api/ad-sessions/start": {
      post: {
        tags: ["Creation"], summary: "카드뉴스 또는 릴스 제작 시작", security: guestSecurity,
        requestBody: json({ type: "object", required: ["storeId", "adType", "menuIntro", "storeSpecialty"], properties: { storeId: { type: "string", format: "uuid" }, adType: { type: "string", enum: ["photo", "video"] }, menuIntro: { type: "string" }, storeSpecialty: { type: "string" }, cardNewsTheme: { type: "string", enum: ["minimal", "christmas"] }, cardNewsStyle: { type: "string", maxLength: 500 }, reelsConcept: { type: "string", enum: ["simple", "christmas"] } } }),
        responses: { "201": success("sessionId와 첫 촬영 요청을 반환합니다."), ...standardErrors },
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
        parameters: [{ $ref: "#/components/parameters/JobId" }],
        responses: { "200": success("상태, percent, stage, failureReason을 반환합니다."), ...standardErrors, "404": success("생성 작업을 찾을 수 없습니다.", errorEnvelope) },
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
    },
    schemas: {
      UploadedFile: { type: "object", required: ["bucket", "filePath"], properties: { bucket: { type: "string", example: "uploads" }, filePath: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" }, fileSize: { type: "integer", minimum: 1 } } },
    },
  },
} as const;
