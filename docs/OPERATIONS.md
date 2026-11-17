# 운영 순서

현재 운영 구조는 **GitHub main → GitHub Actions → Railway → Supabase Pro**입니다.

## 배포 전 확인

1. GitHub Actions가 성공했는지 확인합니다.
2. Railway 서비스의 Source Branch가 `main`인지 확인합니다.
3. Railway Variables에 Supabase 값이 등록되어 있는지 확인합니다.

필수 변수:

```dotenv
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
MEDIA_STORAGE_PROVIDER=supabase
EXHIBITION_MODE_ENABLED=false
GENERATION_WORKER_ENABLED=false
```

현재 운영 프론트와 로컬 개발 프론트의 CORS 허용 목록입니다.

```dotenv
CORS_ALLOWED_ORIGINS=https://posttalk.vercel.app,http://localhost:5173
```

이 버전을 배포하기 전에 기존 DB에 `supabase/migrations/20261111_guest_sessions.sql`을 적용합니다. 신규 DB의 `schema.sql`에는 포함되어 있습니다. QR 없이 제작하려면 Railway에 `GUEST_CREATION_ENABLED=true`를 설정합니다.

## 배포 확인

```text
GET https://postalkbackend-production.up.railway.app/api/health
GET https://postalkbackend-production.up.railway.app/api/health/ready
```

두 번째 요청에서 `database: ok`, `storage: ok`가 나오면 DB와 Storage까지 정상입니다.

`/api/health`의 `revision`으로 운영 커밋을 확인합니다. DB 또는 `uploads` 버킷 점검에 실패하면 `/api/health/ready`는 HTTP 503과 의존성별 상태를 반환합니다.

운영 API, 게스트 경로, 프론트 CORS를 한 번에 확인할 수 있습니다. 아래 명령은 데이터 생성이나 외부 AI·Instagram 호출을 하지 않습니다.

```powershell
node scripts/smoke-deployment.mjs https://postalkbackend-production.up.railway.app https://posttalk.vercel.app --ready --guest
node scripts/smoke-deployment.mjs https://postalkbackend-production.up.railway.app http://localhost:5173 --guest
```

## 기능 점검

1. 프론트 주소로 진입해 게스트 작업 공간을 열고, 새로고침 후 같은 보관함이 열리는지 확인
2. 사진 1개 업로드
3. 영상 1개 업로드
4. 카드뉴스 1건 생성
5. 릴스 서비스를 연결하고 자막과 배경음악이 들어간 릴스 1건 생성
6. 게스트가 본인 광고만 게시할 수 있고 다른 작업 공간의 광고는 거절되는지 확인
7. 기존 상인 게시를 사용하는 경우 별도 Instagram 계정으로 게시 1건 리허설

외부 AI와 Instagram은 비용 또는 실제 게시가 발생할 수 있으므로 운영 계정으로 반복 호출하지 않습니다.

## 장애 확인

홈·보관함·제작 결과에 쓰는 서명 URL 캐시는 백엔드 프로세스마다 최대 512개를 5분간 보관합니다. 작업 공간 접근 권한은 요청마다 확인하며 목록과 상태도 매번 조회합니다.

| 증상 | 먼저 볼 곳 |
| --- | --- |
| API가 열리지 않음 | Railway Deployments, `/api/health` |
| 게스트 작업 공간 503 | 아래 게스트 인증 장애 대응, Supabase API Gateway 원본 로그 |
| DB·파일 오류 | `/api/health/ready`, Railway Variables |
| CORS 오류 | `CORS_ALLOWED_ORIGINS` |
| 생성 실패 | Railway 로그, AI 공급자 설정 |
| 게시 실패 | Railway 로그, Instagram 토큰·권한 |

### 게스트 인증 장애 대응

`POST /api/guest-session`이 `503 AUTH_UNAVAILABLE`을 반환하면 기존 게스트 키를 유지합니다. 서버는 일시적 DB 장애와 서버 키의 `401/PGRST303`에 대해 최대 3회, 시도당 5초 제한으로 복구를 시도합니다. 그 외 인증·권한·제약조건 오류는 재시도하지 않습니다.

1. Railway 로그에서 `Retrying guest workspace database operation`과 `Guest workspace database operation failed`의 `operation`, `status`, `code`를 확인합니다. 로그의 `status`는 Supabase 상태이고 프론트가 받은 503과 다를 수 있습니다.
2. Supabase Logs의 API Gateway에서 같은 UTC 시각의 `/rest/v1/stores` 요청을 찾습니다. `response.status_code`, `response.headers.proxy_status`, 요청 ID로 교차 확인합니다. 로그의 키·해시·전체 URL은 공유하지 않습니다.
3. `401/PGRST303`은 JWT claims 검증·파싱 실패입니다. 서버의 `sb_secret_` 키는 `apikey`로만 보내며 같은 값을 Bearer로 중복 전송하지 않습니다. 레거시 JWT와 명시적 사용자 토큰은 기존 방식으로 전달합니다. 클라이언트의 게스트 키 교체나 권한 완화로 해결하지 않습니다.
4. 수정 후 동일 키로 가게 ID가 유지되는지, 새 작업 공간 생성과 업로드·생성·보관함 저장이 성공하는지 확인합니다. 오류 원문에 없는 만료·시계 오차 등의 원인을 단정하지 않습니다.

최초 장애 증거와 수정 범위는 [2026-11-18 조사 기록](incidents/20261118-guest-session-503.md)을 참고합니다.

### 검증 범위 해석

상태 점검 성공만으로 전체 기능의 성공을 판단하지 않습니다. 2026-11-18 인증 수정 후 확인한 범위는 게스트 생성·재접속 16회와 배포 API를 통한 기본형·크리스마스형 릴스 업로드·생성·보관함 저장입니다. 두 영상 모두 16초, 1080×1920 MP4와 오디오를 확인했습니다. 당시 자동 테스트는 174개가 통과했습니다.

이 검증에는 브라우저 화면 버튼 조작, 카드뉴스 재생성, Instagram 실제 게시가 포함되지 않았습니다. 해당 항목의 변경을 검증하려면 별도 리허설이 필요합니다.

## 운영 종료

1. Supabase에 결과 파일이 남아 있는지 확인합니다.
2. Railway API와 워커를 중지하거나 삭제합니다.
3. Railway Usage가 더 증가하지 않는지 확인합니다.
4. 보관이 더 필요 없을 때 Supabase Pro 하향 여부를 결정합니다.
