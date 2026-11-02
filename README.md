# POSTALK Backend

## 상세 문서

- [전시 화면 SC-00~09 연동 계약](docs/EXHIBITION_API.md)
- [프론트엔드 API 변경](docs/API_CHANGES.md)
- [배포·운영·DB 적용 순서](docs/OPERATIONS.md)
- [이미지·영상 AWS S3 이전과 롤백](docs/AWS_MEDIA_MIGRATION.md)
- [변경 묶음과 검토 순서](docs/CHANGELOG.md)

기본 미디어 저장소는 Supabase이며 `MEDIA_STORAGE_PROVIDER=s3`로 새 파일의 쓰기 위치를 바꿀 수 있습니다.
기존 파일은 저장된 bucket 식별자로 계속 읽습니다. 실제 AWS 배포·파일 복사·운영 전환은 별도 실행해야 합니다.

전통시장 상인을 위한 콘텐츠 생성·보관·직접 게시 API입니다.
Next.js + Supabase를 사용하며 Docker Compose로 API 서버와 복구 워커를 실행합니다.

## 관리자 기능 제거

`/api/admin/*`, 관리자 API 키, 관리자 검수·승인·반려 API를 제거했습니다.
관리자 키로 상인 API에 접근하는 우회 경로도 제거했습니다.
기존 운영자용 OAuth 설정 페이지는 토큰을 HTML로 출력하므로 제거했습니다.
Instagram 연결은 서버 환경 변수로 설정합니다. 생성만으로 게시하지 않습니다.

상인 요청에는 다음 헤더가 필요합니다.

```http
x-merchant-qr-token: <해당 가게에 연결된 activated 상태의 QR 토큰>
```

업로드 multipart와 접수·사진 검수 JSON의 기존 `qrToken` 필드도 지원합니다.
다른 경로에서는 헤더를 사용하세요. 가게 UUID와 가게 이름은 인증 정보가 아닙니다.
새 QR을 기존 가게에 연결하려면 해당 가게의 활성 QR 토큰이 필요합니다.
토큰은 가게에 대한 접근 권한이므로 클라이언트 로그 등에 기록하지 마세요.
현재 별도 사용자 계정과 가게를 연결하는 로그인 모델은 없습니다.

## DB 적용 순서

기존 환경에서는 서버·워커를 중지한 뒤 아래 SQL을 순서대로 적용하고 코드를 배포하세요.
신규 환경에는 `supabase/schema.sql`을 사용합니다.

1. `supabase/migrations/20261102_generation_job_leases.sql`
2. `supabase/migrations/20261102_remove_review_workflow.sql`
3. `supabase/migrations/20261102_session_draft_merge.sql`
4. `supabase/migrations/20261102_submission_publish_leases.sql`

기존 접수 데이터는 삭제하지 않습니다. 실제 Instagram 게시 기록이 있으면 `published`,
그 외 기존 승인·반려·검수 대기는 `draft`로 전환합니다. 예전 검수 메모·역할·통계 테이블은
기존 DB에서 기록 보존을 위해 남기며 코드에서는 사용하지 않습니다.
승인되었다는 사실만으로 게시 완료로 취급하지 않습니다.

동일 접수에 `queued`/`processing` 작업이 여러 개 있으면 고유 인덱스 적용이 실패하며
두 번째 마이그레이션은 전체 롤백됩니다. 먼저 아래 조회로 확인하고 중복 작업을 정리하세요.
자동으로 삭제하거나 임의의 작업을 선택하지 않습니다.

```sql
select submission_id, array_agg(id) as job_ids
from public.generation_jobs
where status in ('queued', 'processing')
group by submission_id having count(*) > 1;
```

마이그레이션을 적용하지 않으면 상태 저장·작업 선점·게시·초안 병합이 실패합니다.
운영 DB에 이 SQL을 자동 적용하는 코드는 포함하지 않습니다.

## 상인 API

- `POST /api/uploads`, `POST /api/submissions`, `POST /api/photo-check`
- `POST /api/ad-sessions/start`, `GET /api/ad-sessions/:sessionId`
- `POST /api/ad-sessions/:sessionId/photos`, `POST /api/ad-sessions/:sessionId/videos`
- `POST /api/generation-jobs`, `GET /api/generation-jobs/:id`
- `POST /api/ad-creations/start`, `GET /api/ad-creations/:jobId`, `POST /api/ad-creations/:jobId/regenerate`
- `POST /api/video-creations/start`, `GET /api/video-creations/:jobId`, `POST /api/video-creations/:jobId/regenerate`
- `GET /api/home?storeId=...`, `GET /api/archive?storeId=...&mediaType=photo&status=all`
- `POST /api/submissions/:id/instagram-publish`, `GET /api/submissions/:id/instagram-publish`
- `GET /api/submissions/:id/instagram-metrics`, `POST /api/submissions/:id/instagram-metrics` (새로 조회)

게시 POST는 본인 가게의 완성된 결과물을 Instagram으로 보내며, 진행 중이면 202를 반환합니다.
선택 JSON: `{ "mediaType": "photo", "captionOverride": "홍보 문구" }`.
게시 GET은 저장된 상태만 읽고 실제 게시 진행은 워커가 확인합니다.
기존 `POST /api/publish-requests`, `POST /api/video-publish-requests`도
`{ "submissionId": "..." }`를 받아 직접 게시 요청으로 동작합니다.
외부 게시가 실제 발생하므로 상인이 명시적으로 게시 버튼을 누를 때만 호출하세요.

접수 상태는 `draft`(보관 중), `published`(실제 게시 완료)입니다.
홈 요약은 `draftCount`, `publishedCount`, `totalCount`, 보관함 집계는 `all`, `draft`, `published`를 제공합니다.
보관함 상태 필터는 `all`, `draft`, `published`만 받습니다.
사진 보관함은 생성 이미지가 있는 접수만, 영상 보관함은 생성 영상이 있는 접수만 조회합니다.

접수에는 업로드 API가 반환한 원본 `menu_board` / `food_photo` 경로만 전달하세요.
임의 버킷·다른 가게 경로·없는 파일·서버 관리 메타데이터는 차단합니다.
공통 검증은 `lib/api/request-body.ts`, 접근 정책은 `lib/auth/store-access.ts`에 있습니다.
DB 서비스 역할 클라이언트는 `lib/supabase/service.ts`이며 브라우저에 노출하면 안 됩니다.

## 실행·QR 발급

`.env.example`을 참고해 `.env`를 설정하세요. 주요 변수는
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`INTERNAL_WORKER_API_KEY`, `NEXT_PUBLIC_APP_URL`입니다.
게시에는 `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_IG_USER_ID`가 필요합니다.

```powershell
npm install
npm run dev
```

새 QR은 서버 자격 정보가 있는 환경에서 명시적으로 발급합니다.
발급 스크립트는 DB에 ready QR을 등록하고 PNG를 만듭니다. 공개 발급 API는 제공하지 않습니다.

```powershell
node --env-file=.env scripts/create-merchant-qr.mjs merchant-qr.png
```

```powershell
docker compose up -d --build
```

복구 워커는 `INTERNAL_WORKER_API_KEY`와 `x-internal-worker-key` 헤더로 내부 API에만 접근합니다.
이 키는 상인 접근 권한을 제공하지 않습니다. 이전 `ADMIN_API_KEY`는 사용하지 않습니다.
Docker 밖에서는 환경 변수를 설정한 뒤 다음과 같이 실행합니다.

```powershell
$env:GENERATION_WORKER_BASE_URL = "http://localhost:3000"
node --env-file=.env scripts/generation-worker.mjs
```

작업 실행 권한은 30초마다 갱신하고 서버 중단 후 15분이 지나면 다시 선점할 수 있습니다.
정상 실패한 작업은 자동 재생성하지 않습니다. 외부 요청 성공과 DB 기록 사이의 장애에서는
추가 호출 비용을 완전히 배제할 수 없습니다. Instagram 컨테이너 ID를 저장하기 전에
프로세스가 중단되면 자동 재게시하지 않으며 외부 상태를 확인해야 합니다.

## 검증

### ERD — dbdiagram.io

- 현재 구현: [docs/erd/current.dbml](docs/erd/current.dbml). 저장소의 `supabase/schema.sql`을 기준으로 추출한 구조이며 실제 운영 DB를 조회한 결과는 아닙니다.
- 구현된 제작 흐름: [docs/erd/workflow.dbml](docs/erd/workflow.dbml). 같은 스키마에서 주요 12개 테이블만 추출한 협업용 ERD입니다. 과거 미구현 개선안 파일은 이 실제 구현 기반 파일로 대체했습니다.
- 저장된 다이어그램: [Postalk - Current](https://dbdiagram.io/d/Postalk-Current-6ae842d1f99a5c458bd3cb2f), [Postalk - Workflow](https://dbdiagram.io/d/Postalk-Workflow-6ae843398bf38111a80408eb). 팀 공유 시 계정의 공유 메뉴에서 접근 권한을 확인합니다.
- [dbdiagram.io 편집기](https://dbdiagram.io/d)에 각 DBML 파일 내용을 붙여 넣습니다. `Current`는 전체 구현, `Workflow`는 같은 구현의 제작 흐름 부분입니다. 운영 DB 적용 여부를 의미하지 않습니다.
- 현재 구조 재생성: `node scripts/export-erd.mjs`. 환경 파일을 읽지 않고 메모리 PostgreSQL에서 SQL을 실행해 추출합니다. 운영 DB 접속이나 변경은 없습니다.
- 현재 파일에는 전체 22개 테이블·35개 FK와 컬럼·기본값·유일키·삭제 동작을 기록합니다. CHECK와 인덱스 SQL은 테이블 노트에 표시합니다. 함수·트리거·RLS·권한·호환 뷰의 원본은 SQL입니다. Workflow에서는 생략한 기술·이전 테이블로 향하는 FK 선도 생략합니다.
- `users.id`는 UUID이며 전시용 `user_id=1`과 관계가 없습니다. 실제 계정과 가게 권한 모델은 별도 확정 사항입니다.
- 생성 세션·장면·자막 작업·파일 위치·생성 결과·게시 시도를 실제 DB 관계로 분리했습니다. 기존 전시 테이블 세 개는 같은 데이터를 가리키는 호환 뷰이며 API 응답 계약은 유지합니다. 프론트 Context 및 촬영 Blob의 임시 보관 원칙도 유지합니다.
- 신규 DB는 전체 schema.sql, 기존 DB는 [배포 순서](docs/OPERATIONS.md)에 따라 마지막 정규화 마이그레이션을 적용해야 합니다. DBML SQL 내보내기만으로 함수·트리거·RLS를 대체하지 마세요. Supabase가 기본이며 AWS 전환과 파일 자동 삭제는 실행하지 않습니다.

### 실행 검증

```powershell
npm test
npx tsc --noEmit --incremental false
npm run lint
node node_modules/next/dist/bin/next build --webpack
docker compose config --quiet
```

기본 `npm run build`는 Turbopack을 사용합니다. Windows 샌드박스의 자식 프로세스 오류를
피해 검증할 때에는 위 Webpack 명령을 사용할 수 있습니다.
서버 안내 페이지는 시스템 글꼴을 사용해 빌드 시 Google Fonts를 내려받지 않습니다.
