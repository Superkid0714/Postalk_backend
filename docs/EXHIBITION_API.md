# 전시 화면 SC-00~09 백엔드 연동

전달받은 화면 명세를 위한 `/api/exhibition` API입니다. 이 저장소에는 별도 프론트엔드의 화면·Context·카메라 구현이 없습니다.
기존 QR 기반 상인 API는 유지하며 전시 API만 명시적으로 켭니다.
프론트엔드의 고정 로그인 1234/1234, localStorage 로그인 유지, 제작 Context 메모리 보관은 프론트엔드 담당입니다.
백엔드의 user_id=1은 공용 전시 사용자 식별값이며 일반 서비스의 인증 수단이 아닙니다.

## 켜기

기존 DB는 OPERATIONS.md의 1~8번 SQL을 순서대로 적용합니다. 정규화·서버 권한 SQL까지 필요합니다.
신규 `schema.sql`에는 포함되어 있습니다. 실제 운영 DB에 자동 적용하지 않습니다.

```dotenv
EXHIBITION_MODE_ENABLED=true
EXHIBITION_STORE_ID=<등록된 stores.id UUID>
EXHIBITION_PUBLISH_SECRET=<충분히 무작위인 32자 이상의 서버 전용 값>
EXHIBITION_SCRIPT_MODEL=gpt-4.1-mini
```

게시 비밀 값은 프론트엔드에 전달하지 않으며 전시 중에는 유지합니다.
꺼져 있으면 전시 API는 404입니다. 기존 상인 API의 QR 검증을 user_id=1로 우회할 수 없습니다.
user_id는 JSON·multipart의 `user_id: 1`, 쿼리 `?user_id=1`, 또는 `x-user-id: 1`로 전달합니다.
여러 곳에 전달하면 모든 값이 1이어야 합니다. GET에는 쿼리 또는 헤더를 사용합니다.

## 화면별 API

| 화면 | API |
| --- | --- |
| SC-00 | 로그인 API 없음, 프론트 고정 계정 검증 |
| SC-01 | GET /api/exhibition/me, GET /api/exhibition/ads?page=1&pageSize=4 |
| SC-02 | 콘셉트·예시·장면 구성은 프론트 담당자가 제공 |
| SC-03 | GET/POST /api/exhibition/templates, POST /api/exhibition/script-jobs (자막 릴스만) |
| SC-04·05 | 파일은 Context 메모리 보관. 장면별 서버 업로드·검수 요구 없음 |
| SC-06 | GET /api/exhibition/script-jobs/:jobId, 실패 시 같은 입력으로 POST 재요청 |
| SC-07 | POST /api/exhibition/uploads → POST /api/exhibition/generations → GET /api/exhibition/generations/:jobId |
| SC-08 | GET/PATCH/DELETE /api/exhibition/ads/:adId, POST /api/exhibition/ads/:adId/publish |
| SC-09 | GET /api/exhibition/ads?format=all&publishStatus=all&page=1&pageSize=20 |

응답은 기존과 같은 `{ success, message, data }` 구조입니다. 오류 메시지는 화면에 안내할 수 있는 한국어입니다.

## Context와 제작 식별값

제작을 시작할 때 `crypto.randomUUID()`로 `creationId`를 한 번 발급하고 Context에 보관합니다.
뒤로 이동해도 같은 입력이면 유지합니다. 정보·콘셉트·장면 정의가 달라지면 새 creationId를 사용합니다.
식별값만 바꾸는 경우에도 이전 입력과 유효한 촬영 파일을 불필요하게 지울 필요는 없습니다.
메뉴가 삭제되어 더 이상 대응하지 않는 장면·대본은 프론트에서 다시 맞춰 주세요.
SC-03에서 요청한 이전 대본이 늦게 도착하면 당시 creationId를 비교해 현재 제작에 덮어쓰지 않습니다.

생성 요청이 같은 creationId·입력·재료·자막으로 반복되면 같은 adId/jobId를 반환합니다.
같은 creationId에 다른 입력을 보내면 409입니다. 네트워크 실패 시 동일 요청을 다시 보낼 수 있습니다.
제작 중간 새로고침 복구는 요구하지 않으며 메모리 Context가 없으면 프론트에서 홈으로 보냅니다.

## 입력·장면 계약

아래는 호출 형식 예시이며 확정된 콘셉트 이름이나 실제 촬영 구성은 아닙니다.
작업 중인 3종 콘셉트를 서버에서 임의로 만들지 않았습니다.
프론트 담당자의 장면 정의에 메뉴 수를 적용한 **최종 장면 배열**을 전달합니다.

```json
{
  "user_id": 1,
  "creationId": "11111111-1111-4111-8111-111111111111",
  "format": "reels",
  "conceptId": "<실제 콘셉트 ID>",
  "conceptDescription": "<선택적인 콘셉트 설명>",
  "storeDescription": "가게 소개",
  "menus": [{ "id": "menu-1", "name": "메뉴 이름", "description": "메뉴 설명" }],
  "template": {
    "id": "<실제 장면 템플릿 ID>", "version": "1",
    "renderer": "scene-reel-v1", "usesSubtitles": true, "maxSubtitleChars": 40,
    "scenes": [
      { "sceneNumber": 1, "target": "가게", "menuId": null, "mediaType": "image", "durationSeconds": 3 },
      { "sceneNumber": 2, "target": "대표 메뉴", "menuId": "menu-1", "mediaType": "video", "durationSeconds": 3 }
    ]
  }
}
```

- 형식은 card_news / reels, 메뉴는 1~3개이며 id가 중복되면 안 됩니다.
- 장면 번호는 1부터 순서대로이며 1~20개입니다. 연결한 menuId가 메뉴 목록에 있어야 합니다.
- 장면 길이는 1~15초입니다. 영상 재료의 실제 길이가 이보다 짧으면 생성 요청을 거절합니다.
- 카드뉴스 장면은 image만 받으며 usesSubtitles는 false입니다.
- 기본 장면별 자막 제한은 40자이며 템플릿에서 1~100자로 지정할 수 있습니다.
- 대본 요청은 이 입력을 그대로 받습니다. 자막을 쓰지 않는 템플릿에서는 호출하지 않습니다.
- SC-03의 저장 템플릿은 name/storeDescription/menus를 저장하는 **정보 템플릿**입니다.
  POST는 항상 새 templateId를 만들어 불러온 원본을 덮어쓰지 않습니다.
  위 template.id는 별개의 **촬영·렌더링 템플릿 ID**입니다.

현재 렌더러는 source-photo-v1(카드뉴스 공통 사진·텍스트 레이아웃), scene-reel-v1(장면 기반 릴스)입니다.
콘셉트별 최종 카드 시각 디자인은 다른 담당자의 정의를 받은 뒤 연결할 부분입니다.
지원하지 않는 renderer를 지정하면 조용히 다른 디자인을 만드는 대신 TEMPLATE_NOT_CONNECTED를 반환합니다.

## 재료 일괄 업로드와 생성

SC-07에서 각 재료를 multipart로 업로드합니다.
필드: user_id, creationId, sceneNumber, menuId(가게 장면은 생략), file.
사진 JPEG/PNG/WebP는 10MiB, 영상 MP4/QuickTime/WebM은 50MiB까지 받습니다. 한 요청에 file은 하나만 전달합니다.
multipart 전체는 최대 52MiB이며 Content-Length가 없어도 실제 수신 바이트를 제한합니다.
배포 호스팅·프록시와 Supabase 프로젝트/버킷 상한이 더 작으면 그 제한도 적용되므로 리허설에서 확인해야 합니다.
서버가 실제 미디어와 영상 길이를 확인합니다. 실패한 재료만 다시 전송하면 됩니다.
같은 제작의 같은 장면 재업로드는 최신 assetId로 교체합니다. 생성 요청 후에는 재료 교체를 막습니다.
생성을 시작한 뒤 장면을 수정하려면 새 creationId로 제작을 시작합니다.

SC-01 또는 SC-02에서 GET /api/exhibition/uploads?user_id=1로 한 번 정책을 읽고 Context에 보관할 수 있습니다.
응답 data: `{image:{maxBytes:10485760,mimeTypes:[...]},video:{maxBytes:52428800,mimeTypes:[...]},maxRequestBytes:54525952}`.
SC-04 촬영 중 장면별 업로드를 요구하지 않는 기존 흐름은 유지합니다.
프론트의 기존 200MiB 영상 제한을 50MiB로 변경하고 파일 선택 단계에서도 안내합니다.
업로드 오류는 413 PAYLOAD_TOO_LARGE, 429 UPLOAD_BUSY, 507 STORAGE_QUOTA_EXCEEDED, 503 STORAGE_UNAVAILABLE로 구분합니다.
507은 재시도를 반복하지 말고 현장 담당자에게 알립니다. 제작 시작 상태는 저장 전 409로 거절합니다.
사전 확인 이후의 경합도 등록 RPC에서 다시 검사합니다. 외부 업로드 후 DB 통신 실패 시 실제 객체가 남을 수 있으며
등록 성공 여부가 불확실한 파일을 자동 삭제하지 않습니다. 서버 로그와 실제 Storage 사용량을 함께 확인합니다.

생성 요청에는 위 공통 입력과 다음 필드를 추가합니다.

```json
{
  "materials": [{ "sceneNumber": 1, "assetId": "<업로드 응답 UUID>" }],
  "subtitles": [{ "sceneNumber": 1, "text": "직접 확인한 문장" }]
}
```

예시는 필드 모양만 나타내며 실제로는 모든 장면에 대응하는 재료·자막을 순서대로 전달해야 합니다.
자막 없는 템플릿에서는 subtitles를 생략하거나 빈 배열로 보냅니다.
생성 응답: adId, jobId, creationToken, reused. HTTP 202이며 이후 작업 상태를 폴링합니다.
작업 상태: queued / processing / completed / failed.
progress에는 stage, current, total, message가 있습니다. 준비·렌더링·저장·완료·실패를 안내합니다.
완료 응답의 adId로 프론트에서 replace 이동합니다.
실패한 생성은 현재 Context의 권한으로 POST /api/exhibition/ads/:adId/retry를 호출할 수 있습니다.

## 자막·음악

SC-06에서 수정한 문장은 화면 자막으로만 사용합니다.
릴스는 서버에서 720×1280으로 정규화하며, 영상 원본의 오디오·배경음악과 음성 합성은 넣지 않는 무음 MP4를 만듭니다.
자막이 있는 템플릿은 지정된 장면 길이를 유지하며, 부족한 영상은 반복합니다.

## 공용 계정의 게시·캡션·삭제

creationToken은 생성 응답에서만 주고 목록·상세·작업 조회에는 포함하지 않습니다.
전시 테이블과 원본 작업·접수·첨부 테이블은 공개 Supabase 키의 직접 읽기·쓰기를 막고 서버 API로만 접근합니다.
Context 메모리에만 보관하며 localStorage나 URL에 넣지 마세요.
게시와 생성 재시도에는 x-creation-token 헤더가 필요합니다. 보관함에서 광고 ID만 알아도 게시할 수 없습니다.
상세 GET에 이 헤더를 전달하면 canPublish를 계산합니다. 보관함 진입에는 false입니다.
캡션 PATCH는 `{user_id:1,caption:"..."}`이며 2,200자·해시태그 30개를 서버도 확인합니다.
게시 중·게시 완료 또는 제작 미완료 상태에서는 캡션 수정이 409입니다.
게시 요청은 현재 캡션을 사용하며 자동 게시하지 않습니다. 게시 상태는 unpublished/publishing/published/failed입니다.

삭제는 공용 전시 사용자의 보관함 숨김입니다. 처리 중인 게시가 있으면 409이며 완료 후 다시 시도합니다.
원본·결과 파일과 DB 기록을 지우거나 실제 Instagram 게시물을 삭제하지 않습니다.
삭제 광고의 대기 작업은 취소하고 실행 중인 생성은 다음 상태 확인에서 중단합니다.
캡션 수정·삭제는 공용 사용자 범위이며 관람객별 계정 분리는 없습니다.

## 홈·목록·상세

GET /ads의 format은 all/card_news/reels, publishStatus는 all/unpublished/publishing/published/failed입니다.
page는 1부터, pageSize는 1~50입니다. 홈에서는 pageSize=4를 사용합니다.
응답: items, page, pageSize, total, totalAll, hasNext. emptyReason은 no_ads(전체가 비어 있음), no_matches(필터 결과 없음) 또는 null입니다.
최신 생성 시각과 ID 순으로 정렬하고 삭제 광고는 제외합니다.
항목: adId, format, conceptId, title, publishStatus, generationStatus, thumbnailUrl, createdAt.
목록에는 완성된 작업의 작은 JPEG 대표 이미지만 사용합니다. 카드뉴스는 360×450, 릴스는 360×640입니다.
제작 중이거나 대표 이미지가 없는 옛 결과는 thumbnailUrl이 null입니다. 프론트는 기본 이미지를 표시합니다.
썸네일이 없다는 이유로 목록에서 전체 카드나 영상 원본을 대신 다운로드하지 않습니다.
상세: resultUrls, caption, permalink, progress, canPublish 등. 결과 URL은 브라우저에서 바로 여는 서명 URL입니다.
URL은 만료되므로 재조회할 수 있어야 합니다. 카드뉴스 저장은 현재 장의 resultUrls[index]를 사용합니다.
목록 필터·스크롤 복구와 메뉴 숨김, 새로고침 가드, 버튼 중복 방지는 프론트에서 처리합니다.

## 구현된 DB 구조와 외부 모듈 연결

정규화 SQL 적용 후 실제 테이블은 input_templates / script_jobs / contents이며
이전 exhibition_* 세 이름은 동일 데이터의 호환 뷰입니다. API URL과 생성·대본·광고 ID는 바꾸지 않습니다.
creation_sessions는 생성 전 작업을 묶고 creation_scenes에는 장면별 최종 자막을 저장합니다.
concept_versions는 전달받은 템플릿의 불변 스냅샷이며 동적 메뉴/장면 변형은 정의 해시로 구분합니다.
media_assets는 Supabase/S3 객체 위치·크기·알려진 해시를 관리하고 content_outputs는 결과 순서와 용도를 연결합니다.
publication_attempts에는 명시적 게시 시도와 확정 실패·성공·결과 불확실 상태가 남습니다.
전체 구현 ERD는 docs/erd/current.dbml, 협업용 부분 ERD는 docs/erd/workflow.dbml입니다.

프론트는 상세/게시 응답의 requiresVerification=true인 경우 재게시를 유도하지 않고 결과 확인 상태를 표시합니다.
생성 완료는 게시 요청을 만들지 않습니다. 기존 creationToken 규칙도 그대로 적용합니다.

외부 릴스/디자인 담당자는 최종 conceptId, template.id/version, renderer, scenes의 순서·입력 종류·길이,
usesSubtitles와 maxSubtitleChars를 전달해야 합니다. 메뉴별 장면과 편집 자막은 생성 요청 스냅샷에 고정됩니다.
현재 지원 renderer는 source-photo-v1 / scene-reel-v1이며 새 renderer는 명시적 구현 후 허용해야 합니다.
최종 콘셉트 3종은 외부 담당자의 정의를 받은 뒤 연결합니다. TTS는 사용하지 않습니다.

Supabase DB와 Storage를 기본으로 유지합니다. 목록에는 작은 썸네일을 사용하고 원본 영상은 상세에서 요청합니다.
AWS는 선택 가능한 저장소 어댑터이며 실제 이전은 수행하지 않습니다. 파일 보존 정책 미확정으로 자동 삭제하지 않습니다.
