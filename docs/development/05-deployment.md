# 5. 배포·환경 설정

```text
프론트엔드
→ Railway: Postalk_backend
   ├─ Railway: postalk-cardnews
   └─ Railway: postalk-reels
→ Supabase Pro: PostgreSQL + private uploads Storage
```

## 배포 기준

- GitHub 기본 브랜치: `main`
- 백엔드 공개 주소: `https://postalkbackend-production.up.railway.app`
- 파일 저장소: Supabase `uploads` 버킷
- AI 서비스: Railway 내부 주소로만 연결

## 프론트 배포 전 확인

1. 프론트의 API 기본 주소를 Railway 백엔드 주소로 설정합니다.
2. Railway의 `CORS_ALLOWED_ORIGINS`에 실제 프론트 origin을 추가합니다.
3. 게스트 제작은 `GUEST_CREATION_ENABLED=true`일 때만 사용할 수 있습니다.
4. `.env`, API 키, Instagram 토큰은 GitHub와 프론트 번들에 넣지 않습니다.

세부 환경 변수와 장애 확인 절차는 [Railway 배포 문서](../RAILWAY_DEPLOYMENT.md)를 참고합니다.
