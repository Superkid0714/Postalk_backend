# Supabase 실제 적용 기록 — 2026-11-03 KST

> 이 문서는 2026-11-03 작업 기록입니다. 현재 운영은 Supabase Pro를 사용하며, Railway 준비 상태 확인 API에서 DB와 Storage 연결을 확인합니다.

## 대상과 결정

- 대상: 기존 `Superkid0714's Project`, ref `dcxyfbnzappvxxkgmcyo`
- 사용자가 적용 대상 판단을 위임하여, 기존 프로젝트를 Resume하고 기존 데이터를 보존하는 업그레이드를 선택했습니다.
- 당시에는 별도 프로젝트 생성, Pro 결제, 컴퓨트 변경을 하지 않았습니다. 이후 운영 계획에 따라 Supabase Pro로 전환했습니다.
- 기존 `.env`와 동일한 프로젝트이며 `.env` 및 실제 키는 수정·커밋하지 않았습니다.

## DB 변경

기존 스키마에 위치 필드와 영상 촬영 종류를 먼저 추가하고, 운영 문서에 나열한 8개 후속 마이그레이션을 하나의 트랜잭션으로 실행했습니다. 테이블 잠금과 최근 생성 작업 가드, 실행 전후 행 수 비교를 포함했습니다. SQL Editor 결과는 `UPGRADE_OK: original row counts preserved`입니다.

이전 영상 제약조건을 찾는 코드가 `IN` 문자열을 비교하던 오류를 수정했습니다. PostgreSQL은 이를 `= ANY(...)`로 출력하므로, 이제 실제 컬럼을 참조하는 CHECK 제약조건을 식별합니다. 같은 선행 변경을 두 번 실행하는 회귀 검증도 통과했습니다.

- 앱 테이블 22개와 기존 미사용 레거시 테이블 5개를 유지하여 총 27개입니다. 레거시 5개는 `ai_jobs`, `uploads`, `insight_snapshots`, `posts`, `publish_logs`입니다.
- 27개 모두 RLS 적용, 익명 클라이언트의 테이블 직접 접근 권한은 0개입니다. 서버 service role로 접근합니다.
- 사용자 행이 0개임을 확인하고 `users.role` 제약을 seller 전용으로 맞췄습니다. 비판매자 사용자가 있으면 업그레이드 묶음은 중단합니다.
- 기존 검수 상태 61개의 이전 상태와 이전 수정 시각을 `ai_metadata.merchantWorkflowMigration`에 기록했습니다.
- 검수 승인만으로 게시 완료로 간주하지 않습니다. 기존 Instagram 게시 ID 또는 게시 시각이 있는 7개만 published, 나머지 54개는 draft입니다.
- 7일 이상 멈춘 생성 작업 2개는 failed로 전환하고 기존 상태·실패 사유·시각을 `result_payload.legacyRecoveryState`에 보존했습니다. 공급자 작업 정보와 요청 내용은 유지하며 자동 재호출하지 않습니다.
- 기존 검수 메모와 이전 컬럼, 실제 미디어 파일은 삭제하지 않았습니다. ERD의 현재 앱 모델에는 미사용 레거시 5개를 별도로 추가하지 않았습니다.

### 기존 행 수 보존

| 테이블 | 전 / 후 |
| --- | ---: |
| stores | 8 / 8 |
| ad_creation_sessions | 101 / 101 |
| ad_creation_session_assets | 284 / 284 |
| submissions | 61 / 61 |
| submission_assets | 292 / 292 |
| generation_jobs | 67 / 67 |
| merchant_qr_tokens | 6 / 6 |
| qr_entry_slots | 1 / 1 |
| users 및 레거시 5개 | 각각 0 / 0 |

전체 행 백업은 만들지 않았습니다. 자동 승인 검토가 개인정보를 포함할 수 있는 전체 행의 로컬 추출을 거절하여 해당 작업은 실행되지 않았습니다. 대신 스키마·HEAD 행 수·버킷 설정만 점검했고, 이전 기술 상태는 같은 DB 안에 기록했습니다. 이 기록은 전체 백업이나 시점 복구 기능을 대체하지 않습니다.

## Storage 변경과 실제 검증

기존 `uploads` 버킷을 그대로 유지하고 아래 설정만 변경했습니다. S3 이전이나 기존 객체 복사는 하지 않았습니다.

| 설정 | 적용값 |
| --- | --- |
| 공개 여부 | private (`public=false`) |
| 버킷 파일 상한 | 52,428,800 bytes = 50 MiB |
| 이미지 MIME | image/jpeg, image/png, image/webp |
| 영상 MIME | video/mp4, video/quicktime, video/webm |
| 앱 업로드 제한 | 사진 10 MiB / 영상 50 MiB / 요청 52 MiB |

직접 만든 작은 PNG 하나만 고유한 임시 경로에 업로드했습니다. 서버 인증 다운로드와 60초 서명 URL 다운로드 모두 원본 바이트와 일치했으며, 공개 URL 접근은 차단됐습니다. 해당 테스트 파일 하나만 정리했습니다. 기존 파일을 열거나 다운로드하지 않았습니다.

이번 왕복 검증은 작은 파일의 연결·권한 검증입니다. 50MiB 파일 전송 성능, 동시 행사 부하 및 프로젝트 전체 업로드 한도의 변경은 별도 검증 항목입니다. 버킷 제한과 별개로 Supabase 프로젝트 상한, 실제 배포 서버의 요청 제한도 적용됩니다.

## 검증 결과

- 실제 DB: 22개 앱 테이블의 RLS·서버 권한, 호환 뷰 3개, 필수 RPC 8개, 중복 실행 방지 인덱스 확인
- 실제 DB: 제작 요청의 멱등성, 세션·장면·미디어·생성 작업 연결, 캡션 수정, soft delete 통과
- 실제 DB 검증용 가게·제작 데이터는 모두 같은 트랜잭션에서 ROLLBACK
- REST HEAD: 기존 14개 테이블 행 수 재확인; 가게·QR·contents·media_assets·호환 뷰·레거시 표본의 익명 접근 401 확인
- 실제 Storage: 업로드·인증/서명 다운로드·공개 접근 차단·테스트 파일 정리 통과
- 로컬: 전체 147개 테스트, TypeScript 검사, ESLint 통과. 후속 재실행 가드를 추가한 업그레이드 회귀 테스트도 통과
- 외부 AI, Instagram 게시 요청은 실행하지 않음 (TTS는 제품 범위에서 제거됨)

검증용 메타데이터·실행 SQL·화면 캡처는 로컬 ignored `tmp/supabase-deploy`에만 두었습니다. 키·서명 URL·실제 행 내용은 이 문서나 커밋에 포함하지 않습니다.

## 재현 및 후속 운영

`supabase/operations/build-existing-upgrade.mjs`는 이번과 같은 구형 스키마 전용 SQL을 생성합니다. 이미 `contents`가 있는 업그레이드된 DB에는 재실행을 거절합니다. 현 프로젝트에는 다시 실행하지 마세요. 신규 DB에는 전체 `supabase/schema.sql`, 기존 업그레이드 완료 DB에는 이후 변경분만 적용합니다.

`supabase/operations/configure-existing-storage.sql`은 기존 private 버킷의 제한만 조정합니다. 신규 버킷 생성용 `supabase/staging/03-private-storage.sql`과 구분합니다. DB 제작 검증은 `supabase/staging/02-verify.sql`을 사용하며 외부 호출 없이 임시 데이터가 롤백됩니다.

다음 작업은 사용자의 Pro 업그레이드 완료 확인, 실제 배포 서버의 업로드·FFmpeg 실행 환경 확인, 프론트 전체 흐름 연결 검증입니다. 별도 테스트 프로젝트도 아직 없습니다. 팀에서 제공할 최종 콘셉트 3종과 실제 릴스·디자인 AI 규격이 확정되면 연결 후 무음 자막 릴스 결과를 확인해야 합니다. Instagram은 상인이 게시 버튼을 누르는 흐름으로 별도 검증합니다.
