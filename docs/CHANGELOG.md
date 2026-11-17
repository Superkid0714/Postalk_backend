# 변경 기록

## 현재 운영 기준

- 운영 브랜치: `main`
- CI: GitHub Actions에서 lint, 타입 검사, 테스트, Docker 빌드
- 배포: Railway
- DB·Storage: Supabase Pro
- 상태 점검: `/api/health/ready`
- 관리자 검수: 제거
- 게시: 상인이 직접 실행
- 릴스: 무음 자막 MP4

## 2026-11-18

- 게스트 최초 503의 직접 원인을 Supabase API Gateway의 `401/PGRST303`으로 확인하고 [원인 조사 기록](incidents/20261118-guest-session-503.md)을 추가했습니다.
- 서버용 secret 키의 중복 Bearer 전송을 제거하고 같은 오류를 기존 제한된 재시도에 포함했습니다. 권한 검증은 유지합니다.
- 게스트 세션 복구 정책과 503 응답·클라이언트 대응을 운영 Swagger와 연동 문서에 반영했습니다.
- 인증 수정 후 자동 테스트 174개와 운영 게스트 접속 16회, 두 콘셉트 릴스 생성·저장을 확인했습니다. 전체 UI·카드뉴스·Instagram 게시의 재검증을 의미하지 않습니다.

## 주요 변경

- QR 기반 상인 접근 제어 추가
- 생성 작업 선점·복구 워커 추가
- 이미지·영상 저장소를 Supabase 중심으로 정리
- 이미지·영상은 Supabase Storage로 통일

세부 API 변경은 [API_CHANGES.md](API_CHANGES.md), 운영 방법은 [OPERATIONS.md](OPERATIONS.md)를 기준으로 합니다.
