# 배포·운영 안내

## 배포 순서

API 쓰기와 워커를 중지하고 DB를 백업합니다. 기존 DB에는 아래 SQL을 순서대로 적용합니다.
신규 DB에는 supabase/schema.sql을 사용합니다.

| 순서 | SQL | 목적 |
| --- | --- | --- |
| 1 | 20261102_generation_job_leases.sql | 생성 작업 실행 권한 선점·갱신 |
| 2 | 20261102_remove_review_workflow.sql | 검수 상태 전환·중복 활성 작업 제한·영상 스타일 허용 |
| 3 | 20261102_session_draft_merge.sql | 초안의 촬영 진행 상태 덮어쓰기 방지 |
| 4 | 20261102_submission_publish_leases.sql | 중복 게시 방지·메타데이터 원자적 병합 |
| 5 | 20261102_media_storage_remap.sql | 검증된 객체의 저장소 참조 전환 |
| 6 | 20261102_exhibition_flow.sql | 전시용 템플릿·대본·일괄 제작·상세 수정·삭제 및 저장소 참조 확장 |

같은 접수에 활성 작업이 중복되면 두 번째 SQL은 실패하고 전체 롤백됩니다. 먼저 확인하세요.

```sql
select submission_id, array_agg(id) as job_ids
from public.generation_jobs
where status in ('queued', 'processing')
group by submission_id having count(*) > 1;
```

이전 DB의 검수 메모·역할·통계 기록은 삭제하지 않으며 코드에서는 사용하지 않습니다.
상태는 실제 Instagram 게시 기록이 있으면 published, 나머지 과거 검수 상태는 draft로 전환됩니다.
환경 설정 후 코드를 배포하고 API·QR 권한·생성·게시 흐름을 확인한 뒤 일반 쓰기를 재개합니다.

## 환경

- DB: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- 내부 워커: INTERNAL_WORKER_API_KEY
- 주소: NEXT_PUBLIC_APP_URL
- 게시: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_IG_USER_ID
- AI·공공데이터: .env.example 참조
- 저장소: 기본 MEDIA_STORAGE_PROVIDER=supabase; [AWS 이전 안내](AWS_MEDIA_MIGRATION.md) 참조

ADMIN_API_KEY는 사용하지 않습니다. 내부 키는 상인 인증 수단이 아닙니다.
서비스 역할 키·AWS 비밀키·Instagram 토큰을 프론트엔드에 전달하지 마세요.
.env, 실제 QR 이미지, 파일 이전 보고서를 커밋하지 않습니다.

## 실행

```powershell
npm ci
npm run dev
```

```powershell
docker compose up -d --build
docker compose logs -f
```

Compose는 API 서버와 복구 워커를 실행합니다. 실제 DB·AI·S3 처리는 API 서버가 수행합니다.
standalone 빌드 직접 실행은 node .next/standalone/server.js를 사용하며 static/public 자산 배치를 확인하세요.
Docker 외 워커 실행:

```powershell
$env:GENERATION_WORKER_BASE_URL = "http://localhost:3000"
node --env-file=.env scripts/generation-worker.mjs
```

워커는 20초마다 확인하며 생성 실행 권한은 30초마다 갱신합니다.
중단 후 마지막 갱신에서 15분이 지나면 다른 작업자가 다시 선점할 수 있습니다.
정상 실패한 생성 작업은 자동 재생성하지 않습니다.
외부 호출 성공과 DB 기록 사이의 장애에서는 추가 비용을 완전히 배제할 수 없습니다.
Instagram 컨테이너 ID를 저장하기 전에 프로세스가 중단되면 자동으로 새 게시를 만들지 않습니다.
영상 제공자 작업 ID를 잃은 생성 작업도 자동으로 유료 요청을 반복하지 않습니다. 외부 상태 확인 후 복구하세요.

## QR·썸네일 도구

실제 DB와 파일을 변경하므로 필요한 경우에만 명시적으로 실행합니다.

```powershell
node --env-file=.env scripts/create-merchant-qr.mjs merchant-qr.png
node --env-file=.env --import tsx scripts/backfill-video-thumbnail.mjs SUBMISSION-ID
```

QR은 서버 자격 정보로 발급합니다. 공개 발급 API는 없습니다.
썸네일 도구는 Supabase와 S3 파일을 모두 지원합니다.

## 검증

```powershell
npm test
npx tsc --noEmit --incremental false
npm run lint
node node_modules/next/dist/bin/next build --webpack
docker compose config --quiet
npm audit --omit=dev
```

단위 테스트와 빌드는 실제 서비스 연결 검증을 대신하지 않습니다.
S3 전환 전 비공개 버킷·IAM·사진/영상 업로드·미리보기·상인 명시적 게시를 실제 환경에서 확인하세요.
/api/health는 프로세스 응답 확인용이며 DB·AI·AWS 연결을 보증하지 않습니다.

전시 기능은 기본적으로 꺼져 있습니다. 활성화 환경과 화면별 계약은 [전시 연동 문서](EXHIBITION_API.md)를 따르세요.

## 의존성 점검 기록

2026-11-02 기준 Next.js와 대응 ESLint 설정을 16.4.3으로 고정하고 호환 범위의 보안 패치를 적용했습니다.
운영 의존성 점검 `npm audit --omit=dev`는 취약점 0개입니다.
전체 점검에는 ESLint 계열 minimatch에서 전파되는 개발 도구의 중간 등급 16개가 남아 있습니다.
자동 제안의 강제 수정은 ESLint를 호환되지 않는 버전으로 내리므로 적용하지 않았습니다.
개발 도구의 호환 가능한 수정 버전이 나오면 별도 갱신해야 합니다.

DB 이전 테스트는 PGlite의 임시 PostgreSQL 엔진에서 실제 스키마와 RPC를 실행합니다.
다섯 종류 참조의 전환, 원본 참조 복귀, 중간 실패 시 원자적 롤백, 익명 실행 거부를 검증합니다.
AWS SDK 테스트는 mock을 사용하므로 실제 AWS 권한과 네트워크 검증은 별도로 필요합니다.
