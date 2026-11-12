# 2. ERD / 데이터 구조

팀 공유에는 [팀 제작 흐름 ERD](../erd/team-workflow.dbml)를 사용합니다. 파일 내용을 [dbdiagram.io](https://dbdiagram.io)에 붙여 넣으면 다이어그램으로 볼 수 있습니다.

```text
stores
 ├─ ad_creation_sessions
 │   └─ ad_creation_session_assets
 ├─ submissions
 │   └─ generation_jobs
 │       └─ submission_assets
 └─ merchant_qr_tokens
```

| 테이블 | 담당 역할 |
| --- | --- |
| `stores` | 상인 가게 또는 게스트 작업 공간 |
| `ad_creation_sessions` | 제작 화면 1회에 대응하는 세션 |
| `ad_creation_session_assets` | 업로드한 원본 사진·영상의 Storage 경로 |
| `submissions` | 보관함과 게시의 기준 콘텐츠 |
| `generation_jobs` | 카드뉴스·릴스 생성 상태와 결과 경로 |
| `submission_assets` | 생성된 PNG, MP4, 썸네일 |

전체 SQL 구조와 호환 테이블은 [전체 ERD](../erd/current.dbml)를 참고합니다.
