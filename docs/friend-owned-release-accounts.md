# DABBOBA 친구 명의 출시 계정 전환대장

> 기준일: 2026-09-22
> 최종 결정: DABBOBA의 출시·운영·정산 주체는 사용자가 지정한 친구 또는 그 친구가 대표·통제하는 것으로 확인된 사업자다. 개발자는 비밀번호를 공유받는 소유자가 아니라 필요한 범위의 협업자로만 참여한다.

이 문서는 코드 설정이 되어 있다는 사실과 **친구 명의 소유권이 확인됐다**는 사실을 구분한다. 비밀번호, 복구 코드, 주민등록번호, 인증서 원문, API secret, 서비스 계정 JSON은 이 문서나 Git에 기록하지 않는다.

## 현재 전환 상태

| 서비스 | 현재 확인된 상태 | 친구 명의 출시 판정 | 다음 완료 조건 |
| --- | --- | --- | --- |
| 사업자·법적 고지 | 앱과 공개 정책에는 한 사업자 정보가 설정돼 있음 | 미확인 | 해당 사업자의 대표·통제 주체가 지정한 친구인지 본인이 확인하고 스토어 판매자·PG·정산·세금 주체와 일치시킴 |
| Apple Developer / App Store Connect | 개발자 개인 Team `52HC8BV2BL`에 `com.dabboba.mobile`과 배포 자격증명이 있음 | 사용 금지 | 친구 명의 유료 팀의 Account Holder·Team ID 확인 후 아래 Bundle ID 전환 절차 완료 |
| Google Play Console | 친구 명의 앱 레코드·소유권·제출 계정 증거 없음 | 차단 | 친구 명의 계정에서 앱 생성, 계약·신원·결제 프로필 확인, 개발자를 최소 권한 사용자로 초대 |
| Expo / EAS | `@dabboba-team/dabboba-mobile` 연결됨. 현재 개발자 계정 `kyoungminoh`가 Owner 권한을 보유 | 미확인 | 친구 계정을 조직 Owner와 복구·MFA·billing 주체로 확인한 뒤 개발자 권한 축소 |
| GitHub | private 저장소 `rudals906377/DABBOBA`; 현재 확인된 collaborator는 개발자 개인 계정 하나 | 사용 금지 | 친구 계정 또는 친구 소유 조직으로 저장소를 안전하게 이전하고 branch protection·Actions·환경값 재검증 |
| Cloudflare Pages / DNS | `dabboba.net`·`www`·Pages 배포와 Email Routing 동작은 확인. 운영 계정은 단독 Super Admin이지만 지정 친구의 계정인지와 2FA 상태는 미확인이고 로컬 Wrangler는 다른 계정임 | 미확인 | Account Super Administrator, 복구 이메일, 2FA, 도메인 갱신·결제 주체가 친구임을 계정 화면에서 확인; 그 전에는 로컬 Wrangler로 운영 배포 금지 |
| 도메인 등록기관 | `dabboba.net` 구매·DNS 연결됨 | 미확인 | registrant와 갱신 결제·만료 알림 소유자가 친구 또는 친구가 대표·통제하는 사업자인지 확인 |
| Supabase | 저장소 설정과 일치하는 프로젝트·조직은 존재하지만 친구의 조직 Owner 증거 없음 | 미확인 | 친구를 조직 Owner·billing/recovery 주체로 확인하고 개발자·런타임 권한을 최소화 |
| 로그인 제공자 | 운영 Kakao·Naver·Google·Apple 앱 소유권 증거 없음 | 차단 | 실제 노출할 제공자별 앱을 친구 사업자 계정으로 만들고 redirect·심사·복구·MFA 확인 |
| 푸시 | APNs/FCM 운영 키와 친구 명의 소유권 증거 없음 | 차단 | 친구 명의 Apple/Google 프로젝트에서 키를 만들고 EAS·서버에 비밀로 연결 |
| 고객지원 메일 | `support@dabboba.net` MX/SPF와 수신 전달 1건은 확인됐으나 공개 발신, DKIM/DMARC와 최종 관리자 소유권은 미확인 | 미확인 | 친구가 라우팅·수신함·2FA를 통제하고 지원 주소로 발신·회신까지 검증 |
| PortOne / KG이니시스 | 신청·심사 이력은 있으나 친구 명의 merchant·정산 주체인지 증거 없음 | LIVE 차단 | 친구 사업자, PG 계약자, 정산 계좌, 세금 주체의 일치 확인 후 채널·웹훅·취소·환불·대사 검증 |
| 은행·정산·세금 | 출시 근거 없음 | LIVE 차단 | 친구 또는 동일 사업자 명의 계좌·세금·영수증·통신판매 정보를 운영 담당자가 확인 |

`미확인`은 서비스가 동작하지 않는다는 뜻이 아니라, 현재 증거만으로 친구 명의라고 판정하지 않는다는 뜻이다. `사용 금지` 또는 `차단` 항목은 친구 명의 대체 계정이 검증되기 전 공개 서명·제출·실결제에 사용할 수 없다.

현재 엄격한 증거 기준으로 친구 명의가 완료된 외부 서비스는 **0개**다. 연결됨, 배포됨, 관리자 접근 가능은 법적 소유권 완료와 같은 뜻이 아니다.

## Apple Bundle ID 안전 전환

현재 `com.dabboba.mobile`은 개발자 개인 팀에 등록돼 있다. Apple의 일반 앱 이전은 App Store에 출시된 버전이 하나 이상 있어야 하며, DABBOBA에는 그런 출시 기록이 없다. 따라서 아직 일반 앱 이전을 시도하지 않는다.

1. 친구 명의 Apple Developer Program 유료 가입과 Account Holder, Team ID를 확인한다.
2. 현재 팀에서 이 App ID가 App Store Connect에 업로드된 적이 없는지와 Sign in with Apple 그룹 상태를 확인한다.
3. Apple이 제거를 허용하는 미사용 App ID라면, 사용자의 별도 확인 뒤 기존 프로비저닝 프로파일과 App ID를 제거한다.
4. 친구 팀에서 같은 Bundle ID를 등록할 수 있는지 확인하고 새 인증서·프로비저닝을 만든다.
5. 같은 ID 재등록이 불가능하면 새 Bundle ID를 선택하고 Expo, 딥링크, Apple 로그인, 푸시, OAuth redirect, 스토어와 향후 PG 설정을 한 번에 갱신한다.
6. 친구 팀으로 서명된 IPA와 TestFlight 업로드가 확인된 뒤에만 기존 개발자 자격증명을 폐기한다.

근거: [Apple App ID 삭제 조건](https://developer.apple.com/help/account/identifiers/delete-an-app-id), [Apple 앱 이전 조건](https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria).

## 계정별 완료 증거

각 서비스 전환은 아래 다섯 항목을 모두 충족해야 완료로 표시한다.

- 친구가 Owner, Account Holder 또는 동등한 최상위 소유자로 표시된다.
- 친구가 본인의 복구 수단과 MFA를 직접 통제한다.
- 결제·갱신·세금 또는 billing owner가 필요한 서비스는 친구 또는 동일 사업자와 일치한다.
- 개발자는 필요한 최소 역할로 다시 초대되고, 개인 계정 단독 소유 상태가 해소된다.
- 비밀이 아닌 계정·조직·팀·프로젝트 ID와 확인 날짜만 출시 기록에 남긴다.

## 전환 순서

1. 친구의 법적 사업자 주체와 공개 사업자 정보 일치 확인
2. Apple Developer와 Google Play 소유 계정 확보
3. GitHub와 Expo/EAS 소유권 이전
4. Cloudflare·도메인·지원 메일과 Supabase 소유권 확인 또는 이전
5. 로그인·푸시 공급자 전환
6. 친구 계정으로 PRELAUNCH 서명 빌드와 실기기 검수
7. 스토어 내부 테스트 승인
8. 이후에만 PortOne·KG이니시스·정산·세금 계정으로 LIVE 결제 전환

한 서비스를 옮길 때마다 복구 가능한 상태를 유지하고, 대체 계정 접근과 빌드/배포를 확인하기 전 기존 계정·키·프로젝트를 삭제하지 않는다.
