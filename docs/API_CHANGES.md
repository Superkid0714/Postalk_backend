# 프론트엔드 API 변경

> 현재 운영 기준: 관리자는 사용하지 않습니다. 상인이 콘텐츠를 만들고 직접 게시합니다.

## 전시 업로드·대표 이미지 정책

- GET /api/exhibition/uploads?user_id=1: 사진/영상 MIME과 최대 바이트, multipart 전체 상한 조회.
- POST 파일 상한은 사진 10MiB·영상 50MiB로 통일했습니다. 기존 200MiB 검사는 프론트도 갱신해야 합니다.
- 413 크기 초과, 429 업로드 혼잡, 507 저장 한도, 503 저장소 연결 오류를 구분합니다. 제작 후 재업로드는 409입니다.
- 목록 thumbnailUrl이 null이면 기본 이미지를 사용합니다. 전체 카드/영상으로 대체 다운로드하지 않습니다.
- 전시 운영은 Supabase Pro DB/Storage를 사용합니다. 프론트 UI 구현 자체는 별도 저장소의 작업입니다.

## 전시 DB 구조 후속 변경

전시 API URL·입력·ID 규격은 유지하며 백엔드 테이블을 정규화했습니다.
새 코드를 배포할 때 20261102_z_normalized_workflow.sql까지 적용해야 합니다.
상세와 게시 응답에는 requiresVerification boolean이 추가됩니다. true이면 외부 게시 결과가 불확실하여
자동 재게시를 중단한 상태입니다. UI에서는 확인 중으로 표시하고 재게시를 유도하지 않습니다.
나머지 전시 계약은 [화면별 API 문서](EXHIBITION_API.md)를 따릅니다.

## 관리자 제거·상인 권한

`/api/admin/*`와 검수·승인·반려 API는 제거되었습니다.
상인 API는 해당 가게의 활성 QR 토큰만 인정하며 관리자·내부 워커 키로 우회하지 않습니다.

```http
x-merchant-qr-token: <해당 가게의 activated QR 토큰>
```

uploads multipart와 submissions / photo-check JSON의 기존 qrToken 입력도 지원합니다.
그 외 조회·생성·게시 요청은 헤더를 사용하세요. 가게 UUID와 이름은 인증 정보가 아닙니다.

## 파일 응답

업로드의 bucket 값은 Supabase의 `uploads`입니다.
응답의 bucket과 filePath를 그대로 다음 요청에 전달하세요. 클라이언트에서 고정하거나 가공하지 않습니다.
서명 URL은 만료되므로 영구 주소로 저장하지 말고 조회 API에서 갱신합니다.

## 상태와 집계

| 항목 | 현재 값 |
| --- | --- |
| 접수 상태 | draft, published |
| 홈 집계 | draftCount, publishedCount, totalCount |
| 보관함 상태 필터 | all, draft, published |
| 보관함 집계 | all, draft, published |
| 생성 작업 상태 | queued, processing, completed, failed |

published는 실제 Instagram 게시 성공이 기록된 상태입니다. 이전 승인을 게시 완료로 취급하지 않습니다.
홈의 attentionItems는 보관 중인 항목이며 승인 대기·반려 의미가 없습니다.
사진 보관함에는 생성 이미지가 있는 접수만, 영상 보관함에는 생성 영상이 있는 접수만 표시합니다.

## 게시 버튼

생성·조회만으로 자동 게시하지 않습니다. 상인이 게시 버튼을 누를 때만 호출합니다.

```http
POST /api/submissions/:id/instagram-publish
Content-Type: application/json
x-merchant-qr-token: ...

{ "mediaType": "photo", "captionOverride": "선택적 홍보 문구" }
```

기존 POST /api/publish-requests와 POST /api/video-publish-requests도 submissionId JSON으로 직접 게시를 시작합니다.
진행 중이면 202, 이미 게시되었으면 200입니다. 동시에 처리 중인 게시에는 409, 외부 게시 실패에는 502를 반환합니다.

- GET /api/submissions/:id/instagram-publish: 저장된 게시 상태 조회
- GET /api/submissions/:id/instagram-metrics: 저장된 성과 조회
- POST /api/submissions/:id/instagram-metrics: 외부 성과 새로 조회

게시 진행은 내부 워커가 확인하며 GET 자체는 외부 게시를 실행하지 않습니다.

## 오류 처리

| 상태 | 대응 |
| --- | --- |
| 400 | 입력 타입·필수 항목·파일 경로 확인 |
| 401 | 활성 QR 토큰 확인 |
| 403 | 본인 가게 자료인지 확인 |
| 404 | 자료 없음 또는 제거된 API |
| 409 | 생성·게시 진행 상태 조회 후 재시도 판단 |
| 502 / 503 | 외부 서비스·저장소·서버 설정 확인 |

aiMetadata에 adWorkflow, videoWorkflow, instagramPublish, instagramMetrics를 전달할 수 없습니다.
미완성 생성물과 이미지가 누락된 카드뉴스는 게시할 수 없습니다.
