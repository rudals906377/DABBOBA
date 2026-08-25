# DABBOBA 앱 중심 전환 기준

## 확정 방향

DABBOBA의 제품 본체는 고객 웹이 아니라 `apps/mobile`의 Expo + React Native + TypeScript 앱이다. 고객 웹은 네이티브 앱에서 검증된 기능을 이후 확장하는 채널이며, 현재 Vite 화면과 WebView 셸은 승인된 디자인·동작을 보존하면서 화면별로 이전하기 위한 참고 구현이다.

브라우저의 iPhone/Pixel 프레임, WebView, Expo Go, Simulator, development build, TestFlight/Play internal build, 실물 기기 검증은 서로 다른 증거다. 앞 단계의 성공을 다음 단계의 완료로 표현하지 않는다.

## 현재 기준과 비교

| 영역 | 유지 | 이전 | 새로 마련 |
| --- | --- | --- | --- |
| 고객 경험 | 승인된 DABBOBA 디자인, 교환방·뽀바·홈·덕룸·프로필 구조, 가챠/쿠지와 직접구매 분리 | Vite/FlowStack 화면을 Expo Router 기반 React Native 화면으로 기능별 이전 | 네이티브 Safe Area, 딥링크, 접근성, 실제 iOS/Android 회귀 |
| 계약 | OpenAPI 원본, 생성 TypeScript 타입, `@dabboba/api-client` | 웹 전용 adapter를 앱용 query/cache 경계로 이동 | 앱/API 계약 테스트와 이전 버전 호환 정책 |
| 인증 | API의 권한·정지·탈퇴·감사 판정 | 고객 자체 session을 Supabase Auth JWT 기반 canonical identity로 단계 전환 | SecureStore token 보관, provider 연결·계정 병합 정책 |
| 데이터 | PostgreSQL 원장, 기존 forward-only SQL migration, 결제·재고·추첨 트랜잭션 | production 연결을 Supabase PostgreSQL로 이동하고 모듈별로 Drizzle 도입 | 앱 SQLite의 삭제 가능한 cache/draft/upload queue schema |
| 미디어 | 소유자·상태·checksum·크기·EXIF 제거·변형·삭제 정책 | GCS adapter를 Supabase Storage signed upload/worker adapter로 교체 | private bucket 정책, RLS, 유해물 검사, CDN/변형 운영 증거 |
| 작업 처리 | transactional outbox와 idempotent worker handler | BullMQ publication을 Supabase Queues 소비로 교체 | queue visibility/retry/dead-letter 운영과 복구 테스트 |
| 관리자 | Next.js 운영 웹과 Fastify API 경계 | Supabase Auth/Storage 상태를 API를 통해 보게 조정 | 운영자 MFA·실제 계정·감사/복구 절차 |

## 변하지 않는 서버 책임

- PostgreSQL이 회원, 주문, 결제, 포인트, 재고, 보관 상품, 추첨권, 확률표 버전, 확정 당첨 결과와 감사 기록의 유일한 원본이다.
- 가챠·쿠지는 서버가 추첨권을 잠그고 확률표 버전과 결과를 같은 트랜잭션에서 확정한다. 앱의 슬라이더·영상·애니메이션은 커밋된 결과만 표시한다.
- 피규어·카드는 직접구매이며 가챠·쿠지 추첨 흐름으로 보내지 않는다.
- 가격, 할인, 재고, 결제, 환불은 앱이 아니라 API가 재검산하고 멱등성 키와 서명된 PG webhook으로 확정한다.
- 앱에는 PostgreSQL URL, Supabase secret/service-role key, PG secret, 관리자 key를 넣지 않는다.
- Supabase Data API를 고객 핵심 원장 접근 경로로 사용하지 않는다. Fastify가 권위 있는 업무 API이며, 노출 schema가 필요하면 최소 권한과 RLS를 함께 적용한다.

## 의존성 순서

1. Expo Router 기반 네이티브 앱 셸과 공용 API client를 연결한다.
2. 홈 카탈로그처럼 로그인 없이 읽을 수 있는 기능을 네이티브 화면 → API → PostgreSQL 순서로 완성한다.
3. Expo SQLite에 삭제 가능한 cache, 최근 검색, 작성 초안, 업로드 대기, 마지막 sync 상태만 둔다.
4. Supabase Auth를 붙이고 API에서 검증한 `sub`를 기존 canonical user와 연결한다. 사용자 변경 가능한 metadata로 권한을 판정하지 않는다.
5. 교환방·신청방·보관함처럼 인증과 소유권이 필요한 화면을 수직 이전한다.
6. Supabase Storage signed upload, worker 검증·EXIF 제거·압축·thumbnail·유해물 검사와 삭제 정책을 연결한다.
7. 카탈로그 module부터 Drizzle schema/query를 도입하되, 결제·재고·추첨의 검증된 잠금 SQL은 동등한 동시성 증거 없이 바꾸지 않는다.
8. transactional outbox를 Supabase Queues에 발행하고 worker가 visibility timeout, retry, archive/dead-letter 규칙으로 처리한다.
9. 주문·PG sandbox·재고·추첨·배송·알림을 실제 공급자와 development build에서 검증한다.
10. 고객 웹은 검증된 앱 기능을 공용 계약 위에서 확장한다.

## 첫 수직 이전의 완료 조건

첫 단위는 고객 네이티브 홈 카탈로그다.

- Expo 앱이 WebView 없이 네이티브 화면과 네이티브 탭을 연다.
- 홈은 `@dabboba/api-client`로 Fastify의 공개 카탈로그를 읽는다.
- 네트워크 성공 결과는 Expo SQLite cache에 저장하며, 연결 실패 시 마지막 성공 cache만 보여준다.
- cache는 서버 원장이 아니며 언제든 삭제할 수 있다.
- 상대 이미지 경로를 앱 자산으로 오인하지 않고, 승인된 절대 Storage/CDN URL 또는 명시한 개발 asset origin만 사용한다.
- iOS/Android bundle과 타입 검사를 통과한다. Simulator나 실물 기기 확인은 실행한 범위만 별도 기록한다.

## 사용자 또는 외부 승인이 필요한 항목

- Supabase 조직/project, 서울 또는 확정 region, billing, production URL
- Auth provider의 Google/Kakao/SMS 설정과 redirect URI, 계정 병합 정책
- Storage bucket, publishable key와 서버 secret key의 secret manager 입력
- Queues/`pgmq` 활성화와 운영 worker 배포 권한
- 국내 PG 계약, webhook secret, 환불·정산 정책
- Apple Developer/Google Play 조직 계정, signing, EAS project
- 실제 IP/상품/이미지 사용 권리, 확률표 자료, 법무·개인정보·스토어 승인

비밀값은 채팅, Git, 앱의 `EXPO_PUBLIC_*`, 문서에 기록하지 않는다.
