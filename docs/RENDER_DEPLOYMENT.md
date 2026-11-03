# Render 배포 — 서버·도메인이 없는 경우

## 준비 검증 기록

2026-11-03 KST 기준 전체 테스트 152개, TypeScript 검사, ESLint(오류 0개), 프로덕션 standalone 빌드를 확인했습니다.
실제 standalone 서버에서도 process health·전시 라우트·CORS·내부 워커 인증 검사가 통과했습니다.
검증에는 가짜 환경 값을 사용했으며 DB·Storage·AI·Instagram은 호출하지 않았습니다.
로컬 Docker daemon을 시작할 수 없어 Linux 컨테이너 이미지 실행 검증은 아직 하지 못했습니다.
Render의 실제 Docker 빌드와 배포 후 smoke check를 완료해야 클라우드 적용 완료로 판단합니다.

## 선택한 구성

| 구성 요소 | 배포 위치 / 역할 |
| --- | --- |
| API 서버 `postalk-api` | Render Web Service, Docker, Singapore, 1 CPU / 2GB, 인스턴스 1개 |
| 복구 워커 `postalk-recovery` | Render Background Worker, 0.5 CPU / 512MB, 인스턴스 1개 |
| DB·영구 이미지·영상 | 이미 적용한 Supabase 프로젝트와 private uploads 버킷 |
| API 주소 / HTTPS | Render가 발급하는 고유 `*.onrender.com` 주소와 TLS 사용 |
| 프론트 | 기존 배포를 유지하고 API base URL만 새 주소로 변경 |

실제 주소는 서비스 생성 후 확정됩니다. `postalk-api.onrender.com`이라는 특정 주소를 확보한 상태가 아닙니다.
워커는 같은 Singapore 리전의 API private hostport를 사용하며, 내부 키를 API 환경 변수에서 참조합니다.
워커에 Supabase service key, AI 키, Instagram 토큰을 복사하지 않습니다.
Render DB·Redis·영구 디스크·새 Supabase 프로젝트를 생성하지 않습니다.

배포 소스는 `codex/merchant-workflow-aws-storage` 브랜치의 `render.yaml`입니다.
API와 워커의 자동 배포는 off입니다. 행사 도중 Git push만으로 재시작하지 않습니다.
초기 전시 API와 워커도 비활성 상태로 생성하여 기존 외부 요청이 자동 실행되지 않도록 합니다.
이는 준비된 배포 구성이고, 실제 클라우드 서비스 생성·계정 연결·청구는 별도 단계입니다.

## 비용 (2026-11-03 확인)

| 항목 | 월 기준 금액 |
| --- | ---: |
| Hobby workspace | $0 |
| API `1c-2g` | $25 |
| Worker `0.5c-512mb` | $7 |
| 컴퓨트 합계 | $32 |

[Render 공식 가격](https://render.com/pricing)에서 확인했습니다. 컴퓨트는 실행 시간에 따라 초 단위로 비례 과금합니다.
30일을 가정한 96시간 실행의 단순 추산은 약 $4.27입니다. 준비·검증 기간 동안 켜둔 시간도 포함되며, 실제 청구액을 보장하는 견적은 아닙니다.
Hobby workspace는 전송량 월 5GB와 표준 빌드 500분을 포함합니다. 초과 전송량은 $0.15/GB,
추가 표준 빌드 시간은 $5/1,000분으로 안내돼 있습니다. 세금·환율·Supabase 구독·AI 비용은 별도입니다. 릴스는 TTS를 사용하지 않습니다.
Render Pro workspace 구독 $25는 이 두 서비스를 운영하기 위한 필수 선택이 아닙니다.
워크스페이스 기능이 추가로 필요할 때만 선택하세요. 유료 컴퓨트와 workspace 요금은 다른 항목입니다.

행사 종료 후 서비스를 suspend 또는 제거하고 Billing에서 과금 중단을 확인합니다.
이 문서나 코드는 자동 종료 일정을 만들지 않습니다. 서비스 삭제 전에 소스 커밋과 환경 변수 복구 방법을 확인하세요.

## 배포 전 사용자 계정 단계

1. Render 계정 가입·로그인을 완료합니다. 가입 약관과 결제 수단 입력은 계정 소유자가 직접 처리합니다.
2. Render 플러그인을 연결하거나 대시보드에서 GitHub 저장소 `Superkid0714/Postalk_backend` 접근을 설정합니다. 필요한 저장소만 선택합니다.
3. 위의 유료 컴퓨트 2개와 로컬 Supabase 설정을 Render API 환경 변수로 등록할 대상을 확인한 뒤 생성합니다.
   비밀키를 GitHub·채팅·문서에 붙여 넣지 않습니다.

## Blueprint 적용

Render 대시보드의 New → Blueprint에서 해당 저장소와 브랜치를 선택하고 `render.yaml`을 사용합니다.
생성 목록이 web 1개와 worker 1개인지 확인합니다. DB나 디스크는 없어야 합니다.
API에 표시되는 sync:false 값은 다음과 같습니다.

| 환경 변수 | 입력할 값 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 기존 Supabase 프로젝트 URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 동일 프로젝트 anon key |
| SUPABASE_SERVICE_ROLE_KEY | 동일 프로젝트 서버 service key, API 서비스에만 등록 |
| CORS_ALLOWED_ORIGINS | 실제 프론트 origin. 예: https://posttalk.vercel.app. 여러 개는 쉼표로 구분 |

INTERNAL_WORKER_API_KEY와 EXHIBITION_PUBLISH_SECRET은 Render가 무작위로 생성합니다.
워커의 내부 키는 API 값을 참조하므로 두 곳에서 다른 키를 새로 만들지 않습니다.
`NEXT_PUBLIC_APP_URL`을 수동 입력하지 않으면 Render의 `RENDER_EXTERNAL_URL`을 사용합니다.
API에서 필요한 다른 AI/Instagram 변수는 `.env.example`을 기준으로 기능별로 추가합니다.
기존 `.env` 전체를 업로드하지 마세요. AWS, 과거 관리자 키 등 사용하지 않는 값은 등록하지 않습니다.

## 이미지·포트·종료 처리

- API Docker 이미지는 Node 22 / Debian bookworm slim, distro FFmpeg와 한글 폰트를 설치합니다.
- FFMPEG_BIN·FFMPEG_PATH를 `/usr/bin/ffmpeg`로 통일합니다. standalone 번들과 public/static/font를 포함합니다.
- root 대신 node 사용자로 실행하고 `HOSTNAME=0.0.0.0`, Render PORT=10000을 사용합니다.
- 워커는 FFmpeg·Next.js·Supabase SDK 없는 작은 Node 이미지에서 HTTP 복구 요청만 전송합니다.
- API의 종료 유예는 180초입니다. 이를 넘는 진행 중 작업은 종료될 수 있고 DB lease 만료 후 복구 대상이 됩니다.
- `.env*`와 개인 QR·임시 결과는 Docker 문맥에서 제외합니다. 영구 파일은 Supabase에만 저장하며 컨테이너 /tmp는 임시 작업용입니다.

## 첫 배포 검증

두 서비스가 실행된 뒤 발급된 실제 API URL과 프론트 origin으로 아래 읽기 전용 점검을 실행합니다.

```sh
node scripts/smoke-deployment.mjs https://ACTUAL-SERVICE.onrender.com https://posttalk.vercel.app
```

확인 항목은 process health, health 응답 revision, 전시 라우트 존재(JSON 404 또는 인증 오류),
인증 없는 워커 요청 차단, CORS preflight입니다. DB 행·Storage·AI·Instagram을 읽거나 호출하지 않습니다.
health 성공은 DB·AI·실제 게시 성공을 뜻하지 않습니다.

추가 검증 순서는 아래와 같습니다.

1. health revision이 배포 대상으로 선택한 커밋과 일치하는지 확인
2. EXHIBITION_STORE_ID를 실제 확인된 전시 가게 UUID로 설정하고 EXHIBITION_MODE_ENABLED=true 적용
3. 서명 URL·업로드·조회·캡션을 프론트에서 검증. 4.5MB보다 큰 사진과 50MiB 이하 영상을 실제로 전송하여 클라우드 경로 제한 확인
4. 최종 콘셉트와 AI 설정 후 카드뉴스·무음 자막 릴스 결과를 한 건씩 확인
5. 기존 진행 중 작업과 외부 제공자 상태를 확인한 뒤 워커 GENERATION_WORKER_ENABLED=true 적용
6. 상인이 명시적으로 게시 버튼을 누르는 Instagram 검증 후 행사 리허설

현재는 1 CPU / 2GB 구성으로 실제 동시 제작 부하를 측정하지 않았습니다. 약 200건이라는 총량만으로 처리 성능을 보장하지 않습니다.
작업 시간, 동시 요청 수, 메모리, /tmp 사용량을 리허설에서 확인하고 필요 시 동시 제작 제한 또는 인스턴스 크기를 조정합니다.
무료 웹 서비스의 sleep을 피하기 위해 유료 컴퓨트를 선택했습니다. 인스턴스 1개 구성은 고가용성 이중화를 의미하지 않습니다.

## 업데이트·복구

일반 업데이트는 작업이 진행되지 않는 시간에 API부터 수동 배포하고 health와 revision을 확인한 뒤 워커를 배포합니다.
실행 중 유료 요청을 반복 호출하지 않으며, 게시 결과 불확실 상태는 [운영 문서](OPERATIONS.md)의 복구 절차를 따릅니다.
애플리케이션 이미지 롤백과 DB 스키마 롤백은 별개입니다. DB를 이전 상태로 덮어쓰지 마세요.
기존 Vercel은 새 API 연결 확인 전까지 유지하고, 중복 워커가 실행되지 않는지 확인합니다.

참고: [Blueprint](https://render.com/docs/blueprint-spec), [Web Services](https://render.com/docs/web-services),
[Compute plans](https://render.com/docs/compute-plans), [Health checks](https://render.com/docs/health-checks).
