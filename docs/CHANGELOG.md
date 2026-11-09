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

## 주요 변경

- QR 기반 상인 접근 제어 추가
- 생성 작업 선점·복구 워커 추가
- 이미지·영상 저장소를 Supabase 중심으로 정리
- 이미지·영상은 Supabase Storage로 통일

세부 API 변경은 [API_CHANGES.md](API_CHANGES.md), 운영 방법은 [OPERATIONS.md](OPERATIONS.md)를 기준으로 합니다.
