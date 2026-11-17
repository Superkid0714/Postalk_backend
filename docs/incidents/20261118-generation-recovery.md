# 2026-11-18 생성 작업 자동 복구 적용

## 적용

- 같은 Railway production 환경에 `postalk-recovery` 서비스를 추가했습니다. 백엔드 저장소 main과 `Dockerfile.worker`를 사용하며 공개 도메인은 없습니다.
- API와 워커에 전용 내부 인증 키를 연결했습니다. 워커는 API 키를 Railway 변수 참조로 받으며 Supabase 서비스 키나 AI 공급자 키를 받지 않습니다.
- 워커에서 `GENERATION_WORKER_ENABLED=true`를 명시해야 작동합니다. 20초마다 내부 복구 API를 호출하고 첫 성공 및 작업 처리 결과를 로그에 기록합니다. 잘못된 응답도 연결 실패로 처리합니다.
- API의 `GENERATION_WORKER_SYNC_INSTAGRAM_ENABLED=false`로 생성 복구와 게시 동기화를 분리했습니다.

## 발견·해결한 내부 연결 오류

이전 배포 문서의 내부 포트 3000과 실제 API 수신 포트가 달랐습니다. 워커 로그에서 내부 DNS의 IPv4·IPv6 연결이 3000에서 거절되는 것을 확인했고, API 시작 로그의 `0.0.0.0:8080` 및 Railway 도메인 targetPort 8080을 대조했습니다.

워커의 주소를 `${{Postalk_backend.RAILWAY_PRIVATE_DOMAIN}}:8080`으로 수정한 후 내부 API 호출이 성공했습니다. 일시적 NODE_DEBUG=net 진단은 종료했습니다.

## 검증

- 백엔드 전체 테스트 182개, TypeScript 검사, ESLint 통과.
- 잘못된 워커 키로 운영 복구 API 호출 시 HTTP 401.
- 기존 QA 자료만 사용한 별도 작업으로 실제 워커 복구 검증.
  - queued 카드뉴스: 자동 completed, PNG 자산 4개.
  - 유효한 임대가 있는 processing 릴스: 재실행되지 않음.
  - 같은 QA 릴스 임대만 과거 시각으로 변경: 다음 워커 처리에서 completed, 약 43초 소요.
  - 릴스 MP4·JPG 자산 각 1개, 중복 자산 0개.
  - 두 제작 세션 모두 completed, 두 작업의 임대 해제 확인.
- 실제 복구 검증 중 수동 복구 API나 진행률 조회에 의한 생성 실행은 사용하지 않았습니다. 워커가 직접 처리했습니다.
- 운영 스모크 검사에서 프로세스·Supabase DB·Storage·게스트 경로·CORS 정상.

## 해석 및 대응

임대는 15분이며 실행 중 30초마다 갱신합니다. 실제 프로세스 중단 시 마지막 임대가 만료되어야 다른 실행이 재획득합니다. 위 검증은 임대 만료 상태를 재현한 것이며 운영 API를 강제로 중지한 시험은 아닙니다. 다른 작업이 처리 중이면 해당 배치 완료까지 기다릴 수 있습니다.

워커는 queued/processing 복구용입니다. 기존 failed 작업의 자동 재생성이나 Instagram 공개 게시 복구는 활성화하지 않았습니다. 중지할 때는 워커 변수 `GENERATION_WORKER_ENABLED=false`로 배포합니다.
