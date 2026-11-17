# POSTALK Backend

상인이 사진·영상으로 카드뉴스와 자막 릴스를 만들고, 원할 때 직접 Instagram에 게시하는 백엔드입니다.

## 현재 운영 구조

```text
프론트엔드 → Railway API → Supabase PostgreSQL / private uploads
                 ├─ 카드뉴스 AI
                 └─ 릴스 AI
복구 워커 ──내부 인증──→ Railway API
```

- 운영 브랜치: `main`
- 배포: GitHub Actions 검사와 Railway 자동 배포
- 저장소: Supabase `uploads` 버킷
- 관리자 검수: 사용하지 않음
- 게시: 상인이 버튼을 눌렀을 때만 실행
- 릴스: 별도 릴스 서비스에서 자막과 배경음악이 들어간 MP4 생성
- 생성 복구: 전용 postalk-recovery 워커가 queued/processing 작업을 점검하며 DB 임대로 중복 실행 방지
- Instagram 게시 복구: 생성 복구와 별도 설정이며 운영에서는 비활성

## 빠른 확인

| 확인 항목 | 주소 |
| --- | --- |
| 서버 상태 | `GET /api/health` |
| DB·Storage 연결 | `GET /api/health/ready` |
| 운영 API | `https://postalkbackend-production.up.railway.app` |
| API 명세 | [운영 Swagger](https://postalkbackend-production.up.railway.app/api-docs) |

`/api/health/ready`가 아래처럼 응답하면 Railway, Supabase DB, Storage 연결이 정상입니다.

```json
{
  "status": "ok",
  "dependencies": {
    "database": "ok",
    "storage": "ok",
    "mediaProvider": "supabase"
  }
}
```

## QR 없이 제작 시작

프론트에서 로그인 없이 `POST /api/guest-session`을 호출하면 브라우저에 연결된 작업 공간의 `storeId`를 받습니다. 같은 브라우저 키로 다시 요청하면 같은 작업 공간이 열립니다.

```text
주소 접속 → 게스트 작업 공간 → 업로드 → 광고 생성 → 보관함
```

사진은 최대 10MiB, 영상은 최대 50MiB입니다. 게스트도 본인 작업 공간의 광고를 서버에 연결된 Instagram 계정에 게시할 수 있습니다. 기존 가게 보관함에는 해당 상인 권한이 필요합니다. 프론트 호출 방식과 배포 설정은 [게스트 제작 연동](docs/API_CHANGES.md#게스트-제작-연동)을 참고하세요.

게스트 세션의 `503 AUTH_UNAVAILABLE`은 기존 키와 입력을 유지한 채 재시도합니다. 응답 예시와 복구 정책은 [게스트 제작 연동](docs/API_CHANGES.md#게스트-제작-연동), 장애 진단은 [운영 가이드](docs/OPERATIONS.md#게스트-인증-장애-대응)를 참고하세요.

## 프론트 연동 API

제작·조회 API의 성공 응답은 `success`, `message`, `data` 구조를 사용합니다. [운영 Swagger](https://postalkbackend-production.up.railway.app/api-docs)에서 제작 결과, 보관함, 홈 요약, 사진·영상 제출의 HTTP 200 응답을 펼치면 JSON 예시와 `data` 스키마를 볼 수 있습니다. 사진 재촬영이 필요하면 HTTP 200 응답의 `data.response`가 `"fail"`이고 `data.retryMessage`에 안내 문구가 들어갑니다.

게스트 제작 화면은 아래 헤더를 모든 제작·조회 요청에 함께 보냅니다. 상인 QR 흐름에서는 같은 자리에 `x-merchant-qr-token`을 사용합니다.

```http
x-guest-session: 브라우저에만 보관하는 64자리 난수
```

| 목적 | 메서드·경로 | 핵심 입력 | 결과 |
| --- | --- | --- | --- |
| 게스트 작업 공간 열기 | `POST /api/guest-session` | 선택: `storeName`, `marketName` | `storeId`, Instagram 연결 시 `canPublish: true` |
| 파일 업로드 | `POST /api/uploads` | multipart 파일, `storeId`, `assetType` | `bucket`, `filePath` |
| 카드뉴스 세션 시작 | `POST /api/ad-sessions/start` | `adType: "photo"`, `storeSpecialty`, `cardNewsMenus`, `storeAddress`, `cardNewsTheme`, `cardNewsStyle` | `sessionId`, 다음 촬영 요청 |
| 카드뉴스 사진 제출 | `POST /api/ad-sessions/:sessionId/photos` | 앞 단계의 `bucket`, `filePath` | 다음 촬영 요청 또는 `generationJobId` |
| 릴스 세션 시작 | `POST /api/ad-sessions/start` | `adType: "video"`, 소개 문구, `reelsConcept` | `sessionId`, 다음 촬영 요청 |
| 릴스 영상 제출 | `POST /api/ad-sessions/:sessionId/videos` | 업로드 응답의 `bucket`, `filePath`, 선택 `mimeType` | 다음 촬영 요청 또는 `generationJobId` |
| 생성 진행률 | `GET /api/generation-jobs/:jobId/progress` | 없음 | `status`, `percent`, `stage`, `failureReason` |
| 세션·결과 조회 | `GET /api/ad-sessions/:sessionId` | 없음 | 수집 파일, 제출물, 생성 결과 |
| 보관함 조회 | `GET /api/archive?storeId=...` | `mediaType`, `status` 선택 | 생성물 목록과 서명 URL |
| 홈 요약 조회 | `GET /api/home?storeId=...` | `storeId` | 광고 집계, 확인할 광고, 최근 광고 |
| Instagram 게시 | `POST /api/submissions/:id/publish` | 게스트 키 또는 상인 QR | 실제 게시 완료 시 `published` |

릴스 원본은 `POST /api/uploads`에 `assetType=video_clip`으로 보냅니다. 파일당 최대 50 MiB이며 `video/mp4`, `video/quicktime`, `video/webm`을 지원합니다. WebM 원본도 그대로 업로드할 수 있고 완성된 릴스는 MP4로 제공됩니다. 영상 제출에 `mimeType`을 보낼 때는 업로드 응답의 값을 사용합니다.

카드뉴스 테마는 `minimal`, `christmas`이고, 릴스 콘셉트는 `simple`, `christmas`입니다. 마지막 파일 제출이 생성 작업을 시작하므로, 프론트는 `generationJobId`를 저장한 뒤 진행률 API를 폴링하면 됩니다. 게시 버튼은 `canPublish`를 따르며, 게스트의 성과 조회는 지원하지 않습니다.

릴스 시작 요청은 `reelsMenus`에 메뉴 이름·설명 1~3개를 보내면 `menuIntro` 없이 시작할 수 있습니다. 이전 문자열 입력 방식도 지원합니다.

카드뉴스 입력 예시와 미리보기 URL 갱신 방식은 [프론트엔드 API 연동 문서](docs/API_CHANGES.md)를 참고하세요.

### 호출 순서

```text
POST /guest-session
  → POST /uploads
  → POST /ad-sessions/start
  → POST /ad-sessions/:id/photos 또는 /videos
  → GET /generation-jobs/:id/progress
  → GET /ad-sessions/:id 또는 /archive
  → POST /submissions/:id/publish
```

## 데이터 구조

팀 공유에는 [팀 제작 흐름 ERD](docs/erd/team-workflow.dbml)를 사용합니다. 현재 스키마 전체는 [현재 스키마](docs/erd/current.dbml)에 있으며, 두 파일 모두 dbdiagram.io에 붙여 넣어 시각화할 수 있습니다.

```text
stores
 ├─ ad_creation_sessions ──< ad_creation_session_assets
 │                           └─ 업로드한 사진·영상
 ├─ submissions ──< generation_jobs ──< submission_assets
 │                    └─ 카드뉴스 PNG 또는 릴스 MP4 생성 작업
 ├─ merchant_qr_tokens
 └─ qr_entry_slots

submissions ──< Instagram 게시 상태·성과 정보(JSON)
```

- `stores`: 상인 가게 또는 게스트 작업 공간. 게스트는 `guest_session_hash`만 저장하며 원문 키는 DB에 남기지 않습니다.
- `ad_creation_sessions`: 촬영 순서와 선택한 카드뉴스 테마·릴스 콘셉트, 릴스 메뉴 목록(최대 3개)을 보관하는 제작 세션입니다.
- `generation_jobs`: AI 서비스 호출 상태와 결과 경로를 보관합니다. 상태는 `queued`, `processing`, `completed`, `failed`입니다.
- `submission_assets`: 원본과 생성 결과의 Storage 경로를 연결합니다. 실제 파일은 Supabase `uploads` 버킷에 있습니다.
- `submissions`: 보관함에서 보여 줄 제목, 캡션, 해시태그, 게시 상태의 기준 레코드입니다.

## 개발

이 저장소를 단독으로 복제한 뒤 실행할 수 있습니다.

```powershell
npm ci
Copy-Item .env.example .env.local
# .env.local에 개발용 Supabase와 AI 내부 서비스 연결 값을 입력합니다.
npm run dev
```

개발 환경은 운영 키와 분리합니다. 카드뉴스·릴스 AI는 각 저장소의 README대로 별도 실행하고, 백엔드의 `CARDNEWS_API_URL`, `REELS_API_URL`과 내부 인증 키를 해당 서비스에 맞춥니다. 이 저장소 밖의 실행 스크립트나 개인 workspace 파일은 필수 조건이 아닙니다.

검증 명령:

```powershell
npm run lint
npx tsc --noEmit
npm test
```

## 배포

`main`에 병합되면 GitHub Actions가 lint, TypeScript, 목업·통합 테스트, Docker 이미지를 확인합니다. Railway 서비스의 Source Branch도 `main`이어야 합니다.

## 문서

- [운영 순서](docs/OPERATIONS.md)
- [Railway·Supabase 설정](docs/RAILWAY_DEPLOYMENT.md)
- [상인 API 변경 사항](docs/API_CHANGES.md)
- [변경 기록](docs/CHANGELOG.md)
- [생성 복구 적용 기록](docs/incidents/20261118-generation-recovery.md)
- [실제 Instagram 게시 검증](docs/incidents/20261118-instagram-publication.md)
- [ERD: 전체](docs/erd/current.dbml)
- [ERD: 팀 공유용 제작 흐름](docs/erd/team-workflow.dbml)
