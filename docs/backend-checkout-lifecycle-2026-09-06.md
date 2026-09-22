# 네이티브 가챠 구매·재시작·복구 기록 정리 검증

2026-09-06, DABBOBA SDK54 / iOS 26.5 Simulator / Expo Go에서 수행했다. 실제 앱 checkout에서 만든 주문과 SQLite 의도로 전체 복구 경로를 확인했다. 실물 기기·서명 배포본·외부 PG 결제의 증거는 아니다.

## 격리 대상

- 기기: `A02E1420-C5EC-4E03-8D6E-1FB2CF53B258`, bundle `host.exp.Exponent`.
- Metro `8084` → QA API `8879` → 기존 disposable 컨테이너 `dabboba-backend-integration-20260905`의 clone `dabboba_restore_drill_mobile_20260906`.
- 원격 Supabase, 기존 API `8788`, 다른 프로젝트의 기기는 변경하지 않았다. API·Metro도 이 복구 시퀀스 중 재시작하지 않았다.
- 테스트 사용자 `49f6d341-4e82-4daa-91d2-4118606f1f01`, 상품 `mobile-recovery-qa-20260906-gacha`.

## 실제 경로와 상태

| 경계 | 관측 결과 |
| --- | --- |
| 구매 전 | 기존 주문 2건은 각각 CONSUMED 2 / 결과 2. 포인트 4,000. 이 가챠 상품의 SQLite 구매 의도 0개 |
| 상품 → 뽑으러 가기 → checkout | 수량 2, 보유 포인트 모두 사용, 포인트 2,000 / 최종 금액 0원 확인 후 실제 `구매하기` 선택. `체험하기`는 선택하지 않음 |
| 구매 완료 | 새 주문 `a255163d-41b1-483c-ae6a-ed2ac9ea496a`, PAID / INTERNAL_ZERO / 금액 0 / 권리 AVAILABLE 2. 동일 주문·수량·포인트의 SQLite 의도 1개 |
| 첫 SKIP 후 | 서버 결과 1개, CONSUMED 1 / AVAILABLE 1. NEXT가 표시된 상태에서 누르지 않고 앱 종료. SQLite 의도 유지 |
| 앱 재실행 | Expo 개발 호스트 시작 화면을 관측했다. 동일 Metro URL로 DABBOBA를 열고 `/profile/orders`로 진입하자 해당 상품의 `이어 뽑기` 1개 표시 |
| 이어 뽑기 → SKIP | 같은 주문의 남은 권리만 소비. CONSUMED 2 / 결과 2. 최종 결과가 보이는 동안 SQLite 의도는 여전히 1개 |
| 최종 결과의 상단 복귀 | 상품 화면 복귀 후 정확한 SQLite 의도 0개. 구매 내역 재진입 시 주문 3건, `이어 뽑기` 없음 |
| 최종 원장 | 새 주문 SPEND 원장 1건 / -2,000, 포인트 잔액 2,000. 원래 두 주문 및 결과는 그대로, 총 주문 3건. 추가 주문이나 재결제 없음 |

검증 시 SQLite는 실제 Expo experience의 `SQLite/dabboba-local.db`를 `sqlite3 -readonly`로 읽어 WAL을 포함한 현재 값을 확인했다. 저장소를 지우거나 앱을 재설치하지 않았다. 검사한 키는 `checkout.gacha.pending-order.v1.<userId>.<productId>` 하나이며 인증 토큰은 읽거나 기록하지 않았다. PostgreSQL 확인은 `BEGIN READ ONLY`로 제한했다.

테스트 상품은 이미지가 없는 고정 fixture라 결과에는 등록된 상품명 `복구 QA · 별 마스코트`와 이미지 오류 placeholder가 표시됐다. 이는 미디어 전달 검증이 아니다. 최초 NEXT 대기는 화면의 실제 접근성 이름 `다음 가챠 캡슐 준비하기`와 다른 문자열을 찾아 실패한 검사 선택자 문제였다. 관측 timeout을 앱 종료나 주문 실패로 간주하지 않았다. Expo 시작 화면이 남은 원인까지 확정한 것은 아니며 standalone 앱 복귀와 구분한다.

## 반복 실행 보호

추가 네이티브 주문이 생기면 QA 시작 도구의 기존 ‘상품당 주문 1개’ 가정은 성립하지 않는다. `scripts/mobile-qa-fixture-order.mjs`는 원래 고정 `CREATE_ORDER` idempotency 레코드의 actor·상품·완료 상태·ORDER 리소스만 선택한다. 임의의 첫 주문을 채택하거나 새 주문을 삭제·초기화하지 않는다. 고정 키가 없는데 기존 주문이 있으면 실패한다.

집중 테스트 5개와 두 스크립트 문법 검사를 root에서 재실행해 실패/skip 0이었다. 실제 clone의 가챠 주문 2개와 고정 idempotency 레코드를 읽어 helper에 전달한 별도 read-only 검사에서도 원래 주문 `16879624-ecfc-454b-bf00-f42f89297b6a`만 선택했고 새 네이티브 주문은 보존됐다. 이 추가 검사는 QA 서버 자체 재시작을 수행한 증거는 아니다.

## 보존 이미지

Git 제외 `work/qa/backend-checkout-lifecycle-20260906/`:

1. `01-native-checkout-zero.jpg` — 실제 수량 2 / 포인트 2,000 / 최종 0원.
2. `02-first-result-next.jpg` — 첫 결과, 다음 캡슐은 아직 열지 않음.
3. `03-restarted-remaining-draw.jpg` — 재실행 후 구매 내역의 남은 뽑기.
4. `04-second-result.jpg` — 같은 주문의 마지막 결과.
5. `05-completed-order-history.jpg` — 완료 후 복구 카드가 없는 주문 3건.

코드 검증은 이 네이티브 성공 경로뿐 아니라 부분 종료·검증 실패 시 의도 보존, 다른 사용자/주문/권리 거부, 지연 응답·경로 왕복 중 삭제 차단, 전체 주문 완료 증명을 별도 단위/API 테스트로 다룬다. 실제 PG, 네트워크 단절·프로세스 강제 종료의 모든 시점, 실기기 수명주기 검증은 출시 전 별도 항목이다.
