# Supabase Storage 미디어 전환

2026-09-06. 기존 회원·상품·주문 데이터와 승인된 UI는 변경하지 않는다. 저장소를 자동 생성하거나 환경 파일·운영 설정을 변경하지 않는다. **코드와 로컬 Storage 검증은 운영 적용과 별개다.**

## 저장 경로

앱은 `/v1/media/uploads`에 `acceptedUploadMethods: ["POST", "PUT"]`를 보낸다. 기존 POST 응답은 보존하며 Supabase 응답은 명시적인 raw PUT 분기다. 클라이언트는 받은 URL·만료·정확한 크기·다섯 서명 헤더를 검사하고 앱 인증정보나 쿠키 없이 저장소로 직접 전송한다. API가 파일을 중계하지 않는다. Expo의 PUT은 리다이렉트 차단을 지원하는 `expo/fetch`를 사용하며 기존 URI multipart POST는 그대로 유지한다.

PUT 권한은 120초이며 객체키, Content-Type, Content-Length, payload mode, SHA 선언 및 media ID에 묶인다. 본문의 실제 SHA는 서명 메타데이터와 별개다. `/complete`는 소유자·DB 상태·실제 바이트 수·SHA·magic·이미지 디코딩을 검사하고 메타데이터 제거·방향 보정·WebP 정제를 수행한다. 기존 10 MiB·픽셀·동시 처리·일별/보관량 제한과 트랜잭션은 유지한다.

Supabase는 GCS의 원자적 `ifGenerationMatch:0`와 같은 조건부 쓰기를 제공한다고 가정하지 않는다. 서버 처리 시도마다 별도 `media/<mediaId>/<sha>-<claimUUID>.webp` 키를 만들고, 실제 저장된 바이트를 다시 읽어 검증한다. 해당 키와 UUID 버전을 DB가 확정한 후에만 READY로 전환한다. 클라이언트에는 최종 키의 업로드 권한을 발급하지 않는다.

`media_assets.metadata.storage`는 provider·bucket·version을 보존한다. 숫자형 `object_generation`은 GCS 전용으로 유지하며 Supabase UUID를 숫자로 바꾸지 않는다. 이전 위치 정보가 없는 행은 계속 GCS로 해석한다. 새 업로드 기본값을 바꿔도 기존 사진을 다른 저장소에서 읽거나 삭제하지 않는다. 옛 버킷과 다른 설정이 들어오면 실패하며 자동으로 대체하지 않는다.

다른 처리 시도가 승리해 남은 최종 객체는 `storageCleanup.pendingFinalObjectKeys`에 먼저 기록한다. 승리한 키만 목록에서 제거한다. 중단된 프로세스가 뒤늦게 쓴 파일도 재검사할 수 있도록 나머지 목록은 일회성 성공으로 지우지 않는다. 현재 READY 객체는 정리 대상에서 제외한다. 별도의 기존 staging 재업로드 유효기간 후 정리도 유지한다.

## 재실행 가능한 로컬 검증

[격리된 Storage 환경](../scripts/storage-conformance/README.md)은 공식 v1.73.0 서버와 실제 PostgreSQL 메타데이터, file backend를 사용한다. 게이트웨이가 출력한 루프백 포트로 다음을 실행한다. 실제 프로젝트 `.env`를 읽지 않는다.

```sh
corepack pnpm --filter @dabboba/media-storage build
corepack pnpm --filter @dabboba/media-storage test
node packages/media-storage/scripts/local-conformance.mjs http://127.0.0.1:PORT
node scripts/verify-local-storage.mjs --storage-url http://127.0.0.1:PORT
node scripts/verify-local-storage-image.mjs dabboba-api:storage-local-20260906
node scripts/verify-local-storage-image.mjs dabboba-worker:storage-local-20260906
```

API 검사는 이름이 고정된 기존 disposable DABBOBA DB를 확인하고, fixture 생성은 owner·API 실행은 제한 runtime 계정으로 분리한다. 전용 Storage 테스트 버킷과 식별 가능한 테스트 행만 만든다. 운영 DB·기존 테스트 주문은 초기화하지 않는다.

API 검증에는 직접 업로드, 이전 POST 전용 클라이언트 처리, 타인 접근 차단, idempotent intent, 동시 완료, 실제 WebP 바이트/버전 조회, staging 재전송과 최종 객체 격리, SHA 위조 거부, 만료, 삭제, A 업로드 후 중단→B 재처리 성공→A 지연 복귀 상황이 포함된다. 정상 업로드의 단위 테스트만으로 동시성이나 실제 공급자 검증을 대체하지 않는다.

이미지 검사는 먼저 로컬 태그를 SHA-256 ID로 확정한 뒤 그 ID만 `--pull=never`로 실행한다. 네트워크·호스트 볼륨·추가 권한 없이 CPU 1/512MiB·비root·읽기 전용으로 파일 경계, production 설정, 오프라인 서명과 기존 GCS 보조 설정을 검사한다. 실제 API 시작·DB 연결·호스팅 Storage·TLS/CDN 검증을 대신하지 않는다.

macOS Docker 인증 helper가 응답하지 않는 환경에서는 전역 Docker 설정을 바꾸지 않고, 아래의 **이미 설치된** buildx 경로와 비어 있는 로컬 공개 이미지용 설정으로 빌드했다. 먼저 기존 실행이 종료된 것을 확인해야 하며, Docker.app/소켓 경로는 호스트마다 확인한다. 명령은 공개 기반 이미지 다운로드와 로컬 빌드만 수행하고 레지스트리 push나 Cloud Build를 실행하지 않는다.

```sh
DOCKER_CONFIG="$PWD/scripts/storage-conformance/docker-client" \
DOCKER_HOST="unix:///Users/kyoungmin/.docker/run/docker.sock" \
  /Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx build \
  --target api-runtime --tag dabboba-api:storage-local-20260906 \
  --load --progress=plain .
```

## 확인된 공급자 차이

- 네이티브 기본 signed upload의 문서상 유효기간은 2시간이다. 현재 120초 정책의 대체물로 사용하지 않는다. [공식 참조](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)
- v1.73.0의 S3 POST는 `content-length-range`를 무시하고 S3 If-Match도 실제 로컬 검사에서 무시됐다. 그 기능에 의존하지 않는다. [POST 구현](https://github.com/supabase/storage/blob/v1.73.0/src/storage/protocols/s3/policy.ts)
- REST의 versionId는 교체된 객체에서 이전 버전의 실패를 보장하는 식별자이지, 옛 파일을 보관하는 버전 이력이 아니다. [릴리스 소스](https://github.com/supabase/storage/releases/tag/v1.73.0)
- 최종 객체에는 no-store 메타데이터를 저장한다. 다만 v1.73.0 signed download는 Cache-Control 대신 JWT 만료와 같은 Expires를 반환했다. 호스팅/CDN에서 동일한 만료·캐시 동작을 보장한다고 보고하지 않는다. [CDN 문서](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

## 배포 설정의 로컬 연결

[Cloud Run 설정 예시](cloud-run-deployment.md)는 GCS·Supabase-only·두 저장소 병행·GCS로 기본값 복귀를 구분한다. API/Worker의 서버 키·S3 access ID·S3 secret은 서로 다른 Secret Manager 리소스와 숫자 버전 참조로 전달한다. 설정 누락, 다른 프로젝트 endpoint, raw secret, local HTTP, 구분자·줄바꿈 삽입은 거부한다. 기존 Cloud Build staging 버킷과 migration DB 분리는 그대로 유지한다.

Worker는 배포 후와 Scheduler 전에 실제 Job의 전체 환경·secret 참조·정확한 버전을 비교한다. `storage-v1` 실행 확인값은 repository를 포함한 전체 불변 이미지 URI와 공급자·버킷·기존 GCS·Worker DB/Storage secret 버전·프로젝트·Job·실행 계정 설정에 묶인다. 같은 태그로 이미지 저장소 또는 저장 설정만 바꾸어도 이전 확인값은 거부한다. 이 값의 계산 자체가 실제 Job 실행 성공을 뜻하지 않는다.

API 후보도 배포 인자와 같은 전체 환경·secret 맵을 사용한다. 공식 v1/v2 Revision의 이미지·실행 계정·고객 전용 환경과 정확한 Secret Manager ID/숫자 버전이 일치해야 배포 후 검사·smoke·승격을 통과한다. 같은 프로젝트 ID/번호/사용 중 별칭만 해석하고 다른 프로젝트·중복·추가 환경·평문 secret·실행 덮어쓰기는 거부한다.

최종 `bash ops/cloud-run/check-artifacts.sh`에서 build 8·API 후보 44·release 45·Storage 11·API Revision 8 테스트가 모두 통과했다. 외부 gcloud 변경은 로컬 stub으로만 대체한 배포 계약 증거다. 인증된 hosted-media smoke는 여전히 운영 적용 전 별도 항목이며 health/catalog 검사로 대체하지 않는다.

## 운영 적용 전 별도 항목

1. 실제 비공개 버킷·호스팅 기능 버전·CORS·최대 파일 크기·MIME 정책 확인. 새 버킷이나 유료 기능은 승인 없이 만들지 않는다.
2. Secret Manager에 Storage 서버 키와 S3 자격 증명을 저장한다. publishable key나 Expo/VITE 변수를 사용하지 않는다. API/Worker runtime DB 계정과 migration 연결 분리는 그대로다.
3. 실제 호스팅에서 변조·만료·버전 교체·반복 삭제·CDN 캐시 검사를 다시 수행하고 실물 iPhone/Android raw 업로드를 검증한다.
4. 준비된 Cloud Run 설정을 실제 Secret Manager 참조에 연결한 뒤 무트래픽 후보를 검증한다. 구현된 후보 전체 설정 게이트와 별도 authenticated hosted-media smoke를 실제 환경에서 충족해야 한다. 현 단계에서 운영 배포까지 완료했다고 주장하지 않는다.
5. 확인 후 새 업로드의 `MEDIA_STORAGE_PROVIDER`를 명시적으로 supabase로 선택한다. 이전 GCS 사진이 남으면 해당 접근을 유지한다. 구 POST 전용 앱은 GCS가 남아 있을 때만 그 경로로 호환되며, 없으면 426 업데이트 요청으로 실패한다.

문자·PG·실제 판매 이미지 승인·유료 운영·Storage 백업/전체 복원은 별도 출시 항목이다.
