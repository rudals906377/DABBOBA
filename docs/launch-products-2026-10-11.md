# 첫 판매 가챠 8종 — 운영 등록 시트 (2026-10-11 운영 DB 조회)

> 최신 후속 결정(2026-10-13): 신규 가챠 구매는 포함된 상품 중 1개 지급 방식으로 복원한다. 쿠지는 준비 중이며 판매하지 않는다. 소유자가 확인한 종류별 20개 수량은 보존하지만 기존 재고·예약·구성표를 임의로 재설정하거나 판매 활성화하지 않는다. 직접 선택 SKU·과거 거래는 보존하고 신규 판매에서 제외한다. 현재 구현은 `docs/included-product-release-2026-10-13.md`를 따른다.

출처: 운영 DB `rconfxsykttfvznakile` 읽기 전용 조회(2026-10-11), `docs/launch-step1-2026-10-01.md`의 확정 수량,
`docs/prelaunch-five-track-readiness-2026-09-30.md`의 자동 배분. 이 문서는 관리자 웹에서 할 일을 적은 것이고,
운영 DB를 바꾸지 않았다.

## 지금 상태 (8종 공통)

| 항목 | 상태 |
|---|---|
| 상품·IP·가격·대표 이미지 | 8종 모두 등록됨, 활성 |
| 재고(`on_hand`) | 8종 모두 확정 수량과 같음(392개), 예약 0 |
| 경품 전용 SKU | 46종 모두 등록됨, 이미지 있음 |
| 확률표 | **8종 모두 없음**(초안도 없음) |
| 판매 상태 | 8종 모두 `COMING_SOON` |
| 대표 매장 이미지(`storefront`) | 없음(선택 사항. 없으면 대표 이미지를 `contain`으로 보여 줌) |

2026-10-12 소유자 결정: 먼작귀 7종은 `1`~`7`, 산리오 5종은 `1`~`5`의 숫자 이름으로 출시 준비한다. 실제 캐릭터명 확인은 출시 차단 항목이 아니며 추후 관리자에서 수정한다. 수량은 바꾸지 않는다. 상세 상품 기준가격은 부모 가챠의 1회 가격과 같게 맞춘다. 로컬 마이그레이션 `0095` 준비, 운영 적용 전이다.

상품 준비에서 남은 일은 이 변경 적용 후 확률표 8개 만들기·공개와 `ON_SALE` 전환이다.

## 관리자 웹에서 하는 순서 (상품마다)

1. `admin.dabboba.net` → 상품 목록 → 상품 → **가챠 확률표**.
2. "새 확률표 초안"에서 아래 표의 경품 SKU를 모두 넣고, 각 SKU의 **수량**을 입력한다. 등급 칸은 자유 문구(`일반`, `시크릿` 등)이고 확률에는 영향이 없다.
   - 가챠 확률은 **수량 비례**다. 각 SKU의 남은 개수 ÷ 전체 남은 개수가 현재 확률이고, 가중치는 모두 1이어야 한다.
   - 수량 합계가 재고 `on_hand`와 같아야 공개할 수 있다(합계가 다르면 화면이 오류/경고로 알려 준다).
3. 초안 저장 → "이 버전 공개"에 사유를 적고 공개한다. 공개 후에는 수정할 수 없고 새 버전으로만 바꾼다.
4. 상품 수정에서 판매 상태를 `ON_SALE`로 바꾼다. 조건: 활성·가격 > 0·이미지·재고 > 0·**공개된 확률표**. PRELAUNCH 동안에도 결제는 막혀 있으니 미리 열어도 된다.

## 상품별 경품 구성

자동 배분값은 재고 자료(392개)를 종류 수로 나눈 것이다. **실물 검수 결과가 다르면 실제 개수를 넣는다.** 합계만 재고와 맞으면 된다.

### 1. 먼작귀 모니터 컵케이크 피규어 — `gacha-chiikawa-monitor-cupcake` · 6,000원 · 재고 50

| 경품 SKU | 현재 등록 이름 | 수량(자동 배분) |
|---|---|---:|
| `…-prize-01` | 먼작귀 컵케이크 1번 구성 | 8 |
| `…-prize-02` ~ `…-prize-07` | 먼작귀 컵케이크 2~7번 구성 | 7씩 (6종) |

**숫자 이름 승인됨(2026-10-12)**: `1`~`7`로 표시하고 추후 수정한다. `0095` 적용 후 확률표를 만든다. 재고는 변경하지 않는다.

### 2. 데스노트 콜렉션 피규어 리치 — `gacha-death-note-collection-rich` · 7,000원 · 재고 20

| 경품 SKU | 이름 | 수량 |
|---|---|---:|
| `…-prize-01` | 니아 | 4 |
| `…-prize-02` | 멜로 | 4 |
| `…-prize-03` | 아마네 미사 | 4 |
| `…-prize-04` | 야가미 라이토 | 4 |
| `…-prize-05` | L | 4 |

### 3. 귀멸의 칼날 오네무탄 13형 — `gacha-demon-slayer-onemutan-13` · 6,000원 · 재고 60

| 경품 SKU | 이름 | 수량 |
|---|---|---:|
| `…-prize-01` | 굣코 | 12 |
| `…-prize-02` | 도우마 | 12 |
| `…-prize-03` | 카이가쿠 | 12 |
| `…-prize-04` | 키부츠지 무잔 | 12 |
| `…-prize-05` | 한텐구&조하쿠텐 | 12 |

### 4. 귀멸의 칼날 페탓토 태엽감기 마스코트 Vol.2 — `gacha-demon-slayer-petatto-2` · 7,000원 · 재고 60

| 경품 SKU | 이름 | 수량 |
|---|---|---:|
| `…-prize-01` | 렌고쿠 쿄쥬로 | 12 |
| `…-prize-02` | 우즈이 텐겐 | 12 |
| `…-prize-03` | 츠유리 카나오 | 12 |
| `…-prize-04` | 코쵸우 시노부 | 12 |
| `…-prize-05` | 토미오카 기유 | 12 |

### 5. 귀멸의 칼날 페탓토 태엽감기 마스코트 Vol.3 — `gacha-demon-slayer-petatto-3` · 7,000원 · 재고 60

| 경품 SKU | 이름 | 수량 |
|---|---|---:|
| `…-prize-01` | 시나즈가와 사네미 | 12 |
| `…-prize-02` | 이구로 오바나이 | 12 |
| `…-prize-03` | 칸로지 미츠리 | 12 |
| `…-prize-04` | 토키토 무이치로 | 12 |
| `…-prize-05` | 히메지와 교메이 | 12 |

### 6. 하츠네미쿠 페타돌 피어프로 캐릭터즈 — `gacha-hatsune-miku-petadoll` · 16,000원 · 재고 72

| 경품 SKU | 이름 | 수량 |
|---|---|---:|
| `…-prize-01` | 메구리네 루카 | 12 |
| `…-prize-02` | 메이코 | 12 |
| `…-prize-03` | 카가미네 렌 | 12 |
| `…-prize-04` | 카가미네 린 | 12 |
| `…-prize-05` | 카이토 | 12 |
| `…-prize-06` | 하츠네 미쿠 | 12 |

### 7. 산리오 캐릭터즈 캔 속 피규어 — `gacha-sanrio-can-figures` · 5,000원 · 재고 40

| 경품 SKU | 현재 등록 이름 | 수량 |
|---|---|---:|
| `…-prize-01` ~ `…-prize-05` | 산리오 캔 속 피규어 1~5번 구성 | 8씩 (5종) |

**숫자 이름 승인됨(2026-10-12)**: `1`~`5`로 표시하고 추후 수정한다. `0095` 적용 후 확률표를 만든다. 재고는 변경하지 않는다.

### 8. 실바니안 패밀리 아기 어드벤처 시리즈 — `gacha-sylvanian-adventure` · 11,000원 · 재고 30

| 경품 SKU | 이름 | 수량 |
|---|---|---:|
| `…-prize-01` | 시크릿 | 3 |
| `…-prize-02` | 아기 라테네코 고양이와 헬멧&광차 | 4 |
| `…-prize-03` | 아기 밀크 토끼와 선인장 코스튬 | 4 |
| `…-prize-04` | 아기 초콜릿 토끼와 티아라 | 4 |
| `…-prize-05` | 아기 팬더와 미라 코스튬 | 4 |
| `…-prize-06` | 아기 허스키와 곡괭이 | 4 |
| `…-prize-07` | 아기 호랑이와 카우보이 모자 | 4 |
| `…-prize-08` | 엎드린 아기 물범과 악어 코스튬 | 3 |

자동 배분은 4×6종 + 3×2종이다. 어느 2종이 3개인지는 실물 검수로 정한다(위 표는 시크릿과 마지막 항목을 3으로 둔 예시).

## 끝났는지 확인하는 방법

운영 DB에서 아래 조회가 8행 모두 `ACTIVE` 확률표 1개, 수량 합계 = 재고, `ON_SALE`이면 상품 준비는 끝이다.
읽기 전용이라 Supabase SQL 편집기에서 그대로 실행해도 된다.

```sql
SELECT p.id, p.sale_status, s.on_hand,
  (SELECT count(*) FROM draw_probability_versions v WHERE v.product_id=p.id AND v.status='ACTIVE') AS active_versions,
  (SELECT sum(e.initial_quantity) FROM draw_pool_entries e JOIN draw_probability_versions v ON v.id=e.probability_version_id
    WHERE v.product_id=p.id AND v.status='ACTIVE') AS active_pool_qty,
  (SELECT count(*) FROM catalog_products pr WHERE pr.is_prize_only AND pr.metadata->>'parentProductId'=p.id
    AND (pr.metadata->>'namePending')::boolean) AS names_pending
FROM catalog_products p JOIN product_stock s ON s.product_id=p.id
WHERE p.id IN ('gacha-chiikawa-monitor-cupcake','gacha-death-note-collection-rich','gacha-demon-slayer-onemutan-13',
  'gacha-demon-slayer-petatto-2','gacha-demon-slayer-petatto-3','gacha-hatsune-miku-petadoll',
  'gacha-sanrio-can-figures','gacha-sylvanian-adventure')
ORDER BY p.id;
```

`names_pending`이 0이 아니면 그 상품의 경품 이름이 아직 `N번 구성`이다. 이름을 바꿀 때 상품 수정 화면이 `namePending` 표시도 지우는지 확인하고, 지우지 않으면 이 조회에서는 계속 0이 아닐 수 있다(표시만 남은 것이면 판매에는 영향이 없다).

## 하지 않는 것

- 운영 DB에 확률표나 판매 상태를 SQL로 직접 넣지 않는다. 관리자 웹의 공개 절차가 감사 기록·멱등성·수량 검증을 담당한다.
- 자동 배분값을 실제 확률 약속으로 쓰지 않는다. LIVE에서는 서버가 남은 수량으로 확률을 계산해 공개한다.
- 쿠지는 첫 출시 범위 밖이다. 판매 중 쿠지가 0개여야 LIVE 검증이 통과한다.
