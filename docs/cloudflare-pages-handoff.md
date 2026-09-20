# DABBOBA Cloudflare Pages 소유권 이전 체크리스트

이 문서는 공개 정책 사이트를 **서비스 소유자인 친구의 Cloudflare 계정**으로 옮길 때 사용하는 운영 체크리스트다. 현재 계정에 배포된 `https://dabboba.pages.dev`는 임시 확인용이며, 최종 서비스 소유권이나 `dabboba.com` 운영 배포로 간주하지 않는다.

## 1. 계정과 권한

- 친구가 본인 이메일로 Cloudflare 계정을 만들고 계정 소유자가 된다.
- 계정 생성 직후 2단계 인증(2FA)을 켜고 복구 코드를 안전한 곳에 보관한다.
- 비밀번호, 복구 코드, 전체 API 토큰을 다른 사람과 공유하지 않는다.
- 협업이 필요하면 비밀번호 공유 대신 Cloudflare 멤버 초대와 최소 권한을 사용한다.
- GitHub 연결도 친구 또는 서비스 조직이 소유한 계정에서 승인한다. 개인 개발자 계정만 승인 주체로 남기지 않는다.

## 2. 새 Pages 프로젝트 만들기

새 프로젝트는 **Git 연동 방식**으로 만든다. 현재 임시 프로젝트를 계정 이전 대상으로 삼지 않으며, 친구 계정에서 새 프로젝트를 만든다. Cloudflare도 Direct Upload 프로젝트를 나중에 Git 연동 프로젝트로 변경할 수 없다고 안내한다.

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

중요:

- `dist/public-site`만 공개한다.
- `dist/client`는 내부 앱 프로토타입과 미출시 화면을 포함하므로 절대 Pages 출력 경로로 지정하지 않는다.
- 처음에는 Preview 배포 주소에서 검수하고, `main` 배포가 통과한 뒤에만 커스텀 도메인을 연결한다.
- 현재 `dabboba.pages.dev` 프로젝트가 존재하므로 친구 계정의 새 프로젝트는 다른 임시 프로젝트명을 사용할 수 있다. 최종 사용자는 `dabboba.com`으로 접속하므로 임시 `*.pages.dev` 이름을 맞추기 위해 기존 프로젝트를 먼저 삭제하지 않는다.

[Cloudflare 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [빌드 런타임 버전 설정](https://developers.cloudflare.com/pages/configuration/build-image/)

## 3. 운영 변수는 API 준비 후 연결

정책 문서는 변수 없이도 공개되지만, 웹 회원탈퇴 인증은 운영 API가 준비될 때까지 의도적으로 `503` 상태로 닫혀 있다. API, Supabase 운영 프로젝트, 이메일 OTP가 모두 준비된 뒤 아래 **공개 값 세 개만** Pages의 Production 환경변수로 등록한다.

```text
DABBOBA_PUBLIC_API_ORIGIN=https://<운영 고객 API origin>
SUPABASE_URL=https://<운영 project ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<운영 publishable key>
```

- 데이터베이스 URL, service-role/secret key, 세션 pepper, 결제 키, 전체 `.env` 파일은 Pages에 넣지 않는다.
- Preview 환경에는 운영 인증값을 복사하지 않는다. 필요하면 별도 staging 값만 사용한다.
- 위 값을 등록하기 전에는 `dabboba.com`을 운영 API의 허용 origin에 추가하지 않는다.
- 값 등록 후 이메일 OTP 요청·검증, 탈퇴 가능 상태 확인, 탈퇴 요청, 접수번호 조회를 실제 운영 계정으로 다시 검수한다.

## 4. `dabboba.com` 도메인과 DNS

도메인은 친구 또는 사업자 명의로 구매하고 갱신 결제 수단과 만료 알림도 소유자 계정에 둔다.

### 연결 전

- [ ] 도메인 등록자와 결제 주체가 서비스 소유자인지 확인
- [ ] 현재 DNS의 `A`, `AAAA`, `CNAME`, `MX`, `TXT`, CAA 레코드를 백업
- [ ] 기존 DNSSEC가 켜져 있다면 등록기관의 기존 DS 레코드를 먼저 해제하고 TTL 만료를 확인
- [ ] Cloudflare에 `dabboba.com` zone을 추가하고 자동 탐지된 레코드를 검토
- [ ] Cloudflare가 안내한 네임서버를 도메인 등록기관에 입력

### Pages 연결

- [ ] 친구 계정의 Pages 프로젝트에서 Custom domains에 `dabboba.com`을 먼저 추가
- [ ] 인증서가 Active가 되고 HTTPS가 정상인지 확인
- [ ] `www.dabboba.com`을 추가하고 루트 도메인으로 리디렉션
- [ ] 수동 CNAME만 먼저 만들지 않는다. Pages의 Custom domains 절차를 통해 연결한다.

루트 도메인을 Pages에 연결하려면 해당 zone의 네임서버가 Cloudflare를 향해야 한다. 다른 DNS 사업자를 계속 쓰면서 서브도메인만 연결할 때는 CNAME 방식이 가능하다. 자세한 절차는 [Cloudflare Pages 커스텀 도메인 문서](https://developers.cloudflare.com/pages/configuration/custom-domains/)를 따른다.

### 이메일 DNS

`support@dabboba.com`을 실제 송수신 가능한 메일함으로 만든 뒤 메일 공급자가 안내하는 값을 그대로 등록한다.

- [ ] MX 레코드
- [ ] SPF TXT 레코드
- [ ] DKIM TXT/CNAME 레코드
- [ ] DMARC TXT 레코드(초기에는 보고 수집 후 차단 정책 강화)
- [ ] 외부 메일 → `support@dabboba.com` 수신 확인
- [ ] `support@dabboba.com` → Gmail/Naver/Daum 발신 및 스팸 여부 확인
- [ ] 개인정보처리방침·지원 페이지·스토어 메타데이터의 지원 주소가 모두 일치하는지 확인

### DNSSEC

- [ ] 네임서버 전환과 사이트·메일 확인이 끝난 뒤 Cloudflare에서 DNSSEC 활성화
- [ ] Cloudflare가 생성한 DS 값을 도메인 등록기관에 등록
- [ ] `dig DS dabboba.com`과 외부 DNSSEC 검사에서 정상 확인

기존 DNSSEC 상태에서 네임서버를 먼저 바꾸면 해석 오류가 날 수 있다. 전환 순서와 TTL 대기는 [Cloudflare DNSSEC 문서](https://developers.cloudflare.com/dns/dnssec/)를 따른다.

## 5. 공개 전 스모크 테스트

새 프로젝트의 `*.pages.dev` 주소와 최종 `https://dabboba.com` 양쪽에서 아래 항목을 확인한다.

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
- API 변수 연결 전 `/account-deletion/runtime-config.json`: `503`가 정상
- API 변수 연결 후 runtime config와 실제 인증 흐름: 정상 응답
- 공개 페이지 응답에 CSP 등 보안 헤더 존재
- `www` 접속은 `https://dabboba.com`으로 리디렉션
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
- 업로드 전 파일 목록에 `_worker.js`와 `legal/` 외의 앱 프로토타입·비밀 파일이 없는지 확인한다.
- Global API Key 대신 최소 권한 API token을 사용하고, 토큰을 저장소·문서·터미널 기록에 남기지 않는다.

## 8. 임시 사이트 정리 시점

현재 계정의 `https://dabboba.pages.dev`는 새 친구 계정 배포가 완료될 때까지 비교·복구용으로 유지한다. 다음 조건을 모두 충족한 뒤에만 기존 임시 프로젝트 정리를 결정한다.

- [ ] 친구 계정의 Git 연동 Production 배포 성공
- [ ] 위 스모크 테스트 통과
- [ ] `dabboba.com`과 `www.dabboba.com` HTTPS 연결 완료
- [ ] `support@dabboba.com` 송수신 확인
- [ ] 운영 API 연결 후 회원탈퇴 전체 흐름 확인
- [ ] 최소 한 개의 이전 성공 배포가 있어 롤백 가능

기존 임시 프로젝트를 지워도 `dabboba.com`은 친구 계정의 Pages 프로젝트에만 연결되어 있어야 한다. 기존 프로젝트에 커스텀 도메인, Git 저장소, 운영 변수 또는 운영 API 권한을 연결하지 않는다.
