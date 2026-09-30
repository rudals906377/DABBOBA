# DABBOBA Cloudflare Pages 소유권 이전 체크리스트

이 문서는 공개 정책 사이트가 **서비스 소유자인 친구의 Cloudflare 계정**에서 운영되도록 확인하거나 이전할 때 사용하는 체크리스트다. 현재 계정에 배포된 `https://dabboba.pages.dev`는 기술 검수에는 사용할 수 있지만, 계정 소유자와 결제 주체가 친구라는 증거가 확인되기 전에는 최종 서비스 소유권으로 간주하지 않는다.

## 1. 계정과 권한

- 친구가 본인 이메일로 Cloudflare 계정을 만들고 계정 소유자가 된다.
- 계정 생성 직후 2단계 인증(2FA)을 켜고 복구 코드를 안전한 곳에 보관한다.
- 비밀번호, 복구 코드, 전체 API 토큰을 다른 사람과 공유하지 않는다.
- 협업이 필요하면 비밀번호 공유 대신 Cloudflare 멤버 초대와 최소 권한을 사용한다.
- GitHub 연결도 친구 또는 서비스 조직이 소유한 계정에서 승인한다. 개인 개발자 계정만 승인 주체로 남기지 않는다.

## 2. Pages 프로젝트 소유권 확인 또는 새 프로젝트 만들기

현재 계정이 친구 소유로 확인되면 기존 Git 연동 프로젝트를 유지할 수 있다. 확인되지 않거나 다른 사람 소유라면 친구 계정에서 **Git 연동 방식**의 새 프로젝트를 만든다. Cloudflare도 Direct Upload 프로젝트를 나중에 Git 연동 프로젝트로 변경할 수 없다고 안내한다.

[Cloudflare Git 연동 안내](https://developers.cloudflare.com/pages/configuration/git-integration/) · [Direct Upload 제한](https://developers.cloudflare.com/pages/get-started/direct-upload/)

Pages 생성 화면에 아래 값을 그대로 입력한다.

| 항목 | 값 |
| --- | --- |
| 배포 방식 | GitHub 연동 |
| 저장소 | DABBOBA 운영 저장소 |
| 운영 브랜치 | `main` |
| 프로젝트 루트 | `/` |
| 프레임워크 프리셋 | 없음 |
| 빌드 명령 | `corepack pnpm run build` |
| 빌드 출력 디렉터리 | `dist/public-site` |
| Node.js | `24` |
| pnpm | `11.22.0` |

Cloudflare 환경변수에는 다음 버전 값을 설정한다.

```text
NODE_VERSION=24
PNPM_VERSION=11.22.0
```

2026-09-22 현재 접속 중인 Cloudflare 계정에는 Pages 프로젝트 `dabboba`, `dabboba.net` zone, Email Routing이 존재한다. 계정에는 활성 Super Administrator가 한 명만 보이지만 그 관리자가 지정 친구인지, 복구·결제 주체가 친구인지, 2FA가 활성화됐는지는 확인되지 않았다. 현재 production branch도 대시보드에서 `main`인지 다시 확인해야 한다. 이 세 가지가 확인되기 전에는 최종 운영 계정으로 판정하지 않는다.

중요:

- 공개 사전오픈 랜딩과 정책·지원·탈퇴 문서가 조립된 `dist/public-site`만 공개한다.
- `dist/client`는 내부 앱 프로토타입과 미출시 화면을 포함하므로 절대 Pages 출력 경로로 지정하지 않는다.
- Cloudflare의 `Email Address Obfuscation`은 꺼 둔다. 활성화하면 검토·기록한 정책 HTML의 SHA-256과 실제 공개 본문이 달라진다.
- 처음에는 Preview 배포 주소에서 검수하고, `main` 배포가 통과한 뒤에만 커스텀 도메인을 연결한다.
- 현재 `dabboba.pages.dev` 프로젝트가 존재하므로 이전이 필요할 때 친구 계정의 새 프로젝트는 다른 임시 프로젝트명을 사용할 수 있다. 최종 사용자는 `dabboba.net`으로 접속하므로 임시 `*.pages.dev` 이름을 맞추기 위해 기존 프로젝트를 먼저 삭제하지 않는다.
- 새 Pages 프로젝트만으로는 소유권 이전이 끝나지 않는다. `dabboba.net` zone, 네임서버, 커스텀 도메인 연결, Email Routing이 기존 계정에 남아 있으면 아래 `4. dabboba.net 도메인과 DNS`의 `계정 간 zone·Email Routing 이전`을 먼저 끝낸 뒤에만 운영 도메인을 새 프로젝트에 붙인다.

[Cloudflare 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [빌드 런타임 버전 설정](https://developers.cloudflare.com/pages/configuration/build-image/)

## 3. 운영 변수는 API 준비 후 연결

정책 문서는 변수 없이도 공개되며, Google Play의 외부 계정삭제 요청 요건을 위해 자동 인증 연동 전에도 `/account-deletion`에서 `support@dabboba.net`으로 삭제 요청을 보낼 수 있게 유지한다. 자동 웹 본인확인·접수 API는 운영 API가 준비될 때까지 의도적으로 `503` 상태로 닫혀 있다. API, Supabase 운영 프로젝트, 이메일 OTP가 모두 준비된 뒤 아래 **공개 값 세 개만** Pages의 Production 환경변수로 등록한다.

```text
DABBOBA_PUBLIC_API_ORIGIN=https://<운영 고객 API origin>
SUPABASE_URL=https://<운영 project ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<운영 publishable key>
```

- 데이터베이스 URL, service-role/secret key, 세션 pepper, 결제 키, 전체 `.env` 파일은 Pages에 넣지 않는다.
- Preview 환경에는 운영 인증값을 복사하지 않는다. 필요하면 별도 staging 값만 사용한다.
- 위 값을 등록하기 전에는 `dabboba.net`을 운영 API의 허용 origin에 추가하지 않는다.
- 값 등록 후 이메일 OTP 요청·검증, 탈퇴 가능 상태 확인, 탈퇴 요청, 접수번호 조회를 실제 운영 계정으로 다시 검수한다.
- 값 등록 전에 아래 `계정삭제 OTP 남용 방지` 필수 수동 단계를 먼저 완료한다.

### 계정삭제 OTP 남용 방지 — 필수 수동 단계

`/account-deletion/auth/email-otp`와 `/account-deletion/auth/phone-otp`는 인증번호 메일·SMS 발송을 일으키는 익명 `POST` 경로다. 두 경로를 처리하는 `worker/index.js`는 보호된 런타임 파일이라 이번 변경에서 코드로 속도 제한이나 Turnstile 검증을 추가하지 않았다. 따라서 **위 운영 변수를 등록해 두 경로가 `503`에서 열리기 전에** 아래 Cloudflare 설정을 서비스 소유자 계정에서 직접 적용하고 결과를 기록해야 한다. 이 설정이 없으면 공개 전 체크리스트를 통과한 것으로 보지 않는다.

**1) Rate limiting rule (필수)** — `dabboba.net` zone → Security → WAF → Rate limiting rules → Create rule

- Rule name: `account-deletion-otp-per-ip`
- Expression (Edit expression):

  ```text
  (http.host eq "dabboba.net" and http.request.method eq "POST" and http.request.uri.path in {"/account-deletion/auth/email-otp" "/account-deletion/auth/phone-otp"})
  ```

- Characteristics: `IP` (같은 IP의 두 경로 요청을 합산하려면 경로를 characteristic에 넣지 않는다)
- 목표 한도: IP당 **10분에 약 5회**. Requests `5`, Period `10 minutes`, Action `Block`, Duration `10 minutes`를 우선 선택한다.
- 플랜에 따라 고를 수 있는 Period·Duration이 다르다. 10분 period를 고를 수 없으면 선택 가능한 가장 가까운 조합(예: 더 짧은 period에서 1~2회, block duration은 가능한 최대)으로 설정하고, 실제 적용 값과 플랜을 아래 기록에 남긴다. 한도를 더 느슨하게 올리지 않는다.
- 응답 본문은 기본 `429`를 사용하고, 계정삭제 페이지의 `support@dabboba.net` 이메일 요청 경로는 이 규칙과 무관하게 계속 열려 있어야 한다.

**2) Turnstile (필수, 페이지 연동 포함)** — Cloudflare → Turnstile → Add widget

- Widget name `dabboba-account-deletion`, Hostname `dabboba.net`만 등록, Widget mode `Managed`.
- **Pre-clearance**를 켜고 clearance level을 `Managed`(또는 더 엄격한 값)로 둔다. 보호된 worker는 Turnstile 토큰을 서버에서 검증하지 않으므로, 토큰 검증 대신 Cloudflare가 발급하는 `cf_clearance` 쿠키로 WAF에서 차단해야 한다.
- 계정삭제 페이지(`public/account-deletion/`)가 OTP 요청 전에 해당 site key로 Turnstile 위젯을 렌더링하도록 별도 코드 변경이 필요하다. 이 페이지 변경은 이번 변경에 포함되지 않았다. 또한 공개 페이지의 CSP(`script-src 'self'`, frame 미허용)는 보호된 `worker/index.js`가 설정하므로 `https://challenges.cloudflare.com`의 script/frame 허용은 런타임 변경 승인을 받은 별도 작업으로만 반영할 수 있다. 두 변경이 배포·확인되기 전까지 이 항목은 미완료다. Secret key는 Pages 변수나 저장소에 넣지 않는다.
- Security → WAF → Custom rules → Create rule: 이름 `account-deletion-otp-turnstile`, 위 rate-limit와 같은 expression, Action `Managed Challenge`. Pre-clearance 쿠키가 없는 요청은 challenge 단계에서 막힌다. WAF custom rule은 rate limiting rule보다 먼저 평가되므로 challenge를 통과한 요청만 IP 한도에 집계된다.
- 휴대폰 OTP를 제공하지 않는 동안에도 `/account-deletion/auth/phone-otp`를 규칙에서 빼지 않는다.

**3) 확인과 기록**

- 쿠키 없는 `curl -X POST` 요청이 challenge(`403`) 또는 rate limit(`429`)로 막히는지 확인한다. 잘못된 JSON 본문으로 시험해 실제 인증번호가 발송되지 않게 한다.

  ```sh
  for i in 1 2 3 4 5 6 7; do
    curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
      --data '{"invalid":true}' https://dabboba.net/account-deletion/auth/email-otp
  done
  ```

- 실제 브라우저에서 위젯 통과 후 이메일 OTP 요청 1회가 정상 처리되는지 확인한다.
- 규칙 이름, expression, 실제 Requests/Period/Duration, 플랜, 위젯 site key(공개 값), 확인 날짜를 운영 기록에 남긴다.
- [ ] Rate limiting rule 적용·확인
- [ ] Turnstile 위젯·pre-clearance·WAF custom rule 적용
- [ ] 계정삭제 페이지 Turnstile 연동 코드 변경 배포·확인

## 4. `dabboba.net` 도메인과 DNS

도메인은 친구 또는 사업자 명의로 구매하고 갱신 결제 수단과 만료 알림도 소유자 계정에 둔다.

### 연결 전

- [ ] 도메인 등록자와 결제 주체가 서비스 소유자인지 확인
- [ ] 현재 DNS의 `A`, `AAAA`, `CNAME`, `MX`, `TXT`, CAA 레코드를 백업
- [ ] 기존 DNSSEC가 켜져 있다면 등록기관의 기존 DS 레코드를 먼저 해제하고 TTL 만료를 확인
- [x] Cloudflare에 `dabboba.net` zone을 추가하고 자동 탐지된 레코드를 검토
- [x] Cloudflare가 안내한 네임서버를 도메인 등록기관에 입력

### Pages 연결

- [x] 현재 Pages 프로젝트에서 Custom domains에 `dabboba.net`을 먼저 추가
- [x] 인증서가 Active가 되고 HTTPS가 정상인지 확인
- [x] `www.dabboba.net`을 추가하고 루트 도메인으로 리디렉션
- [x] 수동 CNAME만 먼저 만들지 않는다. Pages의 Custom domains 절차를 통해 연결한다.

루트 도메인을 Pages에 연결하려면 해당 zone의 네임서버가 Cloudflare를 향해야 한다. 다른 DNS 사업자를 계속 쓰면서 서브도메인만 연결할 때는 CNAME 방식이 가능하다. 자세한 절차는 [Cloudflare Pages 커스텀 도메인 문서](https://developers.cloudflare.com/pages/configuration/custom-domains/)를 따른다.

### 계정 간 zone·Email Routing 이전

현재 zone이 있는 계정이 지정 친구의 계정으로 확인되면 이 절차는 건너뛴다. 다른 사람 소유로 확인되면 공개 사이트와 `support@dabboba.net` 메일이 끊기지 않도록 아래 순서를 지킨다. Cloudflare는 zone을 두 계정에서 동시에 활성화하지 않는다. 새 계정의 zone이 `Pending`인 동안에는 트래픽을 프록시하지 않고, 활성화되면 기존 계정의 zone은 `Moved Away`가 됐다가 7일 뒤 삭제된다. [Cloudflare 계정 간 도메인 이동](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/)

**이전 전 백업과 준비 — 기존 계정에서**

- [ ] DNS → Records → Export로 BIND 파일을 내려받아 운영 기록 보관소에 둔다. 이 파일 없이 진행하면 Cloudflare가 프록시 레코드를 다시 가져오면서 1000 오류가 날 수 있다.
- [ ] Email Routing의 주소별 규칙, catch-all 설정, 전달 대상 주소 목록과 MX/SPF/DKIM TXT 값을 스크린샷이나 표로 기록한다. Email Routing 설정은 zone 이동으로 옮겨지지 않는다고 보고 새 계정에서 다시 만든다.
- [ ] Pages 커스텀 도메인(`dabboba.net`, `www.dabboba.net`), 리디렉션 규칙, WAF·rate limiting·Turnstile 규칙, SSL/TLS 모드, `Email Address Obfuscation` 꺼짐 상태를 기록한다. 인증서는 이전되지 않으며 새 계정에서 다시 발급된다.
- [ ] DNSSEC가 켜져 있으면 등록기관의 DS 레코드를 먼저 지우고 DS TTL이 지날 때까지 기다린 뒤 기존 zone에서 DNSSEC를 끈다. 유료 add-on이나 구독이 있으면 해지한다.
- [ ] 네임서버 전환 전에 NS·MX·A/AAAA/CNAME TTL을 짧게(예: 300초) 낮추고 기존 TTL만큼 기다린다.

**새 계정 준비 — 친구 계정에서, 네임서버를 바꾸기 전에**

- [ ] 친구 계정에 `dabboba.net`을 추가하고, 자동 탐지 대신 백업한 BIND 파일을 가져와 레코드를 대조한다. 이 단계에서는 zone이 `Pending`이어도 된다.
- [ ] 친구 계정의 Pages 프로젝트가 Preview와 `*.pages.dev` 주소에서 위 스모크 테스트를 통과했는지 확인한다.
- [ ] 새 계정이 안내한 네임서버 두 개를 기록한다. 기존 계정과 다를 수 있다.

**전환과 확인**

- [ ] 등록기관에서 네임서버를 새 계정 값으로 바꾸고 `Re-check now`로 zone이 `Active`가 될 때까지 확인한다.
- [ ] `Active` 직후 친구 계정에서 Email Routing을 켜고 전달 대상 주소를 다시 인증한 뒤 백업한 규칙을 다시 만든다. 외부 메일 → `support@dabboba.net` 전달이 실제로 도착하는지 확인한다.
- [ ] 친구 계정 Pages 프로젝트의 Custom domains에 `dabboba.net`, `www.dabboba.net`을 추가하고 인증서가 Active가 된 뒤 HTTPS와 `www` 리디렉션을 확인한다.
- [ ] WAF·rate limiting·Turnstile 규칙과 `Email Address Obfuscation` 꺼짐 상태를 새 계정에 다시 적용한다.
- [ ] 위 `5. 공개 전 스모크 테스트`를 `https://dabboba.net`에서 다시 통과한다.
- [ ] DNS와 메일이 안정된 뒤 TTL을 원래 값으로 되돌리고, 아래 `DNSSEC` 절차로 새 계정에서 DNSSEC를 다시 켠다.

**롤백**

- 새 계정 zone이 `Active`가 되기 전에 문제가 생기면 등록기관의 네임서버를 기존 값으로 되돌린다. 기존 zone은 아직 활성 상태다.
- `Active` 이후에는 기존 zone이 `Moved Away` 상태로 7일 동안만 남는다. 이 상태의 zone을 그대로 되살릴 수 있다고 가정하지 않는다. 되돌려야 하면 백업한 BIND 파일과 Email Routing 기록으로 되돌릴 계정에 zone을 다시 구성하고, 그 계정이 안내한 네임서버로 등록기관 값을 바꾼다. 이 7일 동안 기존 계정의 Pages 프로젝트, 레코드 백업, Email Routing 기록을 지우지 않는다.
- 롤백과 전환 시각, 실제 네임서버 값, 확인한 URL·메일 결과를 운영 기록에 남긴다. 비밀번호, API 토큰, 복구 코드는 남기지 않는다.

### 이메일 DNS

`support@dabboba.net`을 실제 송수신 가능한 메일함으로 만든 뒤 메일 공급자가 안내하는 값을 그대로 등록한다.

- [x] MX 레코드
- [x] SPF TXT 레코드
- [ ] DKIM TXT/CNAME 레코드
- [ ] DMARC TXT 레코드(초기에는 보고 수집 후 차단 정책 강화)
- [x] 외부 메일 → `support@dabboba.net` 요청이 Cloudflare 로그에서 `Forwarded`가 된 사례 1건 확인
- [ ] 전달 대상 받은편지함 도착과 운영자 확인까지 검증
- [ ] `support@dabboba.net` → Gmail/Naver/Daum 발신 및 스팸 여부 확인
- [ ] 개인정보처리방침·지원 페이지·스토어 메타데이터의 지원 주소가 모두 일치하는지 확인

### DNSSEC

- [ ] 네임서버 전환과 사이트·메일 확인이 끝난 뒤 Cloudflare에서 DNSSEC 활성화
- [ ] Cloudflare가 생성한 DS 값을 도메인 등록기관에 등록
- [ ] `dig DS dabboba.net`과 외부 DNSSEC 검사에서 정상 확인

기존 DNSSEC 상태에서 네임서버를 먼저 바꾸면 해석 오류가 날 수 있다. 전환 순서와 TTL 대기는 [Cloudflare DNSSEC 문서](https://developers.cloudflare.com/dns/dnssec/)를 따른다.

## 5. 공개 전 스모크 테스트

새 프로젝트의 `*.pages.dev` 주소와 최종 `https://dabboba.net` 양쪽에서 아래 항목을 확인한다.

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/privacy
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/terms
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/support
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/account-deletion
curl -sS -o /dev/null -w '%{http_code}\n' 'https://<새-project>.pages.dev/account-deletion/auth/social/callback?code=test&state=test'
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/unexpected-route
curl -sS -o /dev/null -w '%{http_code}\n' https://<새-project>.pages.dev/assets/dabboba/draw/gacha/arcade-cabinet.png
```

기대 결과:

- `/`, `/privacy`, `/terms`, `/support`, `/account-deletion`, OAuth callback: `200`
- 존재하지 않는 경로와 내부 프로토타입 이미지: `404`
- API 변수 연결 전 `/account-deletion/runtime-config.json`: `503`가 정상이며 계정삭제 페이지의 이메일 요청 경로는 계속 노출
- API 변수 연결 후 runtime config와 실제 인증 흐름: 정상 응답
- 공개 페이지 응답에 CSP 등 보안 헤더 존재
- `www` 접속은 `https://dabboba.net`으로 리디렉션
- 모바일 네트워크에서도 HTTPS 경고 없이 열림

## 6. 배포와 롤백

- `main`에 합치기 전 Preview 주소에서 먼저 확인한다.
- `main`의 성공한 배포 URL과 Git commit SHA를 출시 기록에 남긴다.
- 문제가 생기면 Cloudflare Pages의 **Deployments → 이전 성공 배포 → Rollback to this deployment**를 사용한다. Preview 배포는 롤백 대상으로 사용할 수 없다. [Cloudflare Pages 롤백 안내](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- DNS 레코드를 급하게 다른 곳으로 바꾸는 방식으로 롤백하지 않는다. 인증서와 도메인 활성 상태가 깨질 수 있다.

## 7. CLI를 꼭 써야 할 때

기본 운영은 Git 연동 자동 배포를 사용한다. 예외적으로 Wrangler가 필요하면 버전을 고정한다.

```sh
npx --yes wrangler@4.135.0 pages deploy dist/public-site --project-name <친구-계정-project-name>
```

- 저장소 루트에서 Wrangler를 실행하면 로컬 `.env` 또는 `.dev.vars`를 자동으로 읽을 수 있으므로 운영 배포에 사용하지 않는다.
- 필요할 때는 `dist/public-site`만 별도 임시 디렉터리에 복사한 뒤 그 디렉터리에서 실행한다.
- 업로드 전 파일 목록에 storefront의 `index.html`, 정적 `assets/`, `_worker.js`, `legal/` 외의 앱 프로토타입·비밀 파일이 없는지 확인한다.
- Global API Key 대신 최소 권한 API token을 사용하고, 토큰을 저장소·문서·터미널 기록에 남기지 않는다.
- 현재 로컬 Wrangler 세션은 브라우저에서 운영 중인 Cloudflare 계정과 다른 계정으로 확인됐다. 소유권과 대상 account ID를 명시적으로 대조하기 전에는 그 로컬 세션으로 운영 Pages를 배포하거나 DNS를 변경하지 않는다.

## 8. 임시 사이트 정리 시점

현재 계정의 `https://dabboba.pages.dev`는 친구 명의 계정의 소유권이 확인되고 운영 배포가 완료될 때까지 비교·복구용으로 유지한다. 다음 조건을 모두 충족한 뒤에만 기존 임시 프로젝트 정리를 결정한다.

- [ ] Cloudflare 계정의 Account Super Administrator, 복구 이메일, 2FA, 결제·갱신 주체가 친구 또는 친구 사업자인지 본인이 확인
- [x] 현재 계정의 Git 연동 Production 배포 성공
- [x] 위 스모크 테스트 통과
- [x] `dabboba.net`과 `www.dabboba.net` HTTPS 연결 완료
- [ ] `support@dabboba.net` 송수신 확인
- [ ] 운영 API 연결 후 회원탈퇴 전체 흐름 확인
- [x] 최소 한 개의 이전 성공 배포가 있어 롤백 가능

기존 임시 프로젝트를 지워도 `dabboba.net`은 친구 계정의 Pages 프로젝트에만 연결되어 있어야 한다. 기존 프로젝트에 커스텀 도메인, Git 저장소, 운영 변수 또는 운영 API 권한을 연결하지 않는다.
