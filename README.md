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
