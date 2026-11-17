# 2026-11-18 실제 Instagram 게시 검증

## 범위

사용자가 실제 게시까지 검증하도록 요청한 뒤 운영 웹페이지의 API 프록시(`https://posttalk.vercel.app/api`)를 통해 테스트 콘텐츠를 게시했습니다. 두 게시물의 캡션에는 서비스 검증용이며 실제 판매·주문 안내가 아니라는 문구를 명시했습니다.

| 항목 | 릴스 | 카드뉴스 |
| --- | --- | --- |
| 실제 게시 링크 | [크리스마스 쿠키 릴스](https://www.instagram.com/reel/Df3HwNGHPDk/) | [카드뉴스 캐러셀](https://www.instagram.com/p/Df3H8vvk3JX/) |
| 형식 | VIDEO / REELS | CAROUSEL_ALBUM |
| media ID | 18033472769879392 | 18427073566153410 |
| 콘텐츠 | AI 이미지 기반 쿠키, 16초 1080×1920 MP4·오디오·자막 | 사진 6장으로 생성한 1080×1350 PNG 4장 |
| 게시 완료 확인 시간 | 약 51초 | 약 41초 |
| 보관함 상태 | published 및 permalink 일치 | published 및 permalink 일치 |
| 반복 게시 요청 | 동일 media ID, 중복 생성 없음 | 동일 media ID, 중복 생성 없음 |

## 검증 방법

1. 생성 결과 파일과 보관함을 확인한 뒤 `POST /api/submissions/:id/publish`를 호출했습니다.
2. 릴스 최초 응답의 409 INSTAGRAM_PROCESSING은 완료로 취급하지 않고 같은 광고를 재조회·확인했습니다. published 및 media ID·permalink가 확인된 시점에 성공으로 처리했습니다.
3. 저장된 게시 상태 조회와 게시 요청 재호출에서 동일한 media ID를 확인했습니다.
4. Instagram 원본 API에서도 각 media ID·permalink·캡션이 일치하는지 확인했습니다.
5. 카드뉴스의 자식 미디어 4개가 모두 IMAGE이고 서로 다른 ID인지 확인했습니다.
6. 릴스 thumbnail_url의 실제 JPEG를 읽어 중앙 밝기 약 102.6/255를 확인했습니다. 검은 시작 프레임이 아니라 생성된 쿠키 표지가 적용됐습니다.
7. 연결된 계정의 미디어 목록에 각 게시물이 한 번씩 있는지 확인했습니다.

게스트 키, 내부 키, 토큰과 서명 URL은 기록하지 않았습니다. 이번 검증은 실제 API·게시 결과를 대상으로 했으며, 브라우저 버튼 조작이나 Instagram 앱의 모든 화면 배치는 검증하지 않았습니다. 게시물을 별도로 삭제하거나 수정하면 링크·시각적 결과는 달라질 수 있습니다.

## 관련 운영 설정

- 생성 복구 워커는 활성화되어 있습니다.
- Instagram 자동 게시 복구는 비활성화되어 있습니다. 위 두 건은 명시적 게시 API 호출로 게시했습니다.
- 프론트 상세 영상의 재생 전 표시는 thumbnailUrl을 video.poster로 연결해야 합니다. Instagram 게시 표지 전달과는 별도 화면 처리입니다.
