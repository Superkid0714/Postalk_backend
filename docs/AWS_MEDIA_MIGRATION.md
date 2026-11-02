# 이미지·영상 AWS S3 이전 안내

이번 변경은 이전 준비입니다. AWS 배포, 실제 파일 복사, DB 변경은 자동 실행하지 않습니다.
11월 18~21일 전시 운영은 Supabase Pro DB와 Storage로 통일합니다. AWS 이전은 보류하며 아래 절차는 향후 S3 이전을 선택했을 때만 사용합니다.
먼저 media_usage_summary()로 DB 등록 파일의 크기·종류·미참조 후보를 확인하고 실제 전송량과 함께 판단합니다.
공통 카탈로그는 저장 위치 변경 시 파일 ID를 유지합니다. 기존 참조 변경 트리거가 같은 트랜잭션에서 카탈로그도 갱신합니다.
DB·인증은 Supabase에 유지하고 원본 사진·영상, 생성 이미지·영상, 영상 썸네일의 저장소를 S3로 전환할 수 있습니다.

## 호환 방식

| 저장된 bucket 값 | 읽는 위치 |
| --- | --- |
| `uploads` | 기존 Supabase Storage |
| `s3:YOUR-BUCKET` | 명시된 AWS S3 버킷 |

`MEDIA_STORAGE_PROVIDER=s3`는 새 파일의 쓰기 위치만 바꿉니다. 기존 파일은 자동 재해석하지 않습니다.
파일 키는 그대로 유지합니다. 프론트엔드는 업로드 응답의 `bucket`과 `filePath`를 다음 요청에 그대로 전달해야 합니다.
`bucket`을 `uploads`로 고정하면 S3 파일을 찾지 못합니다. 서명 URL은 영구 주소로 저장하지 마세요.
모든 앱의 업로드·검수·다운로드·생성 결과·미리보기·Instagram 게시 URL은 `lib/storage/media.ts`를 사용합니다.
허용 버킷은 `AWS_S3_BUCKET`, `AWS_S3_READ_BUCKETS`로 제한하며 하나의 `AWS_REGION` 안에 있어야 합니다.

## AWS 인프라

`infra/aws/media-storage.yaml`은 비공개 버킷, 네 가지 Public Access Block, BucketOwnerEnforced,
AES-256 암호화, 버전 관리, HTTPS 강제, 스택 삭제 시 버킷 보존을 정의합니다.
중단된 multipart 업로드만 7일 후 정리하며 저장된 미디어는 자동 삭제하지 않습니다.
프론트엔드 origin에는 GET·HEAD만 허용합니다. 공개 ACL·공개 객체는 필요하지 않습니다.
관리형 IAM 정책은 해당 버킷의 GetObject·PutObject·ListBucket만 허용하고 삭제 권한은 주지 않습니다.

다음은 별도 검토 후 실행하는 예시입니다. 실제 배포는 수행하지 않았습니다.

```powershell
aws cloudformation validate-template --template-body file://infra/aws/media-storage.yaml --region ap-northeast-2
aws cloudformation deploy --template-file infra/aws/media-storage.yaml --stack-name postalk-media --capabilities CAPABILITY_IAM --region ap-northeast-2 --parameter-overrides BucketName=YOUR-UNIQUE-BUCKET FrontendOrigin=https://YOUR-FRONTEND
```

출력의 RuntimePolicyArn을 API 서버의 ECS task role 또는 EC2 instance role에 연결합니다.
워커는 내부 HTTP API만 호출하므로 별도 S3 권한이 필요하지 않습니다.
로컬에서는 AWS_PROFILE 또는 표준 AWS 자격 정보 환경 변수를 사용합니다. 비밀키를 소스에 넣지 마세요.

## 전환 순서

1. 운영 DB를 백업하고 [운영 안내](OPERATIONS.md)의 20261102 SQL을 먼저 적용합니다.
2. `supabase/migrations/20261102_media_storage_remap.sql`을 적용합니다. 신규 schema.sql에는 포함되어 있습니다.
3. 아래 설정으로 호환 코드를 배포하되 쓰기 위치는 Supabase로 유지합니다.

```dotenv
MEDIA_STORAGE_PROVIDER=supabase
AWS_REGION=ap-northeast-2
AWS_S3_BUCKET=YOUR-UNIQUE-BUCKET
AWS_S3_READ_BUCKETS=
```

목록 확인은 원격 읽기만 수행하고 로컬 보고서를 작성합니다. 최종 복사·참조 전환 중에는
파일이 바뀌지 않도록 API 쓰기와 워커를 중지하세요.

```powershell
# 기본값: 목록만 작성, 원격 파일·DB 변경 없음
node --env-file=.env --import tsx scripts/migrate-media-to-s3.ts --mode plan
# 처음 5개 표본 복사·검증
node --env-file=.env --import tsx scripts/migrate-media-to-s3.ts --mode copy --apply --limit 5
# 전체 복사·검증
node --env-file=.env --import tsx scripts/migrate-media-to-s3.ts --mode copy --apply
# 다시 검증한 뒤 DB 참조 전환
node --env-file=.env --import tsx scripts/migrate-media-to-s3.ts --mode promote --apply
```

도구는 Supabase의 uploads 버킷 전체를 순회합니다. 다른 원본 버킷은 별도 검토 대상입니다.
기존 S3 키는 덮어쓰지 않으며 크기·SHA-256·MIME을 원본과 비교합니다. 다르면 즉시 중단합니다.
검증한 한 객체의 assets, session assets, job result, sourceVideos, videoWorkflow 참조를
하나의 DB 트랜잭션으로 바꿉니다. 파일 키·캡션·게시 상태는 바꾸지 않습니다.
전시 기능 SQL 적용 후에는 exhibition_uploads와 전시 작업의 materials 참조도 함께 바꿉니다.
카드뉴스·썸네일이 하나의 버킷 참조를 공유하므로 promote/rollback은 전체 원본의 검증을 먼저 끝낸 뒤 DB를 변경합니다.
이 두 모드에는 --limit을 사용할 수 없습니다. 표본 복사만으로 일부 묶음의 참조를 전환하지 않도록 막습니다.
오류 이전에 완료된 객체는 유지됩니다. 보고서 확인 후 같은 모드를 다시 실행하면 재검증하며 계속 처리합니다.
`--limit`은 처음 N개 표본용이며 전체 이전에서는 제거해야 합니다.
결과 `migration-reports/*.jsonl`에는 가게 파일 키가 포함되므로 비공개로 보관하며 Git에서 제외합니다.
원본 Supabase 파일과 S3 파일을 삭제하는 기능은 없습니다.

복사·전환 확인 후 `MEDIA_STORAGE_PROVIDER=s3`로 바꾸고 API 서버를 재시작합니다.
사진·영상 업로드, 검수, 카드뉴스·영상 생성, 썸네일, 홈·보관함을 확인한 뒤 일반 쓰기를 재개합니다.
게시 확인은 상인이 실제 게시를 원할 때에만 게시 버튼으로 진행하세요.
실제 S3·IAM·Instagram 통합 검증은 운영 자격 정보가 있는 환경에서 별도로 해야 합니다.
임시 AWS 자격 정보로 만든 서명 URL은 설정 시간보다 자격 정보 만료가 먼저 올 수 있습니다.
Instagram이 미디어를 가져오는 동안 유효한 자격 정보와 URL이 필요합니다.

## 롤백

새 쓰기만 되돌리려면 `MEDIA_STORAGE_PROVIDER=supabase`로 바꾸고 재시작합니다.
S3 읽기 설정·권한은 유지해야 이미 S3에 저장한 새 파일도 읽을 수 있습니다.
과거 파일의 DB 참조까지 복귀하려면 API 쓰기·워커를 멈춘 뒤 실행합니다.

```powershell
node --env-file=.env --import tsx scripts/migrate-media-to-s3.ts --mode rollback --apply
```

양쪽 파일을 검증하고 과거 파일의 S3 참조를 uploads로 되돌립니다.
S3에만 생성된 새 파일을 Supabase로 복사하지 않으므로 완전한 복귀에는 별도 역방향 복사가 필요합니다.

## 공식 자료

- [AWS SDK v3 S3 예제](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)
- [조건부 PutObject](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/PutObjectCommand/)
- [Public Access Block](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
