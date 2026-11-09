# Railway + Supabase Pro 배포 준비

현재 운영 구성입니다. 배포 기준 브랜치는 `main`입니다.

```text
프론트엔드 → Railway API (Postalk_backend) → Supabase Pro (DB / Auth / private Storage)
```

Railway에는 영구 DB·Volume·Object Storage를 만들지 않습니다. 이미지·영상은 Supabase의 비공개 `uploads` 버킷에만 저장합니다.

## 비용 기준과 선택

- Supabase Pro: 조직 구독 $25/월. 첫 Micro DB 컴퓨트가 포함되며 Storage 100GB와 7일 백업이 포함됩니다.
- Railway: Hobby는 월 최소 $5 사용료에 같은 금액의 사용 크레딧이 포함된 사용량 플랜입니다. Pro 워크스페이스는 현재 필요하지 않습니다.
- API를 0.5 vCPU / 1GB, 워커를 0.25 vCPU / 0.5GB로 계속 실행하면 한 달 약 $30의 Railway 리소스 사용량입니다. 11월 3일부터 21일까지 약 19일 실행 가정은 약 $19이며, Supabase와 합쳐 약 $44에 세금·환율·외부 AI 비용이 더해질 수 있습니다.
- Railway의 월 Hard Limit은 $25로 두고, 행사 종료 후 두 서비스를 중지하거나 삭제합니다. 한도에 도달하면 서비스가 중단될 수 있으므로 운영 중에는 Usage를 매일 확인합니다.

공식 가격과 세부 포함량은 [Supabase Pricing](https://supabase.com/pricing), [Railway Pricing](https://railway.com/pricing)에서 결제 직전에 다시 확인합니다.

## 사전 조건

1. Supabase 조직을 Pro로 업그레이드하고 Spend Cap은 켜 둡니다.
2. Railway에서 Hobby 워크스페이스를 선택하고 결제 수단을 등록합니다. 카드 정보는 채팅이나 저장소에 넣지 않습니다.
3. GitHub 저장소 `Superkid0714/Postalk_backend` 접근 권한을 Railway에 부여합니다.
4. 프론트의 API base URL이 환경 변수로 분리되어 있어야 합니다. 처음에는 실제 Railway public domain을 이 값으로 넣습니다.

## Railway 서비스 생성

현재 Railway 프로젝트의 API 서비스는 `Postalk_backend`입니다. GitHub 저장소 `Superkid0714/Postalk_backend`의 `main` 브랜치를 Source로 선택합니다.

복구 워커는 외부 AI 생성 작업을 실제로 운영할 때만 추가합니다. 현재는 `GENERATION_WORKER_ENABLED=false`를 유지합니다.

### API — `Postalk_backend`

- Builder: Dockerfile
- Dockerfile: 기본 `Dockerfile`
- Public Domain: 생성
- Healthcheck path: `/api/health`
- Healthcheck timeout: 300초
- Restart policy: Always
- 리소스 시작값: 0.5 vCPU / 1GB RAM

아래 변수만 API에 등록합니다. 실제 값은 Railway Variables 화면에만 입력합니다.

| 변수 | 값 |
| --- | --- |
| `MEDIA_STORAGE_PROVIDER` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | 기존 Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 동일 프로젝트 anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | 동일 프로젝트 service role key — API에만 등록 |
| `CORS_ALLOWED_ORIGINS` | 실제 프론트 origin. 예: `https://posttalk.vercel.app` |
| `INTERNAL_WORKER_API_KEY` | 워커를 만들 때만 32자 이상 무작위 값 등록 |
| `EXHIBITION_MODE_ENABLED` | 초기에는 `false` |
| `EXHIBITION_PUBLISH_SECRET` | 새 32자 이상 무작위 값 |
| `GENERATION_WORKER_ENABLED` | `false` |

`PORT`는 Railway가 자동 제공하므로 직접 고정하지 않습니다. `NEXT_PUBLIC_APP_URL`도 비워 두면 서버가 Railway public domain을 기준으로 URL을 계산합니다.

### 선택: 워커 — `postalk-recovery`

- Builder: Dockerfile
- Dockerfile 경로: `Dockerfile.worker` (`RAILWAY_DOCKERFILE_PATH=Dockerfile.worker`로 지정)
- Public Domain: 만들지 않음
- Restart policy: Always
- 리소스 시작값: 0.25 vCPU / 0.5GB RAM

워커 변수는 아래 세 개입니다.

| 변수 | 값 |
| --- | --- |
| `GENERATION_WORKER_BASE_URL` | Railway가 표시한 API private domain에 `:3000`을 붙인 주소 |
| `INTERNAL_WORKER_API_KEY` | API와 **정확히 같은 값** |
| `GENERATION_WORKER_ENABLED` | 초기에는 `false` |

Railway의 private domain은 서비스 간 통신용이며 외부에 공개하지 않습니다. API가 기본적으로 3000 포트를 수신하므로 워커 주소에 `:3000`을 붙입니다.

## 배포와 검증

1. GitHub Actions가 성공한 `main` 커밋인지 확인합니다.
2. Railway API가 `main`을 Source Branch로 사용하고 있는지 확인합니다.
3. public domain의 `/api/health`가 200인지 확인합니다. Supabase 변수 등록 후에는 `/api/health/ready`도 확인합니다. 이 readiness 경로는 데이터를 만들지 않고 DB 읽기와 Supabase `uploads` 버킷 확인만 수행하며, 정상일 때 `database: "ok"`, `storage: "ok"`를 응답합니다.
4. 프론트 `NEXT_PUBLIC_API_BASE_URL`을 API public domain으로 설정하고 프론트를 재배포합니다.
5. `CORS_ALLOWED_ORIGINS`에 정확한 프론트 origin만 넣고, 로그인·목록·자막·업로드를 확인합니다.
6. 사진 10MiB와 영상 50MiB 이하를 실제로 올려 Supabase Storage·Railway 업로드 경로를 확인합니다.
7. 카드뉴스와 **무음 자막 릴스**을 각 1건 만들어 확인합니다. 이 단계까지 `GENERATION_WORKER_ENABLED=false`를 유지합니다.
8. 상인이 직접 누르는 Instagram 게시 동작은 별도 리허설에서 1건 확인합니다.

`SUPABASE_SERVICE_ROLE_KEY`를 Railway에 등록하면 Railway API 컨테이너가 DB·Storage 서버 작업을 수행할 수 있습니다. 이 키를 실제로 입력하기 직전에, 값과 목적지를 확인한 뒤에만 등록합니다.

## 행사 종료

결과·원본 파일이 Supabase에 남아 있는지 확인한 뒤 Railway의 API와 워커를 stop 또는 delete합니다. Railway Usage에서 컴퓨트 사용량이 증가하지 않는 것을 확인합니다. Supabase Pro 하향은 7일 백업과 파일 보관이 더 필요 없는 시점에 별도로 판단합니다.
