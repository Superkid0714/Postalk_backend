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

프론트 도메인이 정해지면 추가합니다.

```dotenv
CORS_ALLOWED_ORIGINS=https://actual-frontend-domain.example
```

## 배포 확인

```text
GET https://postalkbackend-production.up.railway.app/api/health
GET https://postalkbackend-production.up.railway.app/api/health/ready
```

두 번째 요청에서 `database: ok`, `storage: ok`가 나오면 DB와 Storage까지 정상입니다.

## 기능 점검

1. QR 진입과 상인 인증
2. 사진 1개 업로드
3. 영상 1개 업로드
4. 카드뉴스 1건 생성
5. 무음 자막 릴스 1건 생성
6. 별도 Instagram 계정으로 게시 1건 리허설

외부 AI와 Instagram은 비용 또는 실제 게시가 발생할 수 있으므로 운영 계정으로 반복 호출하지 않습니다.

## 장애 확인

| 증상 | 먼저 볼 곳 |
| --- | --- |
| API가 열리지 않음 | Railway Deployments, `/api/health` |
| DB·파일 오류 | `/api/health/ready`, Railway Variables |
| CORS 오류 | `CORS_ALLOWED_ORIGINS` |
| 생성 실패 | Railway 로그, AI 공급자 설정 |
| 게시 실패 | Railway 로그, Instagram 토큰·권한 |

## 운영 종료

1. Supabase에 결과 파일이 남아 있는지 확인합니다.
2. Railway API와 워커를 중지하거나 삭제합니다.
3. Railway Usage가 더 증가하지 않는지 확인합니다.
4. 보관이 더 필요 없을 때 Supabase Pro 하향 여부를 결정합니다.
