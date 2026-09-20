# DABBOBA IP 시스템 아키텍처

> **역사 문서:** 아래 내용은 서버 도입 전 Phase 1 프런트엔드 기준선이다. 현재 구현 상태와 운영 판단은 [`dabboba-production-architecture.md`](./dabboba-production-architecture.md)를 우선한다. 현재 백엔드는 FastAPI가 아니라 Fastify 기반 TypeScript 모듈러 모놀리스이며 PostgreSQL migration, API, worker, 관리자 웹이 추가되어 있다.

## 1. 문서 목적

이 문서는 현재 `dabboba-app`의 실제 구현 범위와, 향후 애니메이션·게임 IP 중심 수집 플랫폼으로 확장할 때의 경계를 정의한다.

현재 저장소는 React + TypeScript + Vite로 만든 **프런트엔드 전용 앱웹 프로토타입**이다. FastAPI, PostgreSQL, 사용자 인증, 교환 등록·신청, 상품 신청·좋아요, 미디어 업로드, 검색 API는 아직 존재하지 않는다. 따라서 Phase 1에서는 24~25개 IP를 로컬 fixture와 테스트 이미지로 표시하고, 이후 단계에서 같은 계약을 FastAPI/PostgreSQL로 교체하는 방식을 사용한다.

이 문서의 원칙은 다음과 같다.

- 상품 목록 → 상세 → 수량 선택 → 모의 결제까지는 공통으로 유지하고, 가챠·쿠지는 오락기 추첨으로, 피규어·카드는 일반 구매 완료로 분기한다.
- 현재 모바일 런타임과 `FlowStack`을 교체하지 않는다.
- Phase 1 fixture를 실제 DB나 API 구현으로 오해하지 않는다.
- IP, Character, Product는 안정적인 ID로 연결하고 화면 표시명을 관계 키로 사용하지 않는다.
- 가챠·피규어·쿠지·카드의 공통 정보와 카테고리별 정보를 분리한다.
- 큰 일괄 전환 대신 읽기 API부터 단계적으로 연결한다.

## 2. 현재 저장소 기준선

### 2.1 존재하는 것

- React 19 + TypeScript + Vite 기반 단일 프런트엔드 앱
- SEED Design의 `ActionButton`, Karrot 아이콘, DABBOBA 전용 CSS 토큰
- `MobileRuntime`, `MobileScroll`, `Carousel`, `BottomSheet`, `FlowStack`
- 교환방 → 뽀바 → 홈 → 덕룸 → 프로필 순서의 5개 루트 탭 구조와 프런트엔드 표시용 fixture
- `src/fixtures/product-seed.json`과 typed adapter로 연결된 IP별 테스트 상품 25개
- React Context와 `useState` 기반 인메모리 결제·포인트·뽑기·일반 구매 완료·프로필 편집 상태
- 정적 파일을 제공하고 HTML 경로만 SPA 셸로 되돌리는 Cloudflare Worker
- `public/assets/dabboba` 아래의 정적 이미지

### 2.2 존재하지 않는 것

- FastAPI 또는 다른 애플리케이션 백엔드
- PostgreSQL, ORM 모델, Alembic migration
- User/Auth 모델
- ExchangeListing, ExchangeApplication, ProductRequest, RequestLike, Snap 모델
- UserCollection, Wishlist 영속화
- 교환방·신청방·덕룸·프로필의 등록 글, 교환 신청, 요청 좋아요, 미디어, 수집품, 계정 상태를 저장하는 서버 API와 DB 영속화
- 이미지 업로드 및 Google Cloud Storage 연동
- 도메인 검색 API
- PG 결제 승인/웹훅, 주문·주문 상품·배송 영속화, 서버 재고 잠금, 서버 추첨 원장

현재 화면의 포인트, 찜, 모의 결제, 추첨 결과, 일반 구매 완료 표시와 교환방·신청방·덕룸·프로필 콘텐츠는 브라우저 메모리 또는 로컬 fixture에만 존재하며 새로고침하면 초기화될 수 있다. 현재 클라이언트 추첨은 실제 상품 지급 근거가 아니며, 피규어·카드의 구매 완료 화면도 PG 승인, 주문 생성, 재고 차감, 배송 접수가 완료됐음을 의미하지 않는다. 교환 글·교환 신청·상품 신청·요청 좋아요·미디어 등록·수집품 표시·프로필 상세 변경 역시 실제 사용자 정보나 서버 저장 완료 상태를 의미하지 않는다.

## 3. Phase 1: 프런트엔드 fixture

### 3.1 목표

Phase 1의 목표는 전체 플랫폼을 구현하는 것이 아니라 다음 사용자 경험을 검증하는 것이다.

1. 홈에서 인기 IP 목록을 이미지와 함께 탐색한다.
2. 한국어·영어·일본어·별칭으로 IP를 찾는다.
3. IP를 선택해 기본 설명, 대표 캐릭터, 실제 연결된 테스트 상품을 확인한다.
4. 네 상품 카테고리와 공통 결제 흐름을 사용하되, 가챠·쿠지는 추첨, 피규어·카드는 일반 구매 완료로 이어진다.
5. 나중에 fixture 대신 API 응답을 넣어도 UI 컴포넌트를 크게 바꾸지 않는다.

Phase 1에서는 User, Collection, Wishlist, ExchangeListing, ExchangeApplication, ProductRequest, RequestLike, Snap, 관리자의 서버 모델과 영속 CRUD를 구현하지 않는다. 교환방·고객센터 신청방·덕룸·프로필 화면은 정보 구조와 탐색 UX를 확인하는 로컬 fixture 범위로만 제공한다.

### 3.2 현재 fixture 계약

카테고리와 IP 요약 타입은 `src/domain/catalog.ts`에서 중앙 관리한다.

```ts
type ProductCategoryId = "gacha" | "figure" | "kuji" | "tcg";
type CommerceMode = "draw" | "purchase";

type IpRecord = {
  id: string;
  slug: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  aliases: string[];
  image: string;
  description: string;
  featured: boolean;
  isActive: boolean;
  availableCategories: ProductCategoryId[];
  characters: string[];
  sourceMediaId: string;
  sourcePage: string;
};
```

`commerceModeForCategory(categoryId)`는 가챠·쿠지를 `draw`, 피규어·카드를 `purchase`로 분류하는 현재 프런트엔드 계약이다. 화면에서 한글 표시명을 비교하지 않고 안정적인 `categoryId`로 분기한다. 추후 같은 카테고리 내에서 판매 방식이 달라지면 이 규칙을 `ProductRecord.commerceMode`과 같은 명시적 상품 필드로 옮긴다.

`src/fixtures/ip-seed.json`은 로컬 테스트 데이터다. 운영 DB seed나 외부 API의 진실 공급원으로 간주하지 않는다. UI에서는 배열 순서나 표시명을 ID처럼 사용하지 않고 `id` 또는 `slug`를 사용한다.

번들 fixture에는 상품과 IP를 넣지 않는다. `src/fixtures/product-seed.json`과
`src/fixtures/ip-seed.json`은 빈 배열을 유지하며, 실제 상품·IP·재고·이미지는
관리자/API와 관리형 저장소를 통해 등록한다. 과거 프로토타입 상품은 참조 무결성을
위해 DB에서 삭제하지 않고 비활성화한다.

### 3.3 IP 수량 결정

IP 수량은 관리자/API에 등록된 활성 레코드에서 계산한다. 앱이나 fixture에 고정 수량을
두지 않으며, 운영자가 비활성화한 IP는 고객 화면에서 제외한다.

### 3.4 이미지 정책

브랜드·아이콘·뽑기 연출 자산만 앱 번들에 둔다. 실제 상품과 IP 이미지는 관리형
저장소에 업로드하고 DB에는 검증된 객체 경로와 메타데이터만 저장한다.

- 외부 사이트 이미지를 런타임에서 직접 hotlink하지 않는다.
- 상품 업로드 시 MIME, 크기, 소유권과 이미지 처리 상태를 검증한다.
- 운영·광고·앱스토어 배포에는 권리자가 허용한 공식 또는 라이선스 자산만 사용한다.
- 프런트에서는 원본 종횡비, 지연 로딩, 실패 fallback을 유지한다.

### 3.5 Phase 1 화면 구조

현재 런타임을 유지하면서 다음 구조를 사용한다.

```text
루트 탭 네비게이션 (고정 순서)
├─ 교환방: 제목·카테고리·작품 IP·올린 상품·원하는 교환품·상세를 등록하고 교환 신청 확인
├─ 뽀바: 가챠 / 피규어 / 쿠지 / 카드 검색·선택과 구매 진입
├─ 홈: 현재 DABBOBA 탐색 홈
├─ 덕룸: 사용자의 가챠·피규어 수집 자랑
└─ 프로필: 계정 요약과 관련 메뉴, 고객센터 신청방 진입

Customer Center FlowScreens
├─ 고객센터: 신청방 안내와 진입
└─ 신청방: 가챠 / 카드 / 피규어 / 쿠지, 작품 IP, 원하는 상품, 상세 등록과 좋아요

Home Catalog FlowScreen
├─ 기존 DABBOBA 헤더와 히어로
├─ 인기 IP 가로 목록과 전체보기 진입
└─ 기존 상품 카테고리 및 상품 카드

IP Catalog FlowScreen
├─ 기존 BackHeader
├─ 한국어·영어·일본어·별칭 검색
└─ 전체 IP 3열 카드 그리드

IP Detail FlowScreen
├─ 기존 BackHeader
├─ IP 포스터, 명칭, 설명
├─ 가챠 / 피규어 / 쿠지 / 카드 상태
└─ 상품 상세 진입 / 캐릭터 / 스냅 / 교환방 탭

Commerce FlowScreens
├─ 공통: 상품 상세 → 수량 선택 → 모의 결제
├─ 가챠·쿠지: DABBOBA ARCADE 추첨 → 결과
└─ 피규어·카드: 일반 구매 완료
```

하단 네비게이션은 위 5개 루트 화면에서만 노출한다. 탭 전환은 루트 스택을 늘리지 않도록 `FlowStack.replace()`를 사용하고, 교환 상세·고객센터·신청방·IP 목록·IP 상세·상품 상세·결제·추첨·일반 구매 완료 같은 하위 화면에서는 숨긴다. 이로써 하위 화면의 뒤로 가기와 구매 전용 고정 하단 버튼을 네비게이션과 겹치지 않게 유지한다.

IP 상세는 `FlowStack.push()`로 열고 별도 라우터를 도입하지 않는다. 검색 입력을 넣을 경우 반드시 런타임의 `KeyboardInput`을 사용한다. 교환방·신청방·덕룸·프로필에 표시되는 사용자, 등록 글, 교환 신청, 요청 좋아요, 미디어, 수집품, 계정 정보는 현재 모두 로컬 fixture이며 서버 영속화나 실제 계정 연결을 의미하지 않는다. 프로필 상세에서 닉네임·한 줄 소개·좋아하는 작품을 바꾸는 기능도 현재 브라우저 세션의 React 상태에만 반영되며 새로고침 후 유지를 보장하지 않는다.

### 3.6 Phase 1 완료 기준

- 루트 화면에서 교환방 → 뽀바 → 홈 → 덕룸 → 프로필 순서의 하단 네비게이션과 현재 탭 상태가 일관되게 표시된다.
- 교환 상세·고객센터·신청방·IP·상품·결제·추첨·일반 구매 완료 하위 화면에서는 루트 네비게이션이 숨겨지고 기존 뒤로 가기와 구매 하단 버튼이 유지된다.
- 교환방은 제목·카테고리·작품 IP·올린 상품·원하는 교환품·상세를 등록하고, 푸시된 상세 화면에서 제안 상품과 메시지로 교환을 신청할 수 있다.
- 프로필의 고객센터에서 신청방으로 진입해 가챠·카드·피규어·쿠지, 작품 IP, 원하는 상품과 상세를 등록하고 한 사용자당 하나의 로컬 좋아요를 토글할 수 있다.
- 교환방·신청방·덕룸·프로필은 로컬 fixture로 렌더링되며, 서버 저장이나 실제 계정 연결을 완료한 것으로 표시하지 않는다.
- 가챠·쿠지는 모의 결제 후 DABBOBA ARCADE와 결과 화면으로 이어지고, 피규어·카드는 추첨 없이 일반 구매 완료 화면으로 이어진다.
- 프로필 상세 변경은 현재 브라우저 세션에서만 반영되며 실제 계정 저장으로 표시하지 않는다.
- 결정된 수량의 모든 IP 카드가 렌더링된다.
- 25개 테스트 상품이 가챠 8 / 피규어 8 / 쿠지 7 / 카드 2로 렌더링된다.
- 카드 카테고리에는 원피스와 포켓몬스터만 노출된다.
- 한국어, 영어, 일본어, 별칭 검색 결과가 일관된다.
- 모든 로컬 이미지가 200 응답이고 깨진 이미지가 없다.
- IP 카드 탭과 뒤로 가기가 iPhone/Pixel 프레임에서 동작한다.
- 기존 상품 카테고리 필터와 공통 결제 흐름, 카테고리별 추첨·일반 구매 완료 분기가 유지된다.
- 가로 오버플로, 고정 헤더 이동, 키보드 겹침이 없다.
- 현재 단일 workspace 기준 명령인 `pnpm run check:runtime`, `pnpm run build`, `pnpm run test:runtime`, `pnpm run test:sites`가 통과한다.
- 인앱 브라우저에서 새 IP 검색·상세 탭, 공통 결제 진입, 가챠·쿠지 추첨과 피규어·카드 구매 완료 분기를 확인한다.

## 4. 프런트엔드와 향후 API의 경계

fixture와 API는 동일한 요약 응답 형태를 사용한다. Phase 1 컴포넌트가 JSON 파일 위치를 직접 알지 않도록 조회 함수를 한 단계 두는 것이 바람직하다.

```ts
type IpCatalogQuery = {
  query?: string;
  featured?: boolean;
  category?: ProductCategoryId;
  cursor?: string;
  limit?: number;
};

type IpCatalogPage = {
  items: IpRecord[];
  nextCursor: string | null;
};
```

Phase 1 조회기는 fixture를 필터링하고, API 전환 후에는 OpenAPI 계약에 맞춘 HTTP 클라이언트로 교체한다. 컴포넌트가 `fetch`, URL, DB 필드명을 직접 소유하지 않도록 한다.

권장 읽기 API는 다음과 같다.

```text
GET /v1/ips?query=&featured=&category=&limit=&cursor=
GET /v1/ips/{slug}
GET /v1/ips/{slug}/characters?limit=&cursor=
GET /v1/ips/{slug}/products?category=&limit=&cursor=
GET /v1/characters/{id}
GET /v1/products/{id}
```

응답에는 화면에 필요한 요약만 포함하고, 상세 관계는 별도 endpoint에서 페이지네이션한다. 수백~수천 IP와 대규모 상품 데이터에서 전체 중첩 객체를 한 번에 반환하지 않는다.

## 5. 향후 FastAPI 서비스 구조

FastAPI 백엔드는 현재 저장소 안에 존재하지 않는다. 실제 도입 시 별도 서비스 또는 모노레포의 독립 패키지로 추가하고 프런트 빌드 Worker에 억지로 합치지 않는다.

제안 구조는 다음과 같다.

```text
backend/
  app/
    api/v1/
      ips.py
      characters.py
      products.py
      collections.py
      wishlists.py
      snaps.py
      communities.py
    catalog/
      models.py
      schemas.py
      repository.py
      service.py
      search.py
    users/
    social/
    media/
    payments/
    database.py
    main.py
  alembic/
  scripts/
    seed_catalog.py
  tests/
```

경계별 책임은 다음과 같다.

- Router: HTTP 파라미터, 인증 의존성, 응답 코드
- Schema: Pydantic 요청/응답 계약과 OpenAPI
- Service: 비즈니스 규칙과 트랜잭션 경계
- Repository: SQLAlchemy 쿼리와 pagination
- Model: PostgreSQL 영속 모델
- Search: 정규화, 검색 순위, 검색 쿼리

대량 seed는 Alembic 스키마 migration에 직접 넣지 않는다. `seed_catalog.py`가 `slug` 기준으로 검증·upsert하도록 분리한다.

## 6. PostgreSQL 핵심 스키마

### 6.1 카탈로그 공통 테이블

#### `ips`

```text
id uuid PK
slug varchar UNIQUE NOT NULL
name_ko varchar NOT NULL
name_en varchar NULL
name_ja varchar NULL
original_name varchar NULL
description text NULL
thumbnail_media_id uuid NULL FK media_assets
banner_media_id uuid NULL FK media_assets
is_featured boolean NOT NULL DEFAULT false
is_active boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

#### `ip_aliases`

```text
id uuid PK
ip_id uuid NOT NULL FK ips ON DELETE CASCADE
locale varchar NULL
value varchar NOT NULL
normalized_value varchar NOT NULL
UNIQUE(ip_id, normalized_value)
```

별칭은 PostgreSQL 배열 한 칸에 넣지 않고 행으로 분리한다. 그래야 별칭별 중복 검증, 검색 인덱스, 관리자 병합이 가능하다.

#### `characters`

```text
id uuid PK
ip_id uuid NOT NULL FK ips
slug varchar NOT NULL
name_ko varchar NOT NULL
name_en varchar NULL
name_ja varchar NULL
description text NULL
thumbnail_media_id uuid NULL FK media_assets
is_active boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
UNIQUE(ip_id, slug)
```

캐릭터 별칭은 `character_aliases`로 분리하고 `ip_id`를 포함한 검색 범위를 지원한다.

#### `product_categories`

```text
id smallint PK
code varchar UNIQUE NOT NULL  -- gacha, figure, kuji, tcg
name_ko varchar NOT NULL
sort_order smallint NOT NULL
is_active boolean NOT NULL DEFAULT true
```

고정된 네 카테고리는 이 테이블에 seed한다. 화면과 API는 언어 라벨이 아니라 `code`를 계약 값으로 사용한다.

#### `manufacturers`

```text
id uuid PK
slug varchar UNIQUE NOT NULL
name varchar NOT NULL
name_ko varchar NULL
website_url text NULL
is_active boolean NOT NULL DEFAULT true
```

#### `products`

```text
id uuid PK
ip_id uuid NOT NULL FK ips
category_id smallint NOT NULL FK product_categories
manufacturer_id uuid NULL FK manufacturers
slug varchar UNIQUE NOT NULL
name_ko varchar NOT NULL
name_en varchar NULL
description text NULL
release_date date NULL
list_price numeric(14,2) NULL
currency char(3) NULL
primary_media_id uuid NULL FK media_assets
status varchar NOT NULL
is_limited boolean NOT NULL DEFAULT false
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

`products`에는 모든 카테고리 전용 필드를 넣지 않는다. 상품과 캐릭터는 `product_characters(product_id, character_id)`로 N:M 연결한다.

### 6.2 카테고리별 테이블

```text
gacha_series
├─ id, ip_id, name, manufacturer_id, release_date, price_per_draw
└─ gacha_items
   └─ id, series_id, product_id, display_order, probability

figure_details
└─ product_id PK/FK, brand, series_name, scale, height_mm,
   preorder_start_at, jan_code, is_rerelease

kuji_series
├─ id, ip_id, name, manufacturer_id, release_date, price_per_draw
└─ kuji_prizes
   └─ id, series_id, rank_code, product_id, name, display_order

card_games
├─ id, ip_id, name, publisher_id
└─ card_sets
   ├─ id, card_game_id, name, set_code, release_date
   └─ cards
      └─ product_id PK/FK, card_set_id, card_number, rarity_code,
         language_code, is_promo, is_parallel
```

쿠지의 `rank_code`는 A/B/C enum으로 제한하지 않는다. `LAST_ONE`, `DOUBLE_CHANCE`, `SPECIAL` 같은 문자열을 허용하되 시리즈 안에서 정렬 순서를 별도 보관한다.

카드는 일반 상품과 동일한 컬렉션·위시리스트 연결을 얻기 위해 `products`의 한 행을 공유하되, 세트·카드 번호·레어도는 `cards`에 보관한다.

### 6.3 사용자와 소셜 확장

```text
user_collections
├─ id, user_id, product_id, quantity, acquired_at
├─ purchase_price, purchase_date, condition_code, is_opened
├─ is_tradeable, note
└─ UNIQUE(user_id, product_id)

wishlists
└─ user_id, product_id, created_at, UNIQUE(user_id, product_id)

posts
└─ 기존 Post가 생기면 재사용

post_media
└─ post_id, media_asset_id, sort_order

post_ips / post_characters / post_products
└─ 게시물 태그용 N:M 연결
```

`quantity`는 1 이상이어야 하며 중복 가챠·쿠지·카드 보유량을 한 행에서 관리한다. 개별 실물의 상태나 인증번호를 추적해야 할 때만 `collection_items` 하위 테이블을 추가한다.

### 6.4 미디어

```text
media_assets
├─ id uuid PK
├─ storage_provider, object_key, mime_type, width, height, byte_size
├─ checksum, source_url, rights_holder, license_note
├─ status, created_by, created_at
└─ UNIQUE(storage_provider, object_key)
```

운영 이미지는 Google Cloud Storage에 저장하고 DB에는 object key와 메타데이터만 저장한다. 업로드는 서명 URL, MIME 검사, 크기 제한, checksum 검증을 거친 뒤 도메인 객체에 연결한다.

## 7. IP 중심 관계

```text
Ip
├─ 1:N Character
├─ 1:N Product
├─ 1:N GachaSeries
├─ 1:N KujiSeries
├─ 1:N CardGame
├─ N:M Post
└─ N:M MediaAsset through domain references

Product
├─ N:1 Ip
├─ N:1 ProductCategory
├─ N:1 Manufacturer
├─ N:M Character
├─ 1:0..1 FigureDetails / Card
├─ N:M User through UserCollection
├─ N:M User through Wishlist
└─ N:M Post
```

`Ip → Character → Product`가 단순한 단방향 체인이라는 뜻은 아니다. Product는 반드시 `ip_id`를 직접 가져 IP별 상품 조회를 빠르게 하고, 캐릭터 연결은 N:M으로 별도 유지한다.

IP 병합 시에는 대상 IP로 Character·Product·Alias·Post 연결을 한 트랜잭션에서 이동하고, 기존 slug는 redirect alias로 보존한다.

## 8. 검색 정규화와 인덱스

### 8.1 검색 전략

초기 한국어/영어/일본어 검색은 PostgreSQL `pg_trgm`을 기본으로 한다. PostgreSQL 기본 full-text parser만으로 한국어 형태소 검색을 해결하려 하지 않는다.

서버 정규화 규칙은 Phase 1의 `normalizeCatalogSearch`와 같은 의미를 가져야 한다.

1. Unicode NFKC 정규화
2. locale-independent lowercase
3. 공백과 구두점 제거 또는 단일 공백 정규화
4. 관리자 입력 별칭을 `normalized_value`로 저장
5. 완전 일치 → 접두 일치 → trigram 유사도 순으로 정렬

프런트 정규화는 UX 보조용이며 서버 검색의 보안·정합성 근거가 아니다.

### 8.2 필수 인덱스

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE UNIQUE INDEX ips_slug_uq ON ips (slug);
CREATE INDEX ips_active_featured_idx
  ON ips (is_featured DESC, updated_at DESC)
  WHERE is_active = true;

CREATE INDEX ips_name_ko_trgm_idx
  ON ips USING gin (name_ko gin_trgm_ops)
  WHERE is_active = true;
CREATE INDEX ips_name_en_trgm_idx
  ON ips USING gin (name_en gin_trgm_ops)
  WHERE is_active = true;
CREATE INDEX ips_name_ja_trgm_idx
  ON ips USING gin (name_ja gin_trgm_ops)
  WHERE is_active = true;

CREATE INDEX ip_aliases_normalized_trgm_idx
  ON ip_aliases USING gin (normalized_value gin_trgm_ops);
CREATE INDEX characters_ip_id_idx ON characters (ip_id);
CREATE INDEX products_ip_category_idx ON products (ip_id, category_id, status);
CREATE INDEX product_characters_character_idx
  ON product_characters (character_id, product_id);
CREATE INDEX user_collections_user_created_idx
  ON user_collections (user_id, created_at DESC);
CREATE INDEX wishlists_user_created_idx
  ON wishlists (user_id, created_at DESC);
```

문자열 함수 표현식 인덱스는 애플리케이션의 정규화와 정확히 같은 결과를 보장할 때만 사용한다. 그렇지 않으면 저장 시 계산한 `normalized_*` 열을 사용한다.

### 8.3 검색 확장 시점

- IP 수천, Product 수십만 규모까지는 PostgreSQL + `pg_trgm`과 cursor pagination을 우선 사용한다.
- 실제 쿼리 로그와 `EXPLAIN ANALYZE` 없이 외부 검색엔진을 먼저 추가하지 않는다.
- 상품·캐릭터·카드 통합 검색이 커지면 `search_documents` 투영 테이블을 고려한다.
- 외부 검색엔진을 도입하더라도 PostgreSQL을 원본 데이터 저장소로 유지한다.

## 9. Migration 및 전환 단계

모든 단계는 additive migration을 기본으로 하고, 한 단계의 읽기·쓰기 검증이 끝난 뒤 다음 단계로 이동한다.

### Stage 0 — 계약 고정

- Phase 1 fixture 필드와 UI 요구를 확정한다.
- 24/25 IP 수량을 확정한다.
- 카테고리 code를 `gacha`, `figure`, `kuji`, `tcg`로 고정한다.
- 이미지 권리와 운영 교체 대상을 표시한다.

### Stage 1 — 카탈로그 코어

- PostgreSQL과 Alembic 초기화
- `pg_trgm` extension
- `ips`, `ip_aliases`, `product_categories`, `media_assets`
- 4개 카테고리 idempotent seed
- IP seed import 검증기

### Stage 2 — Character와 Product

- `characters`, `character_aliases`
- `manufacturers`, `products`, `product_characters`
- slug 및 FK 인덱스
- IP/캐릭터/상품 읽기 API와 contract test

### Stage 3 — 카테고리 세부 구조

- `gacha_series`, `gacha_items`
- `figure_details`
- `kuji_series`, `kuji_prizes`
- `card_games`, `card_sets`, `cards`
- 카테고리별 유효성 검사

### Stage 4 — 프런트 읽기 전환

- FastAPI OpenAPI 계약에서 TypeScript 응답 타입 생성 또는 수동 경계 타입 검증
- IP 목록과 상세를 API로 전환
- fixture fallback은 개발 환경에만 제한
- 로딩, 빈 결과, 오류, 이미지 fallback 검증
- API 전환 후 fixture 직접 import 제거

### Stage 5 — Collection과 Wishlist

- 인증된 User 기준 `user_collections`, `wishlists`
- 수량 증가/감소의 원자적 update
- 동일 사용자·상품 중복 방지
- 낙관적 UI 실패 rollback

### Stage 6 — 교환방·신청방·Snap 연결

- 현재 교환방·신청방·덕룸 UI fixture를 영속 데이터로 간주하지 않고, 인증·소유권·신고 정책을 포함한 서버 계약을 먼저 고정한다.
- 교환 글과 교환 신청은 작성자, 카테고리, IP, 제안 상품, 원하는 교환품, 상태 이력을 분리하고 수락·거절·완료 권한을 서버에서 검사한다.
- 상품 신청은 카테고리, IP, 원하는 상품, 상세를 저장하고 사용자·요청 조합에 고유 제약을 둔 좋아요로 관심도를 집계한다.
- IP, Character, Product 관계와 교환 미디어를 연결하고 생성·삭제·비공개·신고 상태에서도 참조 무결성을 유지한다.

### Stage 7 — 관리자와 병합

- IP/상품 추가 요청
- 관리자 승인과 감사 로그
- 중복 IP/Character/Product 병합
- redirect slug와 별칭 보존

### Stage 8 — 실결제·주문과 추첨

- PG 승인과 웹훅 idempotency key
- 가챠·쿠지는 결제 성공 후 추첨 이용권과 재고를 원자적으로 발급·차감
- 피규어·카드는 결제 성공 후 주문·주문 상품을 생성하고 판매 재고를 원자적으로 차감
- 서버 CSPRNG 기반 추첨
- 확률 버전, 재고 스냅샷, 지급 결과 불변 원장
- 클라이언트 `Math.random()` 제거

## 10. 파일 변경 계획

### 10.1 Phase 1 범위

| 파일 | 상태/계획 | 책임 |
|---|---|---|
| `src/domain/catalog.ts` | 추가됨 | 카테고리 code, `commerceMode` 분기, IP 타입, 검색 정규화 |
| `src/fixtures/ip-seed.json` | 빈 구조 유지 | 번들 IP 데이터가 재유입되지 않게 하는 경계 |
| `src/fixtures/product-seed.json` | 빈 구조 유지 | 번들 상품 데이터가 재유입되지 않게 하는 경계 |
| 관리형 Storage | 운영 등록 대상 | 실제 IP·상품 이미지와 검증된 미디어 메타데이터 |
| `src/Prototype.tsx` | UI 통합 대상 | IP 목록·검색·상세, 추첨, 일반 구매 완료 FlowScreen |
| `src/prototype.css` | UI 통합 대상 | IP 카드·검색·상세 반응형 스타일 |
| `tests/dabboba-ip-catalog.spec.ts` | 추가 권장 | 카드 수, 검색, 이미지, 이동, 기존 흐름 회귀 |
| `design-qa.md` | 시각 검증 후 갱신 | iPhone/Pixel 비교와 남은 이슈 기록 |
| `AGENTS.md` | 결정 확정 후 최소 갱신 | fixture/test-only 이미지와 IP 탐색 규칙 기록 |
| `docs/ip-system-architecture.md` | 이 문서 | 현재/향후 경계와 migration 계획 |

### 10.2 Phase 1에서 수정하지 않는 파일

- `src/App.tsx`
- `src/main.tsx`
- `src/styles.css`
- `src/mobile/**`
- `vite.config.ts`
- `worker/index.js`
- `scripts/prepare-sites-build.mjs`
- `mobile-runtime.lock.json`

위 파일은 모바일 런타임 또는 정적 호스팅 경계다. IP fixture UI를 추가하기 위해 수정할 필요가 없다.

### 10.3 향후 백엔드 파일

FastAPI/PostgreSQL 파일은 현재 저장소에 아직 존재하지 않으며 Phase 1에서 만들지 않는다. 백엔드 도입 결정 후 다음 파일군을 별도 변경 세트로 만든다.

```text
backend/app/catalog/{models,schemas,repository,service,search}.py
backend/app/api/v1/{ips,characters,products}.py
backend/alembic/versions/*_catalog_core.py
backend/scripts/seed_catalog.py
backend/tests/catalog/
```

## 11. 운영 전 확인 사항

- 모든 IP 이미지의 사용 권한과 지역별 라이선스를 확인한다.
- Kitsu 등 외부 메타데이터는 참고 출처일 뿐 운영 원본 데이터 계약으로 사용하지 않는다.
- 이름·별칭·캐릭터 정보는 관리자 검수를 거친다.
- API 요청에 limit 상한, cursor pagination, rate limit을 적용한다.
- 관리자 변경과 병합에는 감사 로그를 남긴다.
- PG 결제, 주문, 재고, 추첨, 상품 지급, 배송 상태는 반드시 서버 트랜잭션과 원장으로 처리한다.
- 미디어 업로드는 인증, MIME/크기/checksum 검증과 안전한 object key를 사용한다.
- 개인정보와 구매 데이터는 fixture 또는 로그에 넣지 않는다.

## 12. 최종 방향

Phase 1은 IP 탐색 경험을 검증하는 프런트엔드 fixture다. 장기 구조의 원본 데이터는 PostgreSQL이며 FastAPI가 REST/OpenAPI 계약을 제공한다.

```text
Ip
↓
Character
↓
Product + Category Detail
↓
UserCollection / Wishlist
↓
ExchangeListing / ExchangeApplication
↓
ProductRequest / RequestLike / Snap
```

이 전환은 fixture를 한 번에 폐기하는 방식이 아니라, IP 읽기 API부터 교체하고 각 단계의 계약·성능·회귀를 확인하는 방식으로 진행한다.
