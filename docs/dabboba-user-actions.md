# DABBOBA 사용자가 직접 준비해야 하는 항목

> 2026-09-09: 사용자가 Supabase 중심 백엔드를 선택했다. 아래 이전 Cloud Run/별도 서버 준비 항목은 보류하고 [Supabase 전환 계획](supabase-only-transition.md)을 우선한다. 지금 Google Cloud·Railway·Render 가입이나 결제는 필요하지 않다. 실제 배포·비밀 등록·Cron 활성화는 별도 승인 뒤 진행한다.

> 2026-09-22: DABBOBA의 최종 출시·운영 주체는 사용자가 지정한 친구로 확정했다. Apple/Google 스토어, Expo/EAS, GitHub, Cloudflare와 도메인, Supabase, 로그인·푸시 제공자, 고객지원 메일, PG·정산·결제·세금 계정은 친구 또는 친구가 대표·통제하는 것으로 확인된 사업자가 소유·통제해야 한다. 개발자는 필요한 범위의 협업 권한만 사용한다.
> 서비스별 현재 상태와 안전한 이전 순서는 [친구 명의 출시 계정 전환대장](friend-owned-release-accounts.md)을 기준으로 관리한다.

## 사용 방법

이 문서는 코드로 대신 만들 수 없는 계정, 계약, 비밀값, 사업 결정, 실제 기기 검증의 참고 기록이다. **2026-09-09 최신 지시: 이 목록을 마지막에 한꺼번에 요청하지 않고, 각 작업에 필요한 시점에 사용자와 함께 처리한다.** 뒤쪽의 과거 순서표는 현재 단계의 실행 지시가 아니다. 준비된 비밀은 채팅이나 저장소에 붙이지 말고 승인된 서버 비밀 설정에 직접 넣는다.

고객 로그인은 최신 결정에 따라 카카오·네이버·구글·애플·이메일 인증번호 다섯 가지로 진행한다. 휴대폰 로그인과 국내 본인확인은 제외하며, 본인확인 업체 신청이나 CI/DI 준비는 필요하지 않다. 사용자가 Supabase의 인증된 동일 이메일 자동 연결을 승인했으며, 다른 이메일의 SNS는 로그인 상태에서 직접 연결·해제하는 방향이다. 별도 DABBOBA 계정의 주문·잔액을 합치거나 1인1계정을 보장하지 않는다. 취소된 본인확인 adapter는 파일 생성 전에 중단됐으며 결제 연동과는 별개다. 구현·외부 설정 완료와 구분하며 [고객 로그인 최신 요구](customer-auth-setup.md)를 기준으로 한다. 온라인 검증 환경, 테스트 결제 채널, 실제 인증 설정 등이 필요해지면 그때 대상·비용 유무·직접 해야 할 동작을 안내한다.

상태 표시는 다음처럼 사용한다.

- `미결정`: 사용자 선택이 필요함
- `계정 필요`: 외부 서비스 가입/권한 필요
- `검증 필요`: 실제 계정·기기·환경에서 확인 필요
- `승인 필요`: 법무/사업/스토어 등 책임 있는 승인 필요

## 2026-09-09 최신 결제 준비: 포트원 → KG이니시스

사용자가 지정한 포트원 계정에서 사업자 정보 등록·PG 신청 완료와 **KG이니시스 신용카드 일반결제 입점 심사중**을 확인했다. 대표상점의 실연동/테스트 채널은 모두 아직 등록되지 않았다. 후속 연동 계획은 PortOne V2를 우선하며, Supabase 중심 백엔드는 유지한다. 상세 구현 순서와 이전 직접 연동 자료의 구분은 [KG이니시스 연동 문서](kg-inicis-integration.md#최신-준비-상태--portone-경유--2026-09-09)를 따른다.

- **사업 운영자(친구):** 심사 보완 요청·실제 판매 방식 승인·계약/정산 정보를 확인한다. 실연동에 필요한 포트원 이용료 결제 카드와 요금 조건도 운영자가 확인·등록한다. 이번에는 계약·카드 등록·유료 설정을 변경하지 않았다.
- **개발 담당:** 테스트 채널 준비, V2 API/SDK·서명 검증·조회 대사·취소/환불을 구현하고 마지막에 로컬 및 실제 테스트 결제를 검증한다. 비밀값은 채팅·Git·앱 public 설정 대신 승인된 서버 비밀 설정으로 전달한다.
- **이번 확인의 한계:** 채널이나 키를 만들지 않았고 실제 결제 연동 코드는 아직 변경하지 않았다. 기존 결제 차단을 유지한다. 아래 직접 KG 조회 테스트 수치는 이전 단계 기록이다.

## 이전 단계 기록: KG 직접 거래조회

사용자는 Google Cloud 작업을 보류하고 다음 단계로 진행하도록 요청했으며, PG를 **KG이니시스**로 선택했다. 계약·테스트 MID·비밀키·실거래 승인이 준비됐다는 뜻은 아니다. 이번 단계는 KG 거래조회와 worker의 기존 결제 상태 대조 연결이며, 고객 결제창·승인·취소·환불 요청을 열지 않는다. 설정 이름, 실제 준비 항목과 검증 범위는 [KG이니시스 연동 문서](kg-inicis-integration.md)를 따른다.

Google Cloud 결제 연결·API 활성화·배포·secret 생성, Supabase staging 재시도·기존 프로젝트 중지·유료 전환은 진행하지 않는다. 기존 Supabase 운영 DB와 로컬 개발 환경은 보존한다.

이번 조회 연결 검증은 worker 77개 통과(실제 로컬 DB 포함, 생략 0개), build·모바일 TypeScript·보호 runtime 28개 통과다. 루트 전체 검사는 528개 중 522개 통과·모바일 관련 6개 실패이며, 해당 모바일 변경과 함께 별도 진단해야 한다. 아래 DBB015의 528개 통과 기록은 이전 단계 결과로, 이번 전체 결과를 대체하지 않는다. 실제 KG 거래·결제창·승인·취소·환불은 아직 검증하지 않았다.

## 2026-09-09 운영 worker·staging 준비

- Supabase 실제 조회: 서울 `DABBOBA` 프로젝트(`yxkmvgfruphgghowzvmo`)는 정상 상태이며, 별도 staging 프로젝트·branch는 없다. 운영 `dabboba_worker`는 여전히 `NOLOGIN`, API 역할은 `LOGIN`이다. 기존 보호 파일에 `WORKER_DATABASE_URL`은 없다.
- 사용자가 staging의 조직으로 `DBBOBA [다뽀바]`를 선택했고, 월 `0` 견적 안내 후 “진행해줘”로 서울 `DABBOBA-STAGING` 생성을 승인했다. 비용 재조회도 월 `0`이었으나 실제 생성은 조직 관리자/소유자 계정의 **활성 무료 프로젝트 2개 한도**로 거부됐다. 생성 후 목록 재조회에도 운영 프로젝트 하나만 있으며 staging은 생성되지 않았다. 무료 견적은 생성 가능 수량을 보장하지 않는다. 기존 프로젝트 중지·삭제·유료 전환은 하지 않았으며 별도 선택·승인 없이 수행하지 않는다.
- Google Cloud 전용 프로젝트 `dabboba-app-20260906`(`DABBOBA`)는 존재하지만 **billing 비활성 / Secret Manager API 비활성**이다. 예전 문서의 “DABBOBA 프로젝트 없음”은 더 이상 현재 상태가 아니다. CLI 기본값 `findy-staging`은 다른 앱이므로 사용하지 않는다.
- Google Cloud는 Supabase 사용 자체의 필수 조건이 아니다. 기존 배포 설계에서 Supabase는 DB·Auth·Storage·Queues를, Cloud Run은 별도로 구현한 API와 worker 실행을 맡는다. 로컬 개발과 Supabase 프로젝트 생성에는 GCP 결제 연결이 필요 없다. **현재 Cloud Run 배포 경로를 선택해 실제 배포할 때** [DABBOBA 결제 설정](https://console.cloud.google.com/billing/linkedaccount?project=dabboba-app-20260906) 및 비용 한도가 필요하다. 다른 호스팅이나 Supabase Edge Functions로 바꾸려면 실행 방식·배포 절차 변경을 별도로 검토한다. 현재는 GCP 변경을 보류하며 카드·비밀번호·DB URL을 채팅에 붙이지 않는다.
- 운영 데이터·권한·비밀번호·API 활성화·결제 연결·worker 실행·예약·배포는 이번 준비 조회에서 변경하지 않았다. 기존 로컬 개발 프로필과 실행기를 그대로 사용한다.

이번 로컬 구현(DBB015)은 완료했다. Worker 최초 준비가 이미 LOGIN인 계정의 비밀번호를 자동 변경하지 않도록 차단했고, 원격 준비에는 독립적으로 승인한 대상 hash·명시적 환경 용도·인증서 검증 TLS·Session 5432를 요구한다. 원격/로컬 오연결과 비밀 오류 출력 방지도 보강했다. 자세한 명령은 [운영 런북](dabboba-operations-runbook.md#worker-최초-login-준비와-비밀번호-회전-구분)에 있다.

마지막 검증: DB build 성공, DB 테스트 86 통과·0 실패·통합 6건 미실행(별도 통합 DB URL 미제공), 새 준비 안전장치 테스트 6건 포함. 웹 build·모바일 TypeScript·보호 runtime 28개·루트 테스트 528건·workspace 구조·diff 공백 검사 통과. 별도 실제 로컬 PostgreSQL 읽기 전용 연결에서 기존 LOGIN 거부와 원래 worker 비밀번호의 인증 유지도 확인했다. 실제 CLI의 원격 대상 확인값 누락 차단·비밀 미출력도 통과했다. 운영 worker 로그인 성공, NOLOGIN에서의 실DB 최초 설정, 회전의 실DB 성공, staging 통합·배포를 검증했다는 뜻은 아니다. 최초 설정·회전 성공 및 SQL 실패 rollback은 단위 대역으로 확인했다.

## 2026-09-08 최종 정리: 다음 진행 순서

이번 DB·API 안전성 보강 및 운영/개발 환경 분리와 로컬 검증은 완료했다. 개발 API·worker는 새 전용 로컬 PostgreSQL을 사용하고, 기존 운영 연결 파일·데이터와 기존 로컬 DB·LOGIN은 보존했다. 상세 결과는 [출시 체크포인트](backend-release-readiness-2026-09-08.md)의 환경 분리 최종 검증 표를 따른다. 아래 외부 선택과 승인 없이는 실제 출시 완료로 처리하지 않는다.

| 순서 | 사용자가 준비·결정할 것 | 준비 뒤 이어서 할 구현·검증 |
| --- | --- | --- |
| 1 | 현재 Supabase를 출시용으로 보호하는 방향은 2026-09-08 사용자 승인 완료. 남은 것은 운영 worker 전용 비밀값을 안전한 저장소에 준비하는 일 | 개발/테스트 연결은 별도 로컬로 분리. 별도 운영 변경 승인 후 worker LOGIN·전용 연결과 3종 실제 제한 역할·TLS 검증. 운영 `WORKER_DATABASE_URL`은 아직 없음 |
| 2 | KG이니시스 선택 완료. 테스트 상점·키·이용 가능 API 및 결제·환불 정책 준비 | KG 거래조회부터 연결하고 승인·취소·환불·정산을 순차 구현·검증. 현재 실결제는 비활성 상태 유지 |
| 3 | Kakao/Naver/SMS, private Storage, push 계정과 운영 주소 준비 | 기존 인증·미디어·알림 연결을 실제 공급자에서 확인하고 계약 차이를 수정. 비밀값을 앱·채팅·Git에 입력하지 않음 |
| 4 | 최초 관리자·권한표·MFA 방식, 신뢰 ingress/WAF, 운영 책임자와 별도 백업 장소 결정 | 승인된 MFA 구현, 실제 IP 분리·rate limit·권한·경보·별도 환경 복원 확인 후 배포. 현재 같은 Mac의 백업은 외부 재해 복구가 아님 |
| 5 | 승인된 상품·가격·실물 재고·상업 이용 권리, 약관과 스토어 계정 준비 | 실제 운영 상품 등록과 확률표 공개 승인, iPhone/Android 실기기·PG sandbox·스토어 심사 흐름 최종 확인 |

### 남은 코드 수정과 위험

- **필수 추가 구현:** KG이니시스 결제창·승인·취소·환불 연동, 승인된 관리자 MFA. KG 거래조회와 실결제 연동 완료를 구분한다. 사용자가 직접 코드를 수정할 항목이 아니라 외부 준비 후 개발을 이어갈 항목이다.
- **의존성 수정:** Expo Router 하위 `decode-uri-component@0.2.2`의 moderate 경고 1건이 남는다. 현재 native 입력 완화는 유지하되 지원되는 업그레이드와 실제 로그인/deep-link 회귀 후 해소한다. 무리한 전체 override로 통과 표시하지 않는다.
- **연결 후 확인:** SMS/OAuth·Storage·push·배송 공급자의 실제 계약과 맞지 않는 부분이 있으면 해당 adapter를 수정한다. 계정 설정만으로 모든 연동이 검증됐다고 보지 않는다.
- **데이터·자산 교체:** 현재 고객 catalog는 의도적으로 비어 있다. 비활성화한 개발 상품을 다시 켜지 말고 승인받은 상품·이미지·실재고로 등록한다.

아래 상세 체크리스트는 계정 준비·실환경 증거가 생길 때만 완료로 바꾼다.

### 지금 설정 파일을 직접 바꿀 필요가 있는가?

일반 로컬 개발에는 없다. 기존 `DABBOBA 열기.command`를 사용하고 자동 생성된 `.env.development.local`을 그대로 둔다. 기존 운영 `.env`를 source하거나 새 로컬 파일에 운영 URL·key를 붙이지 않는다. 로컬은 실제 카카오·네이버·문자 인증이나 결제 성공을 제공하는 환경이 아니며, 별도 개발 로그인과 빈 상품 목록이 정상이다.

다음 외부 준비 때 필요한 값은 운영 worker 전용 연결 정보, 별도 online staging 용도·비용 한도, PG 및 인증·Storage·push 공급자 설정이다. 값은 채팅이 아니라 승인된 secret manager/환경 설정으로 제공한다. 운영 실행은 `NODE_ENV=production`과 `DABBOBA_ENVIRONMENT_TIER=PRODUCTION`, worker의 별도 실행 허용값을 사용하는 검토된 배포 경로로 진행하며, 플래그를 수동으로 켜는 것만으로 출시 승인을 대신하지 않는다. 현재는 그 운영 변경을 실행하지 않았다.

## 1. 서비스 주소와 인프라

- [ ] `미결정` 운영 고객 웹, API, 관리자 웹 hostname 결정
- [ ] `계정 필요` DNS/TLS/CDN/WAF를 제공할 클라우드 계정과 결제 수단 준비
- [ ] `계정 필요` 서울 또는 확정 region의 Supabase 조직·project와 billing 준비
- [ ] `검증 필요` Supabase PostgreSQL backup/PITR, connection 방식과 application 최소 권한 role 확인
- [ ] `검증 필요` Supabase Queues(`pgmq`) 활성화와 worker 전용 접근 권한 확인. Redis는 실제 필요가 측정되기 전 만들지 않음
- [ ] `미결정` DB RPO, RTO, backup 보존 기간, 삭제 보호, 복구 승인자 결정
- [ ] `검증 필요` production CORS allowlist에 정확한 HTTPS origin만 입력
- [ ] `계정 필요` 중앙 로그, 오류 추적, metric/alert, on-call 알림 destination 준비
- [ ] `검증 필요` 별도 환경에서 PostgreSQL 복원 훈련 후 시간과 누락 기록
- [ ] `검증 필요` 신뢰할 proxy 범위/hop을 확정해 외부 forwarding header를 제거·덮어쓰거나, edge/WAF가 실제 client IP별 일반 API rate-limit을 담당하도록 구성하고 spoofing·IP 분리 통합 테스트 수행
- [ ] `검증 필요` CI/EAS가 저장소에 고정된 pnpm과 루트 `pnpm-lock.yaml`을 사용하는지 확인한다. native intent의 입력 길이·percent-encoding 완화는 코드에 적용됐지만 Expo Router→`query-string@7`→`decode-uri-component@0.2.2` 경로의 moderate DoS advisory(`GHSA-vcc3-ghjq-m6fr`)는 audit에 남아 있으므로, 지원되는 Expo 업그레이드와 실기기 회귀를 완료하고 잔존 위험을 승인

필요한 결과물: production URL 목록, 네트워크 구성, secret manager 위치, 운영 담당자, 복원 훈련 기록. 클라우드 관리자 비밀번호나 DB URL 원문은 문서에 적지 않는다.

2026-09-08 앞선 원격 DB 확인: migration 40개 checksum 일치, application table 77개 RLS 활성, `anon`·`authenticated`의 해당 테이블 접근 grant 노출 0개. API는 runtime LOGIN 계정, migration은 별도 owner 계정이지만 worker 역할은 NOLOGIN이고 `WORKER_DATABASE_URL`은 없었다. 이후 사용자는 현재 Supabase를 출시용으로 보호하고 개발·테스트를 분리하는 방향을 승인했다. 용도 결정만으로 위 인프라 항목을 일괄 완료 처리하지 않는다. 다음 운영 연결 단계는 **승인된 worker 계정·비밀값 준비 → 실제 제한 역할 검증**이며, 비밀값은 채팅에 붙이지 않는다.

일반 API의 Fastify `trustProxy`는 현재 의도적으로 `false`다. 실제 ingress 경계가 확정되기 전에 애플리케이션에서 임의로 켜면 공격자가 보낸 forwarding header를 rate-limit identity로 신뢰할 수 있다. 반대로 여러 사용자가 하나의 ingress socket IP로 합쳐지는 배포에서는 정상 사용자끼리 rate-limit 예산을 공유할 수 있다. 신뢰 proxy 또는 edge/WAF 구성과 아래 통합 증거가 없으면 출시를 차단한다.

현재 Metro/PostCSS high advisory와 기존 `uuid` moderate advisory는 호환 patch override로 제거되어 있다. 2026-09-08 `pnpm audit --prod --audit-level moderate`에서 high/critical은 0이지만, 네트워크로 전달된 비정상 percent-encoding으로 CPU를 과다 소모할 수 있는 `decode-uri-component@0.2.2` moderate 1건이 남았다. 네이티브 진입점은 Expo Router가 파싱하기 전에 전체 URL을 4096자로 제한하고 내장 decoder로 malformed percent escape와 UTF-8을 한 번 검증하며, 거부 시 cold start는 `/`, warm event는 `null`로 처리한다. 이는 취약 경로에 도달하는 입력을 제한하는 코드 완화일 뿐 dependency나 audit 항목을 제거하지 않는다. 패치된 `0.5.0`은 ESM-only이고 현재 Expo Router가 CommonJS `query-string@7.1.3`을 요구하므로 전역 override는 런타임을 깨뜨릴 수 있다. 지원되는 Expo Router 상위 업그레이드를 우선하고, 그 전에는 실제 iPhone/Android에서 cold·warm deep link와 `dabboba://auth/callback` 회귀를 확인한 뒤 잔존 위험을 승인해야 한다. 저장소는 pnpm workspace와 루트 lockfile 하나로 통일됐으며 실제 EAS 환경에서도 같은 경계를 확인해야 한다.

## 2. 사용자 로그인과 계정

- [ ] `계정 필요` 서울 또는 확정 region에 Supabase project를 만들고 project URL과 publishable key를 준비. secret/service-role key는 앱·채팅·저장소에 입력하지 않음
- [ ] `검증 필요` Supabase Auth JWT signing key가 JWKS로 검증 가능한 비대칭 키(ES256/RS256)인지 확인
- [ ] `계정 필요` Kakao Developers 앱과 Naver Developers 앱을 만들고 각 client ID/secret을 Supabase Auth에만 등록
- [ ] `검증 필요` Kakao·Naver 모두 이메일 권한 없이 사용할 수 있게 구성하고, Supabase의 이메일 없는 사용자 허용 설정을 확인
- [ ] `설정 필요` Google·Apple 로그인 공급자와 이메일 인증번호용 메일 발송 설정 준비. SMS·국내 본인확인 계약은 이번 범위에서 제외
- [ ] `검증 필요` Supabase redirect allow list에 `dabboba://auth/callback`, 각 소셜 공급자에 `https://<project-ref>.supabase.co/auth/v1/callback` 등록
- [ ] `구현·검증 필요` 승인된 SNS 명시적 연결·해제, 계정 간 충돌 거부, 마지막 로그인 수단 보호 및 Supabase 자동 연결 경계 검증
- [ ] `미결정` 연령 제한, 보호자 동의, 계정 복구, 휴대폰 번호 변경, 탈퇴/보존 정책 승인
- [ ] `검증 필요` development build와 실제 provider sandbox에서 신규 가입, 재로그인, 취소, cold/warm callback, 정지, 탈퇴, 번호 변경을 확인
- [ ] `구현·검증 필요` Apple 로그인 추가 방향은 승인됨. iOS 출시 전에 동등한 로그인 선택지와 실제 인증·탈퇴 동작 검증

변경 전 앱과 API에는 카카오·네이버·한국 휴대폰 OTP, Supabase PKCE/OTP, 비대칭 JWT 검증, canonical user 연결, DABBOBA session 교환이 구현돼 있었다. 최신 다섯 방식과 계정 연결의 실제 구현 상태는 `docs/customer-auth-setup.md`를 따른다. 실제 공급자 설정·메일 발송·기기 통합 검증은 로컬 코드 검사만으로 완료 표시하지 않는다. 본인확인은 도입하지 않는다.

## 3. 관리자 계정과 운영 조직

- [ ] `미결정` 최초 `SUPER_ADMIN` 실명 담당자와 비상 대리인 지정
- [ ] `미결정` 회원/문의/신고/카탈로그/감사별 최소 권한표 승인
- [ ] `검증 필요` 첫 관리자를 일회성 bootstrap으로 만든 뒤 bootstrap 환경값 제거
- [ ] `검증 필요` 신뢰 edge가 선택한 전용 client-IP header를 외부 요청에서 제거·덮어쓰도록 설정하고, BFF/API에 동일한 `ADMIN_PROXY_IDENTITY_SECRET`을 secret manager로 주입
- [ ] `검증 필요` BFF/API 시계 동기화와 운영 로그인에서 IP별 rate-limit·감사 IP/UA가 실제 edge 경로 기준으로 분리되는지 확인
- [ ] `검증 필요` `USER`의 관리자 API 거부, `ADMIN`의 관리자 생성/역할 변경 거부, 정지 계정 session revoke 확인
- [ ] `미결정` 관리자 MFA와 비상 접근 정책 결정
- [ ] `미결정` 개인정보 열람 사유, 감사 로그 검토 주기, 관리자 퇴사/권한 회수 SLA 결정

현재 관리자 로그인은 강한 비밀번호와 server-only session 경계를 제공하지만 MFA는 구현돼 있지 않다. 공개 운영 전 MFA 방식과 구현 범위를 승인해야 한다.

## 4. 결제, 환불, 정산

- [x] `선택 완료` KG이니시스 선정 — 2026-09-09 사용자 응답
- [ ] `계정 필요` KG 심사, 테스트/운영 merchant 계정과 정산 계좌 준비
- [ ] `계정 필요` client/secret key, webhook signing secret, provider event 규격을 secret manager에 등록
- [ ] `미결정` 카드/간편결제 수단, 최소 결제액, 실패/재시도, 부분취소, 전액환불 정책 결정
- [ ] `미결정` 포인트·쿠폰 회계/만료/환불 정책과 CS 보정 승인 절차 결정
- [ ] `미결정` 가챠·쿠지 청약철회, 확률 공개, 품절/오배송/미수령 처리 정책 법률 검토
- [ ] `미결정` 유한 경품의 확률을 조회·결제·실제 추첨 중 어느 시점의 잔여 수량으로 확정할지 승인. 현재 코드는 결제 시 공개 버전을 고정하고 실제 추첨 시 같은 버전의 잔여 수량으로 계산함
- [ ] `검증 필요` sandbox 승인·실패·지연·중복 webhook·서명 오류·금액 불일치·환불·조정 흐름 확인
- [ ] `검증 필요` 연결된 고객 이어 뽑기 화면에서 결제 후 미사용 `AVAILABLE` 추첨권이 브라우저/앱 새로고침과 재로그인 뒤 다시 표시되고 한 번만 소비되는지 실제 PostgreSQL·PG sandbox에서 확인
- [ ] `검증 필요` live 전환 전 소액 실거래, 정산, 취소, 세금/영수증 흐름을 담당자가 확인

현재 generic webhook·원장을 유지하면서 KG의 거래조회와 worker 상태 대조부터 연결한다. KG의 실제 승인 API·callback·취소·환불은 아직 연결되지 않았다. `PAYMENT_PROVIDER=UNCONFIGURED`인 환경에서는 API도 주문 생성을 거부하며, 공급자 구현과 테스트 상점 증거 전에는 실결제를 열면 안 된다. 키를 채팅이나 앱 public 설정에 넣지 않는다.

## 5. 미디어, IP, 상품 데이터

- [ ] `계정 필요` private Supabase Storage bucket, server-only secret key 보관 위치, 필요 시 CDN 준비
- [ ] `미결정` 원본/변형 파일 보존 기간, 바이러스/유해물 검사와 이미지 변형 공급자 결정
- [ ] `검증 필요` durable intent/complete same-key replay·다른 payload 충돌·만료 처리, 제한된 signed upload, 사용자 쿼터, 크기/checksum/MIME 검증, orientation/EXIF 제거·압축·thumbnail·staging 재삭제를 실제 Supabase Storage에서 확인
- [ ] `검증 필요` 실제 Supabase Storage에서 미연결 소유 미디어 삭제와 worker 재시도, 타인 object 차단, 연결 미디어 보존, RLS/최소 권한, 유해물 검사·CDN·삭제 정책을 확인
- [ ] `승인 필요` 모든 애니메이션·게임 IP, 캐릭터, 상품명, 이미지, 로고의 상업 이용 권리 확보
- [ ] `승인 필요` `public/assets/dabboba/**/sources.json`의 prototype 참고 이미지를 승인 자산으로 교체
- [ ] `미결정` 상품 SKU, 판매가, 세금, 실재고, 배송 크기/무게의 승인 담당자 지정
- [ ] `자료 필요` 가챠·쿠지별 실제 경품 SKU·등급·기본 가중치·검수 수량·이미지와 물리 lot 대조표 준비
- [ ] `승인 필요` 확률표 DRAFT의 자료 대조와 ACTIVE 공개를 담당할 운영자 2인 지정

로컬 fixture와 출처 기록은 라이선스 증명이 아니다. 권리 확인 전 공개 사이트, 광고, 앱스토어 screenshot, 실판매에 사용하지 않는다.

## 6. 배송과 고객지원

- [ ] `계정 필요` 택배/풀필먼트 공급자와 계약, 송장 API/반품 주소 준비
- [x] `정책 확정` 무료배송 기준 미달 시 기본 배송비 3,000원 — 2026-09-14 사용자 승인
- [ ] `미결정` 출고 SLA, 도서산간 추가비, 합배송, 분실/파손, 교환/반품 정책 승인
- [ ] `구현·검증 필요` 배송비 결제대기 상태, 3,000원 결제 원장 연결, 서명 검증 완료 뒤에만 출고 요청 활성화, 실패·취소·중복 콜백 복구 검증
- [ ] `미결정` 고객센터 운영 시간, 문의 SLA, 신고/저작권/사기 escalation 담당자 결정
- [ ] `미결정` 교환방에서 금지할 품목, 직거래/현금 유도, 미성년자, 분쟁 처리 정책 승인
- [ ] `검증 필요` 문의 작성→관리자 답변→사용자 확인과 신고→제재→감사 로그를 운영자 교육 계정으로 확인
- [ ] `검증 필요` 연결된 고객 배송 이력/상세 화면에서 자기 신청만 보이는지, 상태·마스킹 주소·출고 시각·송장이 택배/풀필먼트 원장과 일치하는지 확인

## 7. 알림과 실기기

- [ ] `계정 필요` APNs, FCM 또는 선택한 push 공급자 계정/키 준비
- [ ] `미결정` 항상 켜지는 필수 주문 알림과 교환·신청·재입고·마케팅·맞춤 추천 선택 알림을 분리하고, append-only 동의 변경 evidence의 표시 문구·보존 기간·처리 근거를 법무와 승인
- [ ] `검증 필요` 연결된 remote 고객 수신 설정 화면에서 선택 해제가 version 충돌/재시도에서도 정확히 저장되고, 인앱 필수 기록은 유지하면서 외부 선택 전달만 차단되는지 실제 알림 공급자 sandbox에서 확인
- [ ] `검증 필요` 실제 iPhone/Android에서 로그인, 딥링크 cold/warm start, 외부 URL, 결제 복귀, 업로드, push 확인
- [ ] `검증 필요` 네트워크 끊김과 session refresh 일시 실패/재시도, 앱 background/kill, 중복 tap, reduced motion, 접근성 글자 크기 확인

Expo Go 확인은 standalone/store build와 custom scheme의 운영 증거가 아니다.

## 8. Apple/Google 스토어

- [ ] `계정 필요` 친구 명의 Apple Developer 계정과 App Store Connect 소유자 권한, 인증서/프로비저닝/EAS 자격 준비. 현재 개발자 개인 Team `52HC8BV2BL`은 출시용으로 사용하지 않음
- [ ] `계정 필요` 친구 명의 Google Play Console 계정과 앱 소유권, signing, service account 준비
- [ ] `미결정` bundle ID/package name, 앱 이름, 연령 등급, 카테고리, 지원 URL 확정
- [ ] `승인 필요` 개인정보 처리방침 URL, 이용약관 URL, 계정 삭제 웹 경로, 사업자/고객지원 정보 공개
- [ ] `승인 필요` 스토어 데이터 안전/프라이버시 라벨, 광고/추적 여부, 결제 정책 답변 검토
- [ ] `검증 필요` TestFlight와 Play internal testing에서 실제 기기 회귀 테스트와 심사 자료 확인

## 9. 법무와 사업 운영

- [ ] `승인 필요` 사업자 정보, 통신판매업, 전자상거래 표시, 세금/영수증 요건을 전문가와 확인
- [ ] `승인 필요` 이용약관, 개인정보 처리방침, 마케팅 동의, 수집 항목·목적·보유 기간·처리위탁·국외 이전 검토
- [ ] `승인 필요` 확률형 상품 공개, 구매 한도, 미성년자, 환불/청약철회, 소비자 분쟁 정책 검토
- [ ] `승인 필요` UGC 신고, 차단, 저작권 통지, 불법 콘텐츠, 수사기관 요청 처리 절차 검토
- [ ] `승인 필요` IP 라이선스, 재판매/교환, 상품 표시·정품성·리콜 책임 검토
- [ ] `미결정` 약관/정책 시행일과 버전 변경 고지 책임자 지정

이 저장소의 법률 문구와 체크리스트는 법률 자문이 아니다. 실제 사업자 정보, 공급자, 보존 기간, 거래 조건을 넣고 관할 전문가 승인을 받아야 한다.

## 10. 출시 승인 회의에서 받아야 할 증거

- [ ] CI 성공 commit과 배포 artifact 식별자
- [ ] 운영 migration 결과와 schema version
- [ ] 최근 backup/PITR 상태와 restore drill 기록
- [ ] auth provider sandbox 결과
- [ ] PG sandbox 및 소액 live 거래/환불/정산 결과
- [ ] 관리자 부정 권한 테스트와 감사 로그 결과
- [ ] 실제 ingress 경로에서 일반 API의 서로 다른 client IP 예산 분리, 단일 IP 429 제한, forwarding header spoofing 거부 결과
- [ ] 실제 iPhone/Android 핵심 흐름 결과
- [ ] IP 자산 권리 목록과 법률 문서 승인본
- [ ] 장애 연락망, on-call, alert 수신 증거
- [ ] 출시/중단 권한자 서명

이 증거가 없는 항목은 `미완료`로 남긴다. 로컬 화면, fixture, 시뮬레이터, CI migration만으로 production readiness를 선언하지 않는다.
