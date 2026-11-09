# POSTALK Backend

전통시장 상인이 사진·영상으로 카드뉴스와 무음 자막 릴스를 만들고, 원할 때 직접 Instagram에 게시하는 백엔드입니다.

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
- 릴스: 음성·배경음악 없는 자막 MP4

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

## 상인 API 원칙

상인 요청에는 활성화된 QR 토큰이 필요합니다.

```http
x-merchant-qr-token: <activated-qr-token>
```

가게 ID나 상호명은 인증 수단이 아닙니다. 서비스 역할 키, Instagram 토큰, 워커 키는 프론트에 전달하지 않습니다.

```text
QR 진입 → 파일 업로드 → 광고 생성 → 작업 상태 확인 → 보관함 → 상인 직접 게시
```

사진은 최대 10MiB, 영상은 최대 50MiB입니다.

## 개발

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
- [AWS 이전 참고](docs/AWS_MEDIA_MIGRATION.md)
- [Supabase 적용 기록](docs/SUPABASE_DEPLOYMENT_20261103.md)
- [변경 기록](docs/CHANGELOG.md)
