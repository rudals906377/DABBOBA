# 운영 LIVE 전환·되돌리기 절차

운영 Supabase 프로젝트(`rconfxsykttfvznakile`)를 PRELAUNCH에서 실제 결제가 일어나는 LIVE로
바꾸는 명령과, 다시 PRELAUNCH로 되돌리는 명령이다. 명령이 있다고 전환이 승인된 것은 아니다.
아래 "전제 조건"이 모두 충족되었다는 별도 확인 뒤에만 실행한다.

## 명령

| 목적 | 명령 |
| --- | --- |
| LIVE 후보 읽기 전용 검사 | `corepack pnpm run supabase:edge:live:check` |
| PRELAUNCH → LIVE 전환, LIVE 중 코드 재배포 | `node scripts/deploy-supabase-live-edge.mjs --confirm=LIVE:rconfxsykttfvznakile` |
| LIVE → PRELAUNCH 되돌리기 | `node scripts/deploy-supabase-live-edge.mjs --rollback --confirm=PRELAUNCH:rconfxsykttfvznakile` |

`package.json`의 `supabase:edge:live:deploy`·`supabase:edge:live:rollback`도 같은 스크립트를
부르며, 확인 문구(`--confirm=…`)가 정확히 같아야 실행된다. 문구가 없거나 다르면 어떤
파일도 읽지 않고 종료한다.

## 전제 조건 (명령이 대신 확인하지 않는 것)

- KG이니시스 LIVE 승인, LIVE MID·채널키·웹훅·API secret 발급, 정산계좌 명의 확인.
- 실제 결제가 가능한 LIVE 앱 빌드의 스토어 승인. 서버만 LIVE로 바꿔도 PRELAUNCH 앱에서는 결제할 수 없다.
- 법적 문서 게시 번들 완료(아래 "법적 문서 게시 번들" 절: 게시 바이트 해시 확인, 마이그레이션 `0090`·`0091` 적용).
- 운영 DB 암호화 백업과 `backup.mjs verify` 통과(전환 직전).
- 운영자가 판매할 가챠를 `ON_SALE`로 열고 ACTIVE 확률표와 재고를 검수함. LIVE 검증은 구매 가능한 가챠가 1개 이상이고 판매 중인 쿠지가 0개일 때만 통과한다.
- 결제 대사 워커와 Cron 운영 구성. 이 명령은 Cron을 켜지 않는다.

## 법적 문서 게시 번들 (LIVE 직전, 한 배포)

2026-10-07 판 약관·개인정보처리방침은 코드에 들어 있다: `public/legal/terms`·`privacy`의 HTML, 정책 버전
`2026-10-07`을 발행하는 마이그레이션 `0090`, 저장된 맞춤 추천 동의를 모두 철회하는 `0091`, 워커의 세션 기록
보관 90일(`apps/worker/src/config.ts`). 아래 순서를 바꾸지 않는다. 고객이 재동의 화면에서 여는 문서와 DB에
기록된 문서 해시가 같아야 하기 때문이다.

1. `main`에 병합한다. Cloudflare Pages가 `main`을 빌드해 `https://dabboba.net/terms`·`/privacy`를 바로 교체한다.
   (2026-10-07 완료: PR #37 병합. 같은 날 게시 바이트가 아래 두 해시와 같음을 확인했다. 운영 DB는 아직 2026-09-30 판이므로
   3단계를 미루는 동안 앱 동의 화면의 버전과 공개 문서 내용이 어긋난다. 3단계를 가능한 한 빨리 진행한다.)
2. 게시된 바이트가 `0090`의 해시와 같은지 확인한다. 같을 때까지 3단계로 가지 않는다(Pages 배포 완료 대기 또는 캐시 비우기).
   ```
   curl -sS https://dabboba.net/terms | sha256sum    # 54e45f9237ea45f6063337976a3ce6beee14fa898916c9bfb59fa814ac7b52d2
   curl -sS https://dabboba.net/privacy | sha256sum  # a7684326c9d246a7bc2f649c33cc623e7e0eb6f06fb0683decd014c6e501ae06
   ```
3. 운영 DB를 백업하고 `backup.mjs verify`를 통과한 뒤 마이그레이션을 적용한다(`corepack pnpm run db:migrate`,
   운영 마이그레이션 URL). `0090`은 현재 2026-09-30 판 두 행이 있을 때만 적용되며, 적용 즉시 `/v1/public/config`와
   `/v1/auth/providers`가 `2026-10-07`을 요구하고 기존 회원은 다음 요청에서 재동의 화면을 본다. `0091`은 맞춤 추천
   동의를 철회하고 `SYSTEM_WITHDRAWN` 증거 행을 남긴다.
4. Edge 함수를 배포한다(PRELAUNCH 중이면 `supabase:edge:deploy`, LIVE 전환과 함께라면 위 LIVE 전환 명령). API는
   DB의 버전을 그대로 읽고, 워커는 세션 기록을 만료·폐기 후 90일 뒤에 지운다.
5. `corepack pnpm run supabase:edge:public:verify`로 두 공개 엔드포인트의 버전이 같은지 보고, 앱에서 재동의 화면이
   새 문서 링크를 여는지 확인한다.
6. 같은 날 운영자가 `ops/database/commerce-retention-approval.sql`의 `step=approve`로 보존기간 정책을 등록·승인한다
   (절차는 `docs/commerce-retention-components.md`, 관리자 화면 없음, `WORKER_COMMERCE_RETENTION_MODE`는 DISABLED 유지).
   대표가 내부관리계획을 승인한다.

되돌리기: HTML만 이전 판으로 되돌리면 DB 해시와 어긋나 재동의가 실패한다. 문서를 고쳐야 하면 새 버전(새 시행일,
새 마이그레이션)으로 다시 발행하고, `0090`·`0091`은 취소하지 않는다.

## 공개 사이트 문구 전환 (LIVE 전환 성공 직후)

`dabboba.net` 첫 화면(스토어프런트)은 빌드 변수로 문구를 고른다. 공개 사이트 보안 정책이 다른 도메인 요청을 막아
API의 판매 상태를 실시간으로 읽을 수 없기 때문이다. 변수가 정확히 `LIVE`일 때만 판매판 문구(가챠 정식 오픈, NOW OPEN)를
쓰고, 그 밖에는 사전오픈 문구를 유지한다. 쿠지는 어느 쪽이든 OPENING SOON이다.

1. LIVE 전환 명령이 성공하면 Cloudflare Pages의 Production 환경변수에 `VITE_DABBOBA_COMMERCE_MODE=LIVE`를 추가한다.
2. 최신 `main` 배포를 다시 실행(Retry deployment)한다. 정책 HTML 바이트는 바뀌지 않으므로 `0090` 해시는 그대로다.
3. `curl -sS https://dabboba.net/ | grep -o '보관함에 모아 받아요'`로 판매판 메타 문구가 나오는지 확인한다.

되돌리기 명령을 실행했다면 같은 변수를 지우고 배포를 다시 실행해 사전오픈 문구로 돌린다.

## LIVE 프로필 준비

1. `../.dabboba-launch/supabase-edge-production.env`(검증된 PRELAUNCH 운영 프로필)를
   `../.dabboba-launch/supabase-edge-live.env`로 복사하고 권한을 `0600`으로 둔다.
2. 다음만 바꾸거나 추가한다:
   - `DABBOBA_API_COMMERCE_MODE=LIVE`, `DABBOBA_API_PAYMENT_PROVIDER=PORTONE_V2_INICIS`
   - `DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS`(KAKAO·NAVER·GOOGLE·APPLE. 2026-10-07 결정으로 PHONE은 넣지 않으며 `DABBOBA_PHONE_LOGIN_READY`는 false로 둔다)
   - PortOne LIVE 값과 결제·워커 비밀값, 워커 대사 설정(`PAYMENT_RECONCILIATION_PROVIDER=PORTONE_API` 등)
   - 선택: `DABBOBA_API_PORTONE_KCP_CHANNEL_KEY`, 로그 수준, Expo 푸시 토큰
3. DB 주소·세션 pepper·워커 비밀값·저장소 키·Apple 키 등 나머지 값은 PRELAUNCH 프로필과
   **완전히 같아야 한다**. 다르면 명령이 어떤 값이 다른지(이름만) 알리고 아무것도 바꾸지 않는다.
   pepper가 바뀌면 모든 고객이 로그아웃되고, DB 주소가 바뀌면 다른 DB를 보게 되기 때문이다.
4. `corepack pnpm run supabase:edge:live:check`로 프로필·소스·운영 DB를 읽기 전용으로 확인한다.

## 전환 명령이 하는 일

1. 확인 문구 검사 → LIVE 프로필(`0600`, LIVE 검증)과 PRELAUNCH 기준 프로필 읽기 → 기준값 일치 검사.
2. 소스(깨끗한 커밋, 최신 마이그레이션)와 운영 DB 읽기 전용 릴리스 검사, 관리자 웹 Cloudflare Access 검사,
   Supabase CLI 접근 확인. Access 검사는 `apps/admin/wrangler.jsonc`의 Access 팀 도메인·AUD 태그와
   `workers.dev`·미리보기 주소 꺼짐을 확인하고, 로그인하지 않은 요청이 `admin.dabboba.net`에서 그 팀의 Access
   로그인으로 넘어가는지 본다(`corepack pnpm run admin:access:verify`와 같은 검사, 체크리스트 4-1).
3. 함수 3개 빌드 → LIVE 비밀값 업로드 → `dabboba-api`·`dabboba-admin-api`·`dabboba-worker` 배포.
4. 운영 API를 LIVE 기준으로 검증(공개 설정·로그인 방법·구매 가능한 가챠·쿠지 미판매·정책 버전·상품 이미지)하고, 워커 경계(GET 405, 익명 POST 401)를 확인.
5. 1~2단계에서 실패하면 프로젝트는 바뀌지 않는다. 3~4단계에서 실패하면 **자동으로 PRELAUNCH로 되돌린다**
   (LIVE 전용 결제 비밀값 삭제 → PRELAUNCH 프로필 업로드 → PRELAUNCH 검증). 자동 되돌리기마저
   실패하면 즉시 되돌리기 명령을 직접 실행하라는 오류로 끝난다.

이미 LIVE인 프로젝트에 같은 명령을 실행하면 "LIVE redeploy"로 기록되고, 검증에 실패하면 역시
PRELAUNCH로 되돌린다. 결제 상태를 확인할 수 없는 채로 판매를 계속하지 않기 위해서다.

## 되돌리기 명령이 하는 일

PRELAUNCH 기준 프로필 검증 → CLI 접근 확인 → 프로젝트에 남은 LIVE 전용 결제 비밀값만 삭제 →
PRELAUNCH 프로필 업로드 → PRELAUNCH 공개 API 검증. 함수 코드는 다시 배포하지 않는다.
진행 중이던 주문·결제·환불 기록은 바꾸지 않으므로, 되돌린 뒤 남은 결제는 관리자 대사·환불
절차로 처리한다.

## 일반 배포와의 관계

`supabase:edge:deploy`(PRELAUNCH 배포)는 프로젝트에 LIVE 결제 비밀값이 남아 있으면 배포를 거부한다.
PRELAUNCH 프로필을 LIVE 비밀값 위에 올리면 API가 시작하지 못하기 때문이다. LIVE 중 코드 배포는
LIVE 명령으로, PRELAUNCH 복귀는 되돌리기 명령으로만 한다.

비밀값 존재 여부는 Supabase CLI의 비밀값 이름 목록(`secrets list --output json`, 값은 읽지 않음)으로
확인한다. 목록을 읽지 못하면 운영 API의 `/v1/public/config`가 PRELAUNCH라고 답할 때만 비밀값이 없다고
보고, 그 외에는 아무것도 바꾸지 않고 멈춘다. 되돌리기 중 목록을 읽지 못하면 LIVE 전용 키 이름을
모두 삭제 대상으로 지정한다.

## 이 명령이 하지 않는 것

마이그레이션 적용, 백업, Cron·자동 작업 활성화, 앱 빌드·스토어 제출, PG 승인 확인, 카드 결제 실행.
비밀값은 출력하지 않으며 오류에는 단계와 설정 이름만 나온다.
