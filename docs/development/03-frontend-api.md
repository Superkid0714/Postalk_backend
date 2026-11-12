# 3. 프론트엔드 API 명세

운영 API 주소는 `https://postalkbackend-production.up.railway.app`입니다. 성공 응답은 `success`, `message`, `data` 구조를 사용합니다.

## 인증

- 게스트 제작: `x-guest-session` 헤더와 `storeId`
- 기존 상인 기능: `x-merchant-qr-token` 헤더
- 게스트는 Instagram 게시와 성과 조회를 호출하지 않습니다.

## 화면별 API

| 화면 | API | 비고 |
| --- | --- | --- |
| 첫 진입 | `POST /api/guest-session` | `storeId`와 `canPublish` 반환 |
| 업로드 | `POST /api/uploads` | 응답의 `bucket`, `filePath`를 다음 단계에 그대로 사용 |
| 카드뉴스 시작 | `POST /api/ad-sessions/start` | `adType: "photo"`, `cardNewsTheme` |
| 카드뉴스 사진 제출 | `POST /api/ad-sessions/:sessionId/photos` | 6번째 사진에서 생성 시작 |
| 릴스 시작 | `POST /api/ad-sessions/start` | `adType: "video"`, `reelsConcept` |
| 릴스 영상 제출 | `POST /api/ad-sessions/:sessionId/videos` | 4번째 영상에서 생성 시작 |
| 진행 화면 | `GET /api/generation-jobs/:jobId/progress` | `percent`, `stage`, `failureReason` |
| 결과·보관함 | `GET /api/ad-sessions/:sessionId`, `GET /api/archive` | 서명 URL은 만료되므로 응답마다 사용 |
| 상인 게시 | `POST /api/submissions/:id/instagram-publish` | 게스트 화면에서는 숨김 |

요청·응답 예시와 오류 처리는 [API 변경 문서](../API_CHANGES.md)를 참고합니다.
