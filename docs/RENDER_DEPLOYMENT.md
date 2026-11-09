# Render 배포 참고

이 문서는 과거 대안 검토 기록입니다.

현재 운영 배포는 Render가 아니라 아래 구조를 사용합니다.

```text
GitHub main → GitHub Actions → Railway API → Supabase Pro
```

새 서비스를 Render에 만들거나 `render.yaml`을 적용하지 않습니다. Render로 옮겨야 하는 별도 결정이 생기면 Railway 환경변수·도메인·헬스 체크·워커를 다시 검증한 뒤 새 절차를 작성합니다.
