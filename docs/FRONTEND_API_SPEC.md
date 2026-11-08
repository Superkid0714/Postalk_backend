# Postalk 프론트엔드 API 명세서

이 문서는 **현재 Railway에 배포된 백엔드**를 프론트엔드가 연동하기 위한 기준 문서입니다.
화면 디자인과 콘셉트는 바뀔 수 있지만, 아래 API 계약과 인증 규칙을 기준으로 구현합니다.

## 1. 배포 주소와 연동 설정

| 구분 | 값 |
| --- | --- |
| 운영 API Base URL | `https://postalkbackend-production.up.railway.app` |
| 서버 상태 | `GET /api/health` |
| DB·Storage 상태 | `GET /api/health/ready` |
| DB·파일 저장소 | Supabase Pro (DB + private `uploads` bucket) |
| 관리자 검수 흐름 | 없음 |
| Instagram 게시 | 상인이 버튼을 눌렀을 때만 실행 |

프론트 배포 도메인이 확정되면 Railway API에 다음 환경변수를 설정합니다.

```dotenv
CORS_ALLOWED_ORIGINS=https://actual-frontend-domain.example
```

프론트 환경변수는 아래 이름을 권장합니다.

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://postalkbackend-production.up.railway.app
```

`SUPABASE_SERVICE_ROLE_KEY`, Instagram 토큰, 내부 워커 키는 프론트에 전달하지 않습니다.

## 2. 공통 응답 형식

성공:

```json
{ "success": true, "message": "OK", "data": {} }
```

실패:

```json
{
  "success": false,
  "message": "사용자에게 보여 줄 수 있는 설명",
  "error": { "code": "VALIDATION_ERROR", "details": [] }
}
```

| HTTP 상태 | 프론트 처리 |
| --- | --- |
| 400 | 입력값·필수 파일·UUID 확인 |
| 401 | QR 인증 정보를 다시 확인하거나 진입 화면으로 이동 |
| 403 | 다른 가게 자료에 접근한 경우. 현재 화면 자료를 새로고침 |
| 404 | 삭제되었거나 존재하지 않는 자료 안내 |
| 409 | 생성·게시가 진행 중이거나 상태가 변경됨. 상태 조회 후 UI 갱신 |
| 413 | 파일이 너무 큼 |
| 429 | 잠시 후 재시도 |
| 502 / 503 / 507 | 외부 AI·Instagram·Storage 문제 안내. 무한 재시도 금지 |

## 3. 인증과 보안

### 일반 상인 화면

활성화된 QR 토큰을 모든 가게 자료 조회·업로드·생성·게시 요청에 헤더로 전달합니다.

```http
x-merchant-qr-token: <activated-qr-token>
```

`storeId`, 상호명, `user_id`만으로는 인증되지 않습니다. QR 토큰은 URL·localStorage에 영구 보관하지 말고, 현재 세션 메모리에만 보관하는 방식을 권장합니다.

### 전시 전용 화면

전시 API는 `EXHIBITION_MODE_ENABLED=true`일 때만 사용합니다. 현재 운영값은 `false`이므로, 전시 화면을 확정하기 전까지는 일반 상인 API를 우선 사용합니다.

전시의 고정 로그인 `1234 / 1234` 검증은 프론트 책임입니다. 전시 API에는 `user_id=1`을 전달하며, 생성·재시도·게시에는 서버가 발급한 `x-creation-token`도 필요합니다. 세부 계약은 [EXHIBITION_API.md](EXHIBITION_API.md)를 따릅니다.

### 프론트에서 호출하지 않는 API

`/api/internal/*`은 Railway 복구 워커 전용입니다. `x-internal-worker-key`를 프론트에 넣거나 호출하면 안 됩니다.

## 4. 권장 상인 화면 흐름

```text
QR 진입 → QR 활성화(최초 1회) → 홈 조회
→ 파일 업로드 → 접수 생성 → 이미지/영상 생성 요청
→ 작업 상태 폴링 → 보관함/상세 확인 → 상인이 Instagram 게시 버튼 클릭
```

생성 완료는 게시를 의미하지 않습니다. `published`는 Instagram 게시 성공이 기록된 경우에만 사용합니다.

## 5. 일반 상인 API 목록

모든 `🔐` API에는 `x-merchant-qr-token` 헤더가 필요합니다.

| 기능 | 메서드·경로 | 인증 | 프론트 용도 |
| --- | --- | --- | --- |
| 서버 상태 | `GET /api/health` | 없음 | 운영 상태 확인 |
| DB·Storage 상태 | `GET /api/health/ready` | 없음 | 배포 점검용. 사용자 화면에 상시 노출하지 않음 |
| QR 진입 확인 | `GET /api/qr-entry/:slotKey` | 없음 | QR 링크에서 `qrToken`, `storeId` 확인 |
| QR 활성화 | `POST /api/merchant-qrs/:qrToken/activate` | 최초 등록 | 상호·시장·업종·주소 등록 |
| QR 이미지 | `GET /api/merchant-qrs/:qrToken/image` | 없음 | QR 이미지 표시/다운로드 |
| 홈 | `GET /api/home?storeId=:storeId` | 🔐 | 가게명, draft/published 집계, 최근 광고 |
| 보관함 | `GET /api/archive?storeId=:storeId&mediaType=photo|video&status=all|draft|published` | 🔐 | 생성 결과 목록 |
| 파일 업로드 | `POST /api/uploads` | 🔐 | 메뉴판·음식 사진·영상 업로드 |
| 사진 사전 확인 | `POST /api/photo-check` | 🔐 | 사진 품질 확인 |
| 접수 생성 | `POST /api/submissions` | 🔐 | 업로드한 파일로 광고 초안 생성 |
| 이미지 생성 시작 | `POST /api/ad-creations/start` | 🔐 | 카드뉴스 이미지 생성 작업 생성 |
| 이미지 생성 상태 | `GET /api/ad-creations/:jobId` | 🔐 | `queued/processing/completed/failed` 폴링 |
| 이미지 재생성 | `POST /api/ad-creations/:jobId/regenerate` | 🔐 | 스타일 변경 후 재생성 |
| 영상 생성 시작 | `POST /api/video-creations/start` | 🔐 | 무음 자막 릴스 생성 작업 생성 |
| 영상 생성 상태 | `GET /api/video-creations/:jobId` | 🔐 | 영상 작업 폴링 |
| 영상 재생성 | `POST /api/video-creations/:jobId/regenerate` | 🔐 | 영상 작업 재시도 |
| 새 제작 세션 | `POST /api/ad-sessions/start` | 🔐 | 단계형 사진/영상 제작 시작 |
| 제작 세션 조회 | `GET /api/ad-sessions/:sessionId` | 🔐 | 다음 촬영/업로드 단계 표시 |
| 세션 사진 제출 | `POST /api/ad-sessions/:sessionId/photos` | 🔐 | 촬영 사진 검수·저장 |
| 세션 영상 제출 | `POST /api/ad-sessions/:sessionId/videos` | 🔐 | 촬영 영상 저장·생성 시작 |
| 게시 시작 | `POST /api/submissions/:id/instagram-publish` | 🔐 | 상인의 명시적 게시 버튼 |
| 게시 상태 | `GET /api/submissions/:id/instagram-publish` | 🔐 | 게시 중/완료/실패 표시 |
| 성과 조회 | `GET /api/submissions/:id/instagram-metrics` | 🔐 | 저장된 Instagram 성과 표시 |
| 성과 새로고침 | `POST /api/submissions/:id/instagram-metrics` | 🔐 | 외부 성과 재조회 |

### 파일 업로드 규칙

`POST /api/uploads`는 `multipart/form-data`입니다.

| 필드 | 설명 |
| --- | --- |
| `file` | 업로드 파일 1개 |
| `assetType` | 파일 목적. 화면에서 제공하는 허용 값만 사용 |
| `qrToken` | 호환용 입력. 새 프론트는 헤더 인증을 우선 사용 |
| `storeId` 또는 가게 조회 정보 | QR이 아직 가게에 연결되지 않은 최초 흐름에서만 필요 |

사진은 최대 10MiB, 영상은 최대 50MiB입니다. 업로드 응답의 `bucket`, `filePath`는 변형하지 말고 이후 접수·생성 요청에 그대로 전달합니다. Storage URL은 만료될 수 있으므로 영구 저장하지 않습니다.

### 게시 요청 예시

```http
POST /api/submissions/<submissionId>/instagram-publish
x-merchant-qr-token: <activated-qr-token>
Content-Type: application/json

{ "mediaType": "photo", "captionOverride": "선택 사항" }
```

- `mediaType`: `photo` 또는 `video`
- 게시 중이면 `202`, 이미 게시되었으면 `200`, 동시 게시 충돌은 `409`
- `requiresVerification: true`이면 외부 게시 결과가 불확실한 상태입니다. 프론트는 재게시 버튼을 노출하지 말고 확인 중으로 표시합니다.

## 6. 전시 API 목록 (선택 기능)

전시 화면을 채택하고 서버 설정을 켠 경우에만 사용합니다.

| 화면 기능 | API |
| --- | --- |
| 전시 가게 정보 | `GET /api/exhibition/me` |
| 업로드 정책 | `GET /api/exhibition/uploads?user_id=1` |
| 장면별 업로드 | `POST /api/exhibition/uploads` |
| 정보 템플릿 | `GET/POST /api/exhibition/templates` |
| 자막 대본 | `POST /api/exhibition/script-jobs`, `GET /api/exhibition/script-jobs/:jobId` |
| 광고 생성 | `POST /api/exhibition/generations`, `GET /api/exhibition/generations/:jobId` |
| 보관함 | `GET /api/exhibition/ads` |
| 광고 상세/캡션/숨김 | `GET/PATCH/DELETE /api/exhibition/ads/:adId` |
| 재생성/게시 | `POST /api/exhibition/ads/:adId/retry`, `POST /api/exhibition/ads/:adId/publish` |

요청 본문, 장면·자막·파일 계약, 폴링 규칙은 [EXHIBITION_API.md](EXHIBITION_API.md)에 상세히 정의되어 있습니다.

## 7. 프론트 구현 전 결정할 항목

1. 일반 상인 QR 흐름만 쓸지, 고정 로그인 전시 흐름도 켤지 결정
2. 실제 프론트 운영 도메인 확정 후 CORS 등록
3. 카드뉴스·릴스의 콘셉트 ID·장면·자막 템플릿을 디자인/릴스 담당자로부터 확정
4. AI 공급자 키와 비용 정책 확정 후 생성 버튼 활성화
5. Instagram 토큰을 등록한 뒤 별도 계정에서 게시 리허설 1건 실행

## 8. 관련 문서

- [EXHIBITION_API.md](EXHIBITION_API.md): 전시 화면별 상세 요청·응답·장면 계약
- [API_CHANGES.md](API_CHANGES.md): 관리자 제거, QR 인증, 게시 상태 변경 사항
- [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md): Railway·Supabase 배포와 readiness 점검
- [erd/current.dbml](erd/current.dbml): 현재 DB ERD 원본
