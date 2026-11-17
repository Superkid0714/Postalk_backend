# 프론트엔드 API 변경

> 현재 운영 기준: 관리자는 사용하지 않습니다. 상인이 콘텐츠를 만들고 직접 게시합니다.

## 게스트 제작 연동

1. 앱 주소를 열면 프론트에서 브라우저 저장소의 게스트 키를 읽습니다. 처음이면 아래처럼 만들어 **API 호출 전에** 저장합니다.

   ```js
   const guestKey = Array.from(crypto.getRandomValues(new Uint8Array(32)),
     byte => byte.toString(16).padStart(2, "0")).join("");
   ```

2. `POST /api/guest-session`에 `x-guest-session: <guestKey>`를 보내면 `data.storeId`와 `data.canPublish`를 받습니다. 본문 없이 시작할 수 있으며 같은 키로 재시도해도 같은 `storeId`가 반환됩니다. 제작 전에 입력한 가게·시장 이름을 반영하려면 같은 키와 함께 JSON의 `storeName`, `marketName` 중 입력된 값을 보내면 됩니다.
3. 기존 상인용 홈, 업로드, 제작 세션, 생성 상태 조회 및 보관함 API에 같은 헤더를 보냅니다. `storeId`가 필요한 요청에는 받은 ID를 넣습니다. QR 토큰 필드는 생략합니다.
4. Instagram 연결이 설정되어 있으면 게스트 응답의 `canPublish`는 `true`입니다. 게스트도 같은 작업 공간 키로 본인이 만든 광고를 서버에 연결된 Instagram 계정에 게시할 수 있습니다. 성과 조회는 기존 상인 권한을 사용합니다.

게스트 작업 공간의 DB 저장·수정·조회가 실패하면 `503 AUTH_UNAVAILABLE`을 반환합니다. 운영 로그의 `Guest workspace database operation failed`에서 `operation`, HTTP `status`, DB `code`, `emptyResult`를 확인할 수 있습니다. 키·해시·입력값·DB 오류 원문은 기록하지 않습니다.

키는 작업 공간에 접근할 수 있는 비밀 값입니다. URL이나 로그에 넣지 않습니다. 브라우저 저장소를 지우거나 다른 기기에서 접속하면 새 작업 공간이 열립니다.

운영 DB에 `20261111_guest_sessions.sql`을 적용하고 Railway에서 `GUEST_CREATION_ENABLED=true`로 설정합니다. 프론트가 별도 도메인이면 Railway의 `CORS_ALLOWED_ORIGINS`에 추가합니다.

### 릴스 서비스 연결 후 영상 제작

운영 릴스는 메뉴 1·2·3개에 따라 16·20·24초의 1080×1920 MP4를 생성합니다. 제작 결과 응답의 `generation.resultUrl`에서 재생 주소를 받습니다.

촬영 안내는 `currentRequest.helperText`와 다음 제출 응답의 `request.helperText`에 포함됩니다. 가로 촬영을 안내하며, 가로 원본 전체를 중앙에 배치하고 위아래는 같은 영상의 흐린 배경으로 채웁니다. 세로 원본도 지원하며 화면을 채우도록 합성합니다. 배경음악은 콘셉트별 곡 목록에서 작업마다 무작위로 선택합니다.

`reelsMenus`를 보낼 때는 `{ name, description? }` 객체를 1~3개 넣습니다. 이름은 앞뒤 공백을 제거한 뒤 1~80자, 설명은 최대 300자의 문자열입니다. 잘못된 항목 또는 빈 배열은 HTTP 400과 `VALIDATION_ERROR`를 반환합니다.

`REELS_API_URL`이 설정된 백엔드에서 새 일반 영상 제작 세션을 시작하면, `reelsMenus`에 메뉴를 1~3개까지 보낼 수 있습니다. 메뉴 1개는 4개, 2개는 6개, 3개는 8개 장면을 요청합니다. 순서는 간판, 메뉴별 클로즈업·상세, 가게 입구입니다. `reelsMenus`를 생략하면 `menuIntro`를 메뉴 1개로 처리해 기존 화면도 그대로 동작합니다. 화면은 응답의 다음 촬영 요청을 사용하고, `status=generating`이 되면 기존 작업 조회를 계속합니다. 완성 영상에는 AI가 만든 장면 자막·게시글 캡션·해시태그가 포함됩니다.

### 카드뉴스 서비스 연결 후 사진 제작

`CARDNEWS_API_URL`이 설정된 백엔드에서 `POST /api/ad-sessions/start`의 `adType: "photo"`로 새 카드뉴스 세션을 시작합니다. 선택 필드 `cardNewsTheme`은 `minimal` 또는 `christmas`이며 기본값은 `minimal`입니다. `cardNewsStyle`에 최대 500자의 디자인 요청을 보낼 수 있습니다.

사진 제작에는 `reelsMenus`가 필요하지 않습니다. 릴스 서비스가 함께 연결되어 있어도 사진 촬영 흐름으로 시작합니다. 운영 Swagger의 요청 예시 `photo`, `video`, `videoThreeMenus`와 HTTP 201 응답의 사진·릴스 예시를 참고하세요. 예시의 `storeId`는 게스트 작업 공간 API에서 받은 실제 ID로 바꿉니다.

`storeAddress`(선택, 최대 200자)는 `marketName`과 별도로 입력하며 카드뉴스 캡션 하단에 표시합니다. `cardNewsMenus`는 `{ name, description? }` 객체 1~3개를 받습니다. 이름은 최대 80자, 설명은 최대 300자이고 첫 번째가 대표 메뉴입니다. 이 배열을 보내면 `menuIntro`를 생략할 수 있습니다. 이전 클라이언트는 `menuIntro`를 계속 사용할 수 있습니다.

프론트는 서버의 촬영 요청에 따라 대표 음식 전체, 확대, 음식 2장, 매장 외관, 매장 내부를 올립니다. 여섯 장의 `assetType`은 `food_photo`입니다. 마지막 사진을 제출하면 기존 작업 조회로 상태를 확인합니다. 새 결과는 1080×1350 PNG 4장(표지, 대표 사진, 음식 확대, 상세 카드)이며 `generation.generatedAssets` 배열의 첫 이미지가 표지입니다. 캡션과 해시태그는 `submission.caption`과 `submission.hashtags`에서 확인합니다. 기존 3장 결과도 같은 응답 구조를 사용합니다.

### 생성 진행률

`GET /api/generation-jobs/:jobId/progress`를 같은 작업 공간 키로 약 2초 간격으로 조회합니다. 카드뉴스와 릴스는 실제 단계 변경에 따라 `0 → 10 → 25 → 40 → 60 → 80 → 95 → 100%`를 반환합니다. 순서대로 대기, 입력 준비, AI 문구·구성, 디자인·장면 구성 준비 완료, 렌더링, 업로드, 보관함 저장, 완료입니다. 빠르게 끝나는 단계는 폴링 사이에 지나갈 수 있습니다.

`estimated: true`는 단계별 가중치라는 뜻이며, 경과 시간이나 파일 바이트의 비율이 아닙니다. `100%`는 결과 저장이 성공한 `status: "completed"`에서만 반환합니다. 실패 시 마지막 진행률과 별개로 `status: "failed"`, `failureReason`을 처리합니다. Swagger HTTP 200 응답에서 각 단계의 예시와 `data` 스키마를 확인할 수 있습니다.

### Instagram 게시: 접수와 완료 구분

게시 완료 응답을 받으면 홈·보관함에 보관한 해당 광고 상태를 갱신합니다. `data.permalink`가 있으면 Instagram 게시물 링크로 표시합니다.

배포된 프론트는 `POST /api/submissions/:id/publish`를 본문 없이 호출할 수 있습니다. 같은 게스트 키 또는 상인 QR 헤더가 필요하며 다른 작업 공간의 광고는 거절합니다. 서버가 컨테이너 상태 확인과 실제 게시까지 진행하고, 완료가 확인된 경우에만 HTTP 200과 `data.status: "published"`를 반환합니다. 처리 중이면 HTTP 409와 `INSTAGRAM_PROCESSING`을 반환하므로 잠시 후 같은 요청으로 상태를 다시 확인합니다. `INSTAGRAM_VERIFICATION_REQUIRED`는 외부 게시 결과가 불확실한 경우이며 계정에서 확인해야 합니다. 재호출로 중복 게시하지 않습니다.

비동기 연동에서는 `POST /api/submissions/:id/instagram-publish`의 202를 완료로 표시하지 않습니다. 같은 헤더로 `POST /api/submissions/:id/instagram-publish/sync`를 약 2초 간격으로 호출해 `published`가 될 때까지 확인합니다. GET은 저장된 상태만 조회하며 게시를 진행하지 않습니다.

카드뉴스 PNG는 게시 시 JPEG 사본으로 변환해 Instagram에 전달합니다. 원본 PNG와 보관함 미리보기는 유지합니다.

## 관리자 제거·상인 권한

`/api/admin/*`와 검수·승인·반려 API는 제거되었습니다.
기존 가게의 API는 해당 가게의 활성 QR 토큰을 사용합니다. 게스트 세션은 브라우저 작업 공간의 제작과 조회에 사용할 수 있습니다.

```http
x-merchant-qr-token: <해당 가게의 activated QR 토큰>
```

uploads multipart와 submissions / photo-check JSON의 기존 qrToken 입력도 지원합니다.
그 외 조회·생성·게시 요청은 헤더를 사용하세요. 가게 UUID와 이름은 인증 정보가 아닙니다.

## 파일 응답

업로드의 bucket 값은 Supabase의 `uploads`입니다.
응답의 bucket과 filePath를 그대로 다음 요청에 전달하세요. 클라이언트에서 고정하거나 가공하지 않습니다.

`GET /api/home`, `GET /api/archive`, `GET /api/ad-sessions/:sessionId`의 미리보기 서명 URL은 발급 시점부터 1시간 동안 유효합니다. 백엔드는 같은 파일의 서명 URL을 최대 5분간 재사용하므로, 여러 조회에서 같은 주소를 받을 수 있습니다. 영구 참조에는 파일의 `bucket`과 `filePath`를 사용하고, 서명 URL이 만료되면 해당 조회 API를 다시 호출합니다.

## 상태와 집계

| 항목 | 현재 값 |
| --- | --- |
| 접수 상태 | draft, published |
| 홈 집계 | draftCount, publishedCount, totalCount |
| 보관함 상태 필터 | all, draft, published |
| 보관함 집계 | all, draft, published |
| 생성 작업 상태 | queued, processing, completed, failed |

published는 실제 Instagram 게시 성공이 기록된 상태입니다. 이전 승인을 게시 완료로 취급하지 않습니다.
홈의 attentionItems는 보관 중인 항목이며 승인 대기·반려 의미가 없습니다.
사진 보관함에는 생성 이미지가 있는 접수만, 영상 보관함에는 생성 영상이 있는 접수만 표시합니다.

## 게시 버튼

생성·조회만으로 자동 게시하지 않습니다. 상인이 게시 버튼을 누를 때만 호출합니다.

```http
POST /api/submissions/:id/instagram-publish
Content-Type: application/json
x-merchant-qr-token: ...

{ "mediaType": "photo", "captionOverride": "선택적 홍보 문구" }
```

기존 POST /api/publish-requests와 POST /api/video-publish-requests도 submissionId JSON으로 직접 게시를 시작합니다.
진행 중이면 202, 이미 게시되었으면 200입니다. 동시에 처리 중인 게시에는 409, 외부 게시 실패에는 502를 반환합니다.

- GET /api/submissions/:id/instagram-publish: 저장된 게시 상태 조회
- GET /api/submissions/:id/instagram-metrics: 저장된 성과 조회
- POST /api/submissions/:id/instagram-metrics: 외부 성과 새로 조회

게시 진행은 내부 워커가 확인하며 GET 자체는 외부 게시를 실행하지 않습니다.

## 오류 처리

| 상태 | 대응 |
| --- | --- |
| 400 | 입력 타입·필수 항목·파일 경로 확인 |
| 401 | 게스트 키 또는 활성 QR 토큰 확인 |
| 403 | 본인 가게 자료인지 확인 |
| 404 | 자료 없음 또는 제거된 API |
| 409 | 생성·게시 진행 상태 조회 후 재시도 판단 |
| 502 / 503 | 외부 서비스·저장소·서버 설정 확인 |

aiMetadata에 adWorkflow, videoWorkflow, instagramPublish, instagramMetrics를 전달할 수 없습니다.
미완성 생성물과 이미지가 누락된 카드뉴스는 게시할 수 없습니다.
