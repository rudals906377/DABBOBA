# 운영 반영 기록 — 2026-10-01

이 기록은 실제 실행 결과이며 공개 출시·실결제 개통 완료 선언이 아니다. 대상은 친구 계정 `lk7889@naver.com`이 접근하는 `dabboba-production` (`rconfxsykttfvznakile`, 조직 `cnaurigjhzfbzaxwfjhy`)이다. FINDE 및 폐기된 QA 프로젝트는 변경하지 않았다.

## 완료

- 브라우저와 Supabase CLI의 운영 프로젝트·계정을 대조했다. Supabase/Cloudflare 연결 도구의 계정이 다른 것을 확인해 해당 연결 도구로 쓰기를 하지 않았다.
- 적용 전 운영 DB는 `0075`까지 76개 migration, invalid index 0개였다.
- 기존 별도 키를 회전하지 않고 읽기 전용 repeatable-read snapshot으로 AES-256-GCM 논리 백업을 만들었다. PostgreSQL 18.6 client, TLS verify-full, 기존 Supabase CA를 사용했다. 큐 snapshot을 포함하고 인증 검증을 통과했다.
  - 파일: `/Users/kyoungmin/Desktop/DBB/.dabboba-launch/backup-archives/production-pre-release-20261001.dbbenc`
  - 811,424 bytes, 권한 0600, SHA-256 `382b6ec42e8d8dedbdf195e544f4d3cee297f34985a12cbe94446f9f2cf39f48`.
  - 실제 플랫폼 복원·오프사이트 보관 완료를 의미하지 않는다. 기존 archive를 덮어쓰지 않았다.
- 검토된 migration runner로 `0076`~`0081` 6개를 적용했다. 재실행은 적용 0개이며 82개 전체 checksum이 소스와 일치했다. invalid index 0개.
- 실제 migration/runtime/worker 연결에서 읽기 전용 출시 DB 검사가 통과했다. 대상 일치·TLS·역할 경계 정상. public 테이블 91개 모두 RLS 활성, anon/authenticated/service_role의 public 테이블 노출 0개.
- `be2c66f`의 API/admin API/worker를 빌드해 운영에 코드만 배포했다. Supabase Secret은 추가·교체하지 않았고 PRELAUNCH 및 기존 SNS 로그인 설정을 유지했다.
- 공개 기본 경로 검사 통과. 약관/개인정보 필수 버전은 공개 웹과 같은 `2026-09-30`이다. 로그인 목록은 KAKAO/NAVER/GOOGLE/APPLE.
- 올바른 `/v1/catalog/products/:productId/included-products`에서 가챠 8개 구성 7·5·8·6·5·5·5·5종, 합계 46종을 확인했다. 예전 문서의 `prize-lineup` 경로는 실제 현재 계약의 이름이 아니므로 그 경로의 404만으로 미배포를 판단하면 안 된다.
- 기존 탈퇴 요청은 회원정보 처리 COMPLETED / Auth 삭제 COMPLETED 1건, 남은 삭제 job 0건이다. Apple credential 1건은 아직 존재하며 이 조회는 Apple 토큰 폐기 실증이 아니다.
- 승인된 민트색 가로 워드마크를 최신 출시 작업본에 통합했다. iOS RGB 1024px, Android RGBA 1024px 안전 영역, 개발자 콘솔용 RGB 256px/250KB 미만 검사 통과. 이미지 원본은 보존했고 흰색/아이보리 시안은 적용하지 않았다.
- Cloudflare 친구 계정 `e2e1645ee7006824232a8b657bd784f5`에서 관리자 빌드·비밀값 검사·dry run 후 `--keep-vars`로 배포했다. `admin.dabboba.net` version `bf51d084-dd55-4210-bfe3-c886e35e9894`; 기존 Secret/환경값 유지. 현재 화면은 정상 로그인 페이지이며 인증 후 사진 업로드는 아직 확인하지 않았다.
- 구성 이미지 46개를 실제 GET으로 읽어 HTTP 200/image MIME/nonempty bytes를 확인했다. HEAD 403은 GET 접근 실패가 아니다.
- Kakao 앱 1591356과 Naver DABBOBA 앱에 확정 민트색 가로 아이콘을 등록했고 새로고침 후 화면에서 확인했다. 사업자 등록, 개인정보 동의항목, callback, key는 변경하지 않았다.
- 로컬 단위 검사 1,036개 + TypeScript 8개, 관리자 56개 통과. iOS/Android PRELAUNCH production export 및 금지 fixture/결제 표시 검사 통과. 서명된 최종 native 바이너리나 실제 기기 결과가 아니다.
- 추가 audit에서 Fastify 5.12.1 high 4건/moderate 1건을 발견해 `^5.12.2` 하한과 잠금 5.12.5로 수정했다. audit 0건, 빌드·타입·API 319개 통과(38개 DB 통합은 이 실행에서 미설정/건너뜀), 비동기 body 치환 거부 회귀 및 Deno 고객/관리자 entry 검사·고객 bundle smoke 통과. 첫 Deno 검사는 root에서 config를 선택하지 않아 import 해석에 실패했고 올바른 함수 config로 재실행했다. 검사 기준이나 보안 경계를 완화하지 않았다.
- 보안 수정 commit `1af8df2`를 clean release source 검사 후 운영 고객/관리자 API에 코드만 재배포했다. worker/Secret/결제 모드를 변경하지 않았다. EAS production의 공개 설정을 값 노출 없이 메모리로 읽어 전체 PRELAUNCH 출시 설정과 해당 공개 API 검사 7개 경로·대표 이미지가 통과했다. paymentProvider는 공개 config에 없으므로 원격 provider 설정까지 증명하지 않는다.

## 진행·미완료

- PR #13의 첫 원격 검사에서 DB migration·Cloud Run artifact·Cloudflare Pages 검사는 통과했지만 계약 단위 검사가 기존 2종 이미지 role만 기대해 실패했다. 최신 `gallery` role·단일 사진 연결 해제·8장 제한 설명을 확인하도록 계약 검사를 보완했고 계약 검사 25개가 통과했다. 재실행 CI 결과와 병합은 별도 확인 대상이다.

- 관리자 로그인이 필요하다. 운영 사진 추가/저장 검증은 로그인 후 수행해야 한다.
- 가챠 8개는 COMING_SOON이며 PRELAUNCH 결제 차단 유지. 실바니안 1·2·3 대표 슬라이드의 운영 연결은 아직 없다. 숫자 사진을 경품으로 등록하지 않는다.
- PG 계약서·서류, 가입비, 보증보험 완료 여부와 PG 승인을 요청했다. 사용자 실제 결제·취소/환불 실증을 대체할 수 없다.
- Apple 실제 탈퇴/토큰 폐기, 최종 새 빌드 실기기 회귀, 스토어 제출/심사, 판매 정책의 법률 검토, 친구 소유 Expo/GitHub 및 키 복구 확인은 남아 있다.
- 쿠지는 첫 출시 범위 밖이다. SMS는 설정/실기기 검증 없이는 노출하지 않는다.
- 네이버는 실제 콘솔에서 개발 중이며 등록된 테스터만 로그인할 수 있다. 현재 이름/이메일/성별/생일/전화번호가 필수로 설정돼 있어 사용처 검토와 실제 로그인 단계 캡처가 필요하다. 임의로 개인정보 권한을 넓히거나 증빙 없는 검수 요청은 하지 않았다.
- Apple 앱 6815146511은 제출 준비 중, 스크린샷 0장·설명/리뷰 접근/연령/개인정보 선언 미완료. Play 개발자 4785931881586592091은 앱 레코드가 아직 없다. PortOne 새 탭은 로그인 화면이다. 이들의 로그인 가능 여부와 실제 심사 완료는 다르다.
- EAS 프로젝트는 `@dabboba-team/dabboba-mobile` / `fa48d52e-3b3c-4e2b-82d5-ae0726382587`; 현재 CLI는 개발자 kyoungminoh Owner다. production 공개 URL과 PRELAUNCH/UNCONFIGURED 설정은 정상 대상이다. 친구 Owner/MFA/billing 확인 없이 유료 빌드·공개 서명 제출을 시작하지 않았다.

운영 환경의 개인정보·비밀번호·토큰·Secret 원문은 이 기록에 넣지 않았다.
