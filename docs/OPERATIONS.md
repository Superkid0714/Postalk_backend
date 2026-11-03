# 배포·운영 안내

## 현재 클라우드 적용 상태 (2026-11-03 KST)

기존 프로젝트를 Resume한 뒤 DB 마이그레이션과 private `uploads` 버킷 설정을 적용했습니다.
기존 데이터의 행 수 보존과 실제 DB 제작 RPC 검증, Storage 왕복 및 익명 접근 차단을 확인했습니다.
상세 증거·범위·남은 작업은 [적용 기록](SUPABASE_DEPLOYMENT_20261103.md)을 확인하세요.
현재 Free/Nano이며 Pro 결제는 별도입니다. 아래 최초 테스트 환경 안내는 추가 테스트 프로젝트를 만들 때 사용합니다.

기존 2026년 8월 스키마에는 위치 필드와 영상 촬영 제약조건 선행 변경도 필요합니다.
해당 버전용 묶음은 `node supabase/operations/build-existing-upgrade.mjs <output.sql>`로 생성합니다.
현재 업그레이드된 프로젝트에는 다시 실행하지 않습니다. 새 버전 DB에는 개별 후속 변경만 적용하세요.
이 묶음은 같은 트랜잭션에서 테이블 잠금·최근 작업 차단·이전 기술 상태 기록·기존 행 수 보존을 확인합니다.
오류가 나면 전체 롤백되며, 실행 세션에 남은 트랜잭션이 있다면 `ROLLBACK` 후 원인을 확인합니다.

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
| 7 | 20261102_z_normalized_workflow.sql | 생성 세션·장면·콘셉트 스냅샷·파일 카탈로그·게시 시도 기록, 이전 이름 호환 뷰 |
| 8 | 20261102_zz_server_only_tables.sql | 가게·사용자·기존 촬영·QR 테이블의 RLS 및 서버 전용 명시적 권한 |

같은 접수에 활성 작업이 중복되면 두 번째 SQL은 실패하고 전체 롤백됩니다. 먼저 확인하세요.

```sql
select submission_id, array_agg(id) as job_ids
from public.generation_jobs
where status in ('queued', 'processing')
group by submission_id having count(*) > 1;
```

이전 DB의 검수 메모·통계 기록은 삭제하지 않으며 코드에서는 사용하지 않습니다.
기존 프로젝트에는 사용자 행이 없음을 확인한 뒤 역할 제약을 seller 전용으로 맞췄습니다.
상태는 실제 Instagram 게시 기록이 있으면 published, 나머지 과거 검수 상태는 draft로 전환됩니다.
환경 설정 후 코드를 배포하고 API·QR 권한·생성·게시 흐름을 확인한 뒤 일반 쓰기를 재개합니다.

## 환경

### 최초 테스트 Supabase 프로젝트 설치

별도 클라우드 테스트 프로젝트는 아직 생성하지 않았습니다. 대시보드 접속이 복구되면 다음 순서로 진행합니다.
프로젝트 이름은 postalk-staging을 권장합니다. 현재 .env의 프로젝트와 다른 프로젝트인지 ref를 대조하세요.
DB 비밀번호는 프로젝트 생성 화면에서 직접 설정하고 실제 키는 로컬 .env.staging에만 입력합니다.
계정의 무료 프로젝트 생성 가능 여부를 확인하며 유료 전환을 자동 진행하지 않습니다.

새 프로젝트의 SQL Editor에서 아래 파일을 차례로 실행합니다. 기존 DB의 순차 업그레이드와 다른 절차입니다.

| 순서 | 파일 | 확인할 결과 |
| --- | --- | --- |
| 0 | [빈 DB 확인](../supabase/staging/00-check-empty.sql) | EMPTY_PUBLIC_SCHEMA; public에 테이블이 있으면 중단 |
| 1 | [전체 설치 SQL](../supabase/schema.sql) | 모든 SQL 성공. 기존 DB에 재실행하지 않음 |
| 2 | [설치 검증](../supabase/staging/02-verify.sql) | PASS 결과와 ROLLBACK. 임시 제작·캡션·삭제 검사가 실제 테이블에 잔류하지 않음 |
| 3 | [비공개 업로드 버킷](../supabase/staging/03-private-storage.sql) | 이후 API 파일 테스트에 필요. 이미 있는 버킷은 변경하지 않고 중단 |

검증 SQL은 실제 PostgreSQL 테이블·FK·서버 권한·RLS·RPC·호환 뷰와 생성 멱등성을 점검합니다.
실제 Storage 파일·AI·Instagram API를 호출하지 않습니다. 버킷 SQL은 새 테스트 프로젝트의 메타데이터만 생성합니다.
버킷은 비공개이고 50 MiB 제한입니다. 전시 API의 사진 상한은 10 MiB, 영상 상한은 50 MiB로 일치시켰습니다.
프로젝트 전체 파일 제한도 별도로 적용됩니다. 버킷만 변경해 프로젝트 상한을 우회할 수는 없습니다.
공개 Storage 정책을 추가하지 않습니다. 파일 접근은 서버와 만료되는 서명 URL을 사용합니다.

[테스트 환경 예시](../supabase/staging/env.example)를 새 .env.staging으로 복사하고 테스트 프로젝트의 값만 입력합니다.
기존 .env와 기존 프로젝트를 변경하지 않습니다. 예시의 외부 서비스 빈 값도 유지해야 Next.js가 기존 .env에서
AI/Instagram/AWS 설정을 상속하지 않습니다. .env.staging은 Git에서 제외됩니다.

```powershell
if (Test-Path -LiteralPath .env.staging) { throw '.env.staging already exists' }
Copy-Item -LiteralPath supabase/staging/env.example -Destination .env.staging
# 테스트용 URL·키를 로컬 파일에 설정한 다음 실행
node --env-file=.env.staging node_modules/next/dist/bin/next dev -p 3100
```

EXHIBITION_MODE_ENABLED는 초기 false이며 SQL 검증 자체에는 앱 서버나 API 키가 필요하지 않습니다.
다음 단계에서 테스트 가게와 전시 비밀키를 설정하고 명시적으로 활성화한 뒤 프론트와 연결합니다.
SQL Editor 검사 통과는 실제 Supabase PostgREST·Storage 통합 검사를 대신하지 않습니다.

### 서버 설정 값

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

새 서버와 도메인이 없는 경우 [Render 배포 절차](RENDER_DEPLOYMENT.md)와 `render.yaml`을 사용합니다.
API와 경량 복구 워커를 분리하며, 최초 배포 워커는 비활성 상태입니다. 실제 클라우드 적용 여부는 해당 절차와 구분합니다.

### 배포 점검 결과 (2026-11-03 KST)

기존 문서의 Vercel main 주소 `https://postalk-backend-git-main-cnu-clothing.vercel.app/api/health`는
HTTP 200과 `service=postalk-backend`를 응답했습니다. 커밋 `8fccafc`의 GitHub Vercel 상태도 success입니다.
그러나 main 주소가 해당 커밋을 실행한다는 증거는 아닙니다. Vercel 상세 화면은 로그인이 필요하여
최신 브랜치의 실제 도메인·환경 변수·운영 승격·프론트 연결 여부는 아직 확인하지 못했습니다.
같은 main 주소의 `GET /api/exhibition/uploads`는 HTML 404를 반환했습니다.
새 코드의 비활성화 응답은 JSON이므로, 이 주소에서 최신 전시 라우트가 제공되는 것으로 확인되지 않았습니다.

현재 영상 업로드는 API를 통과하는 multipart 방식입니다. Vercel Functions의 요청 본문 4.5MB 제한 때문에
앱의 사진 10MiB·영상 50MiB 상한 전체를 처리할 수 없습니다.
[Vercel 공식 제한](https://vercel.com/docs/errors/function_payload_too_large)을 참조하세요.
Supabase Pro 결제로 이 API 서버 제한이 바뀌지는 않습니다.

행사 배포는 API와 복구 워커를 Docker의 상시 실행 서버에서 함께 운영하는 방향을 우선 권장합니다.
DB·Storage는 Supabase를 유지합니다. Vercel을 API 호스트로 유지하려면 서명 업로드·완료 검증을 도입해
미디어를 Supabase로 직접 전송하고, 장시간 렌더링·복구 워커 실행 환경을 별도로 확정해야 합니다.
현재 Docker 설정은 준비되어 있지만 실제 클라우드 컨테이너 배포는 실행하지 않았습니다.
로컬 Docker daemon도 중지 상태여서 이번 점검에서는 컨테이너 빌드·실행을 확인하지 못했습니다.

Docker 빌드 문맥에서 `.env*`, 개인 QR, 임시 결과를 제외하도록 `.dockerignore`를 보완했습니다.
실제 환경 값은 Compose의 runtime `env_file` 또는 배포 플랫폼의 환경 변수로 주입합니다.

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

### 11월 18~21일 전시: Supabase Pro 운영

약 200건 제작을 계획하며 DB와 이미지·영상 저장은 Supabase Pro로 통일합니다.
MEDIA_STORAGE_PROVIDER=supabase를 유지하고 AWS 이전은 보류합니다. 실제 결제·구독 변경은 이 코드가 실행하지 않습니다.
Supabase의 Pro 구독은 조직 단위이고 파일/전송 할당량을 공유하므로 테스트 프로젝트를 포함한 조직 Usage도 확인합니다.
Next.js/FFmpeg 실행 서버와 외부 AI/TTS 비용은 Supabase 구독과 별개입니다.

행사 전에 프론트의 파일 제한을 GET /api/exhibition/uploads 정책에 맞추고, 실제 uploads 버킷 상한도 50MiB로 확인합니다.
사진 10MiB, 영상 50MiB, multipart 전체 52MiB입니다. 기존 버킷 설정은 코드에서 자동 변경하지 않습니다.
서버/리버스 프록시의 요청 상한이 작으면 배포 설정을 조정해야 합니다. 현재 방식은 크기를 제한한 multipart이며
영상 재개 업로드(TUS)나 원본 자동 압축을 구현한 것은 아닙니다. 동시 업로드·제작 부하는 리허설에서 확인합니다.

매일 운영 전후 다음 읽기 전용 명령과 Supabase Usage 화면을 확인합니다.

```powershell
node --env-file=.env.staging scripts/report-media-usage.mjs
# 실서비스 점검 시에는 승인된 실서비스 환경 파일을 명시
```

MEDIA_STORAGE_WARNING_GB의 기본값은 70(decimal GB)이며 이 프로젝트의 DB 등록 Supabase 파일 합계에 대한 점검 기준입니다.
이는 실제 플랜 할당량 조회·조직 전체 집계·업로드 차단·자동 알림 기능이 아닙니다. storageWarning을 사람이 확인합니다.
등록 전체/그중 Supabase 바이트, 크기 미상 객체와 미참조 후보 수도 출력합니다. S3 참조는 Supabase 경고 계산에서 제외합니다.
실제 Storage에만 남은 객체와 전송량은 이 보고서에 없으므로 대시보드가 사용량 확인의 기준입니다.
507 STORAGE_QUOTA_EXCEEDED가 발생하면 현장 담당자가 한도를 확인하며 반복 재업로드하지 않습니다.
행사 종료 후 원본/결과의 보관·정리 시점을 결정합니다. 파일 자동 삭제와 외부 알림 발송은 실행하지 않습니다.

작은 대표 이미지(썸네일)는 카드뉴스 첫 장/릴스 첫 화면을 따로 축소한 파일입니다.
보관함 목록에서는 이 파일만 요청하며, 없는 경우 기본 이미지를 표시합니다. 원본·완성 영상은 상세에서 조회합니다.

### 도구 실행

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

## 정규화 구조 적용과 확인

7~8번 마이그레이션과 새 서버 코드를 함께 배포합니다. 운영 DB에 자동 적용하는 코드는 없습니다.
먼저 복제/테스트 DB에 적용하고 실제 Supabase PostgREST를 통한 템플릿 저장·대본 생성·업로드·제작·조회를 확인하세요.
PGlite는 PostgreSQL 테이블/RPC를 실행하지만 Supabase PostgREST의 스키마 캐시와 뷰 노출 검증은 별도입니다.

기존 exhibition_templates / exhibition_script_jobs / exhibition_ads는 각각 input_templates / script_jobs / contents로
이름 변경하며 이전 이름은 security-invoker 단순 뷰로 제공합니다. 같은 행을 읽고 쓰며 별도 복제 테이블이 아닙니다.
사용 중인 submissions와 생성/게시 lease 테이블은 유지합니다. 기존 캡션·게시 JSON 저장 경로를 유지하고
트리거가 같은 트랜잭션에서 콘텐츠/시도 기록을 연결합니다. 관리자 기능은 도입하지 않습니다.

업로드는 제작 세션을 만들고, 대본은 입력 스냅샷을 연결하며, 생성 요청은 입력과 장면·최종 자막을 고정합니다.
제출한 세션은 다른 입력으로 재사용할 수 없습니다. 새 제작에는 새 creationId를 사용합니다.
콘셉트는 전달받은 템플릿 전체의 불변 스냅샷입니다. 업체 버전이 같아도 메뉴별 장면 구성이 다르면
definition_digest로 다른 내부 스냅샷을 구분합니다. 최종 콘셉트 디자인을 임의로 만들지는 않습니다.

기존 파일 메타데이터를 카탈로그로 연결하고 새 업로드·결과에는 SHA-256을 저장합니다.
옛 파일의 알 수 없는 크기·해시는 만들지 않습니다. 업로드 재시도의 이전 객체도 삭제하지 않습니다.
이전 게시 이력은 남아 있는 마지막 메타데이터만 가져오며 사라진 과거 시도를 복원했다고 간주하지 않습니다.

```sql
-- 서버 권한 SQL Editor: 등록된 파일 용량만 읽기 전용 집계
select public.media_usage_summary();
-- 신규 구조 연결 확인
select c.id,c.session_id,j.content_id,j.status
from public.contents c join public.generation_jobs j on j.id=c.job_id;
```

용량 집계는 provider별 이미지/영상/기타 개수·bytes, 크기 미상 개수, DB 참조가 없는 객체 후보 수를 제공합니다.
실제 Storage 전체 목록·전송량·청구액이 아니며, 외부 객체의 존재를 확인하거나 삭제하지 않습니다.
참조 없음은 삭제 허가가 아닙니다. 보관 기간과 외부 게시 접근 여부를 확인한 별도 정리 정책이 필요합니다.

## Instagram 응답 유실 복구

media_publish 전 요청 시각과 결과 불확실 상태를 먼저 DB에 기록합니다.
응답 유실·게시 후 DB 장애가 있으면 같은 외부 호출을 반복하지 않습니다. 성공 기록 후에는 불확실 상태를 해제합니다.
복구 워커는 outcomeUnknown=true 건을 자동 재게시하지 않습니다.
상세와 게시 응답의 requiresVerification=true는 결과 확인이 필요한 상태이며 UI 게시 상태는 publishing을 유지합니다.

Instagram 게시 내역을 직접 확인한 뒤 서버 권한으로 아래 RPC를 호출할 수 있습니다.
실행 중 lease가 없고 최초 게시 요청 이후 15분이 지난 건만 처리합니다. 확인 근거는 DB 시도 기록에 보관합니다.
게시 ID는 실제로 확인된 숫자 ID여야 합니다. NULL은 실제 미게시를 확인한 경우에만 사용합니다.

```sql
-- 예시 값을 실제 확인한 값으로 교체
select public.reconcile_instagram_publication(
  '00000000-0000-4000-8000-000000000000'::uuid,
  '123456789', 'Instagram 게시 내역과 게시 ID를 직접 대조한 확인 근거',
  'https://www.instagram.com/p/VERIFIED_POST/'
);
```

이 RPC는 공개 API나 관람객 기능이 아닙니다. 확인 없이 failed로 바꿔 재시도하면 중복 게시 위험이 있습니다.
실제 DB 이전과 외부 Instagram/AWS/AI 호출은 로컬 검사에서 실행하지 않았습니다.

## 의존성 점검 기록

2026-11-02 기준 Next.js와 대응 ESLint 설정을 16.4.3으로 고정하고 호환 범위의 보안 패치를 적용했습니다.
운영 의존성 점검 `npm audit --omit=dev`는 취약점 0개입니다.
전체 점검에는 ESLint 계열 minimatch에서 전파되는 개발 도구의 중간 등급 16개가 남아 있습니다.
자동 제안의 강제 수정은 ESLint를 호환되지 않는 버전으로 내리므로 적용하지 않았습니다.
개발 도구의 호환 가능한 수정 버전이 나오면 별도 갱신해야 합니다.

DB 이전 테스트는 PGlite의 임시 PostgreSQL 엔진에서 실제 스키마와 RPC를 실행합니다.
다섯 종류 참조의 전환, 원본 참조 복귀, 중간 실패 시 원자적 롤백, 익명 실행 거부를 검증합니다.
AWS SDK 테스트는 mock을 사용하므로 실제 AWS 권한과 네트워크 검증은 별도로 필요합니다.
