# 4. AI 서버 API 명세

프론트는 AI 서버를 직접 호출하지 않습니다. 백엔드가 Supabase Storage 서명 URL을 만들고 내부 API 키와 함께 요청합니다.

## 카드뉴스 서버

| 경로 | 설명 |
| --- | --- |
| `GET /healthz` | 상태 확인 |
| `POST /cardnews/renders` | 사진 6장으로 PNG 3장 생성 |

- 테마: `minimal`, `christmas`
- 인증 헤더: `x-cardnews-api-key`
- 상세 계약: [카드뉴스 README](https://github.com/Superkid0714/postalk-cardnews/blob/main/README.md)

## 릴스 서버

| 경로 | 설명 |
| --- | --- |
| `GET /healthz` | 상태 확인 |
| `GET /reels/templates` | 콘셉트와 장면 규칙 조회 |
| `POST /reels/renders` | 릴스 생성 시작 |
| `GET /reels/renders/:renderId` | 생성 상태와 결과 조회 |

- 콘셉트: `simple`, `christmas`
- 인증 헤더: `x-reels-api-key`
- 상세 계약: [릴스 README](https://github.com/Superkid0714/postalk_reels_pipeline/blob/main/README.md)

두 서비스 모두 Storage의 원본 파일을 내려받아 결과를 같은 Storage에 저장합니다. 내부 API 키와 서명 URL은 프론트에 전달하지 않습니다.
