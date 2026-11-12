# POSTALK Backend

전통시장 상인이 사진·영상으로 카드뉴스와 자막 릴스를 만들고, 원할 때 직접 Instagram에 게시하는 백엔드입니다.

## 현재 운영 구조

```text
프론트엔드 → Railway API → Supabase Pro
                         ├─ PostgreSQL
                         └─ private uploads Storage
```

- 운영 브랜치: `main`
- 배포: GitHub Actions 검사 후 Railway 자동 배포
- 저장소: Supabase `uploads` 버킷
- 관리자 검수: 사용하지 않음
- 게시: 상인이 버튼을 눌렀을 때만 실행
- 릴스: 별도 릴스 서비스 연결 시 자막과 배경음악이 들어간 MP4

## 빠른 확인

| 확인 항목 | 주소 |
| --- | --- |
| 서버 상태 | `GET /api/health` |
| DB·Storage 연결 | `GET /api/health/ready` |
| 운영 API | `https://postalkbackend-production.up.railway.app` |

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

사진은 최대 10MiB, 영상은 최대 50MiB입니다. 기존 가게 보관함과 Instagram 게시에는 기존 상인 권한이 필요합니다. 프론트 호출 방식과 배포 설정은 [게스트 제작 연동](docs/API_CHANGES.md#게스트-제작-연동)을 참고하세요.

## 프론트 연동 API

모든 응답은 `success`, `message`, `data` 구조를 사용합니다. 게스트 제작 화면은 아래 헤더를 모든 제작·조회 요청에 함께 보냅니다. 상인 QR 흐름에서는 같은 자리에 `x-merchant-qr-token`을 사용합니다.

```http
x-guest-session: 브라우저에만 보관하는 64자리 난수
```

| 목적 | 메서드·경로 | 핵심 입력 | 결과 |
| --- | --- | --- | --- |
| 게스트 작업 공간 열기 | `POST /api/guest-session` | 선택: `storeName`, `marketName` | `storeId`, `canPublish: false` |
| 파일 업로드 | `POST /api/uploads` | multipart 파일, `storeId`, `assetType` | `bucket`, `filePath` |
| 카드뉴스 세션 시작 | `POST /api/ad-sessions/start` | `adType: "photo"`, 소개 문구, `cardNewsTheme` | `sessionId`, 다음 촬영 요청 |
| 카드뉴스 사진 제출 | `POST /api/ad-sessions/:sessionId/photos` | 앞 단계의 `bucket`, `filePath` | 다음 촬영 요청 또는 `generationJobId` |
| 릴스 세션 시작 | `POST /api/ad-sessions/start` | `adType: "video"`, 소개 문구, `reelsConcept` | `sessionId`, 다음 촬영 요청 |
| 릴스 영상 제출 | `POST /api/ad-sessions/:sessionId/videos` | 앞 단계의 `bucket`, `filePath` | 다음 촬영 요청 또는 `generationJobId` |
| 생성 진행률 | `GET /api/generation-jobs/:jobId/progress` | 없음 | `status`, `percent`, `stage`, `failureReason` |
| 세션·결과 조회 | `GET /api/ad-sessions/:sessionId` | 없음 | 수집 파일, 제출물, 생성 결과 |
| 보관함 조회 | `GET /api/archive?storeId=...` | `mediaType`, `status` 선택 | 생성물 목록과 서명 URL |
| Instagram 게시 | `POST /api/submissions/:id/instagram-publish` | 상인 QR 권한, `mediaType` | 게시 요청 상태 |

카드뉴스 테마는 `minimal`, `christmas`이고, 릴스 콘셉트는 `simple`, `christmas`입니다. 마지막 파일 제출이 생성 작업을 시작하므로, 프론트는 `generationJobId`를 저장한 뒤 진행률 API를 폴링하면 됩니다. 게스트 작업 공간은 게시와 성과 조회를 할 수 없으므로 해당 버튼을 표시하지 않습니다.

### 호출 순서

```text
POST /guest-session
  → POST /uploads
  → POST /ad-sessions/start
  → POST /ad-sessions/:id/photos 또는 /videos
  → GET /generation-jobs/:id/progress
  → GET /ad-sessions/:id 또는 /archive
  → (상인 QR만) POST /submissions/:id/instagram-publish
```

## 데이터 구조

팀 공유에는 [팀 제작 흐름 ERD](docs/erd/team-workflow.dbml)를 사용합니다. 현재 스키마 전체는 [현재 스키마](docs/erd/current.dbml), 확장 제작 모델은 [제작 흐름 중심 ERD](docs/erd/workflow.dbml)에 있습니다. 세 파일 모두 dbdiagram.io에 붙여 넣어 시각화할 수 있습니다.

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
- `ad_creation_sessions`: 촬영 순서와 선택한 카드뉴스 테마·릴스 콘셉트를 보관하는 제작 세션입니다.
- `generation_jobs`: AI 서비스 호출 상태와 결과 경로를 보관합니다. 상태는 `queued`, `processing`, `completed`, `failed`입니다.
- `submission_assets`: 원본과 생성 결과의 Storage 경로를 연결합니다. 실제 파일은 Supabase `uploads` 버킷에 있습니다.
- `submissions`: 보관함에서 보여 줄 제목, 캡션, 해시태그, 게시 상태의 기준 레코드입니다.

## 개발

세 저장소를 함께 편집하려면 상위 폴더의 `Postalk.code-workspace`를 VS Code에서 엽니다. 각 저장소는 독립 Git 저장소입니다.

상위 `Postalk` 폴더에서 다음처럼 로컬 실행을 준비합니다.

```powershell
npm --prefix postalk-backend ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r postalk-cardnews/requirements.txt -r postalk_reels_pipeline/requirements.txt
.venv/Scripts/python.exe -m playwright install chromium
Copy-Item .env.postalk-dev.example postalk-backend/.env.postalk-dev
```

카드뉴스 폰트는 `postalk-cardnews` 폴더에서 `../.venv/Scripts/python.exe -c "from cardnews.design import ensure_fonts; ensure_fonts()"`로 내려받습니다. 릴스 서비스에는 `ffmpeg`와 `ffprobe`가 PATH에 있어야 합니다.

`postalk-backend/.env.postalk-dev`에 개발용 Supabase URL과 키를 입력합니다. 개발 DB에는 게스트 세션과 카드뉴스 촬영 마이그레이션을 적용해야 합니다. 상위 폴더에서 `node postalk-dev.mjs`를 실행하면 백엔드 `3000`, 카드뉴스 `8011`, 릴스 `8012`가 열립니다. 프론트의 API 주소는 `http://127.0.0.1:3000`입니다. 코드를 저장하면 서비스가 변경사항을 반영하며, `Ctrl+C`로 모두 종료합니다.

`node postalk-dev.mjs --smoke`는 임시 설정으로 서버 세 개를 실행해 상태 API를 확인하고 종료합니다.

### 백엔드만 실행

```powershell
npm ci
npm run dev
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
- [전시 화면 API](docs/EXHIBITION_API.md)
- [Supabase 적용 기록](docs/SUPABASE_DEPLOYMENT_20261103.md)
- [변경 기록](docs/CHANGELOG.md)
- [ERD: 전체](docs/erd/current.dbml)
- [ERD: 팀 공유용 제작 흐름](docs/erd/team-workflow.dbml)
- [ERD: 제작 흐름](docs/erd/workflow.dbml)
