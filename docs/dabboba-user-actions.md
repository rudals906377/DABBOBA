# DABBOBA 사용자가 직접 준비해야 하는 항목

## 사용 방법

이 문서는 코드로 대신 만들 수 없는 계정, 계약, 비밀값, 사업 결정, 실제 기기 검증을 모은 체크리스트다. 준비된 비밀은 채팅이나 저장소에 붙이지 말고 배포 secret manager에 직접 넣는다.

상태 표시는 다음처럼 사용한다.

- `미결정`: 사용자 선택이 필요함
- `계정 필요`: 외부 서비스 가입/권한 필요
- `검증 필요`: 실제 계정·기기·환경에서 확인 필요
- `승인 필요`: 법무/사업/스토어 등 책임 있는 승인 필요

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
- [ ] `검증 필요` CI/EAS가 저장소에 고정된 pnpm과 루트 `pnpm-lock.yaml`을 사용하는지 확인하고, production dependency audit에서 high/critical 0을 확인한 뒤 남은 `uuid` moderate advisory를 지원되는 Expo·Google Cloud 의존성 업그레이드 또는 문서화된 보안 승인으로 해소

필요한 결과물: production URL 목록, 네트워크 구성, secret manager 위치, 운영 담당자, 복원 훈련 기록. 클라우드 관리자 비밀번호나 DB URL 원문은 문서에 적지 않는다.

일반 API의 Fastify `trustProxy`는 현재 의도적으로 `false`다. 실제 ingress 경계가 확정되기 전에 애플리케이션에서 임의로 켜면 공격자가 보낸 forwarding header를 rate-limit identity로 신뢰할 수 있다. 반대로 여러 사용자가 하나의 ingress socket IP로 합쳐지는 배포에서는 정상 사용자끼리 rate-limit 예산을 공유할 수 있다. 신뢰 proxy 또는 edge/WAF 구성과 아래 통합 증거가 없으면 출시를 차단한다.

현재 Metro/PostCSS high advisory는 호환 patch override로 제거되어 있다. 다만 Expo CLI의 `xcode -> uuid@7`과 Google Cloud의 `gaxios -> uuid@9`에는 buffer API를 직접 사용하는 경우의 moderate advisory가 남아 있다. 서로 다른 major를 전역 강제 override하지 말고 각 상위 패키지가 지원하는 버전으로 올린 뒤 iOS/Android production bundle과 GCS 통합 테스트를 다시 수행한다. 저장소는 pnpm workspace와 루트 lockfile 하나로 통일됐으며 실제 EAS 환경에서도 같은 경계를 확인해야 한다.

## 2. 사용자 로그인과 계정

- [ ] `계정 필요` Supabase Auth project 설정과 publishable key 준비. secret/service-role key는 앱에 입력하지 않음
- [ ] `계정 필요` 본인 확인에 사용할 휴대폰/SMS 공급자 계약과 Supabase Auth 발신 정보 준비
- [ ] `계정 필요` Google OAuth client와 Supabase callback/production redirect URI 등록
- [ ] `계정 필요` Kakao Developers 앱, 동의항목, Supabase callback/production redirect URI 등록
- [ ] `미결정` 하나의 검증된 휴대폰 번호를 Google/Kakao/휴대폰 로그인에 어떻게 연결하고 중복 계정을 병합할지 운영 정책 승인
- [ ] `미결정` 연령 제한, 보호자 동의, 계정 복구, 휴대폰 번호 변경, 탈퇴/보존 정책 승인
- [ ] `검증 필요` 신규 가입, 기존 계정 연결, 재인증, 정지, 탈퇴, 계정 복구를 실제 provider sandbox에서 확인

현재 저장소의 customer `dev-session`은 개발용 legacy 경계다. Supabase credential만 입력한다고 production 로그인이 완성되는 것은 아니며, JWT 검증, canonical user 연결, 정지·탈퇴 session 폐기와 실제 provider callback 통합 테스트가 추가로 필요하다.

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

- [ ] `계정 필요` 국내 PG 선정, 심사, sandbox/live merchant 계정과 정산 계좌 준비
- [ ] `계정 필요` client/secret key, webhook signing secret, provider event 규격을 secret manager에 등록
- [ ] `미결정` 카드/간편결제 수단, 최소 결제액, 실패/재시도, 부분취소, 전액환불 정책 결정
- [ ] `미결정` 포인트·쿠폰 회계/만료/환불 정책과 CS 보정 승인 절차 결정
- [ ] `미결정` 가챠·쿠지 청약철회, 확률 공개, 품절/오배송/미수령 처리 정책 법률 검토
- [ ] `미결정` 유한 경품의 확률을 조회·결제·실제 추첨 중 어느 시점의 잔여 수량으로 확정할지 승인. 현재 코드는 결제 시 공개 버전을 고정하고 실제 추첨 시 같은 버전의 잔여 수량으로 계산함
- [ ] `검증 필요` sandbox 승인·실패·지연·중복 webhook·서명 오류·금액 불일치·환불·조정 흐름 확인
- [ ] `검증 필요` 연결된 고객 이어 뽑기 화면에서 결제 후 미사용 `AVAILABLE` 추첨권이 브라우저/앱 새로고침과 재로그인 뒤 다시 표시되고 한 번만 소비되는지 실제 PostgreSQL·PG sandbox에서 확인
- [ ] `검증 필요` live 전환 전 소액 실거래, 정산, 취소, 세금/영수증 흐름을 담당자가 확인

현재 코드는 generic webhook과 원장을 제공하지만 특정 PG 승인 API 및 공급자별 reconciliation adapter는 연결되지 않았다. `PAYMENT_PROVIDER=UNCONFIGURED`인 환경에서는 API도 주문 생성을 거부하며, 공급자 구현과 sandbox 증거 전에는 실결제를 열면 안 된다.

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
- [ ] `미결정` 출고 SLA, 배송비, 도서산간, 합배송, 분실/파손, 교환/반품 정책 승인
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

- [ ] `계정 필요` Apple Developer 조직 계정, App Store Connect 권한, 인증서/프로비저닝/EAS 자격 준비
- [ ] `계정 필요` Google Play Console 조직 계정, signing, service account 준비
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
