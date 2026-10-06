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
- LIVE용 약관·개인정보처리방침과 새 정책 버전 마이그레이션 적용.
- 운영 DB 암호화 백업과 `backup.mjs verify` 통과(전환 직전).
- 운영자가 판매할 가챠를 `ON_SALE`로 열고 ACTIVE 확률표와 재고를 검수함. LIVE 검증은 구매 가능한 가챠가 1개 이상이고 판매 중인 쿠지가 0개일 때만 통과한다.
- 결제 대사 워커와 Cron 운영 구성. 이 명령은 Cron을 켜지 않는다.

## LIVE 프로필 준비

1. `../.dabboba-launch/supabase-edge-production.env`(검증된 PRELAUNCH 운영 프로필)를
   `../.dabboba-launch/supabase-edge-live.env`로 복사하고 권한을 `0600`으로 둔다.
2. 다음만 바꾸거나 추가한다:
   - `DABBOBA_API_COMMERCE_MODE=LIVE`, `DABBOBA_API_PAYMENT_PROVIDER=PORTONE_V2_INICIS`
   - `DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS`(KAKAO·NAVER·GOOGLE·APPLE 필수, PHONE은 `DABBOBA_PHONE_LOGIN_READY=true`일 때만)
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
