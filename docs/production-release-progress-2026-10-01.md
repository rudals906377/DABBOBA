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

## 진행·미완료

- 최신 Cloudflare 관리자 빌드·비밀값 유출 검사·dry run 통과. 운영 배포 및 로그인 상태의 사진 추가/저장 검증은 별도 기록한다.
- 가챠 8개는 COMING_SOON이며 PRELAUNCH 결제 차단 유지. 실바니안 1·2·3 대표 슬라이드의 운영 연결은 아직 없다. 숫자 사진을 경품으로 등록하지 않는다.
- PG 계약서·서류, 가입비, 보증보험 완료 여부와 PG 승인을 요청했다. 사용자 실제 결제·취소/환불 실증을 대체할 수 없다.
- Apple 실제 탈퇴/토큰 폐기, 최종 새 빌드 실기기 회귀, 스토어 제출/심사, 판매 정책의 법률 검토, 친구 소유 Expo/GitHub 및 키 복구 확인은 남아 있다.
- 쿠지는 첫 출시 범위 밖이다. SMS는 설정/실기기 검증 없이는 노출하지 않는다.

운영 환경의 개인정보·비밀번호·토큰·Secret 원문은 이 기록에 넣지 않았다.
