"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { CatalogProduct } from "../lib/admin-types";
import { createDrawVersion } from "../lib/actions";
import { allocateGachaDrawQuantities, buildDrawVersionDraftPayload } from "../lib/draw-version-draft";

type DraftEntry = {
  key: string;
  prizeProductId: string;
  rarity: string;
  quantity: string;
  tierCode: string;
  tierRank: string;
};

function emptyEntry(key: string): DraftEntry {
  return { key, prizeProductId: "", rarity: "", quantity: "", tierCode: "", tierRank: "" };
}

function positiveInteger(value: string, maximum: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= maximum ? number : null;
}

function nonNegativeInteger(value: string) {
  const number = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(number) && number >= 0 && number <= 2_147_483_647 ? number : null;
}

export function DrawVersionForm({
  product,
  prizeProducts,
  returnTo,
  idempotencyKey,
  stockOnHand = null,
}: {
  product: CatalogProduct;
  prizeProducts: CatalogProduct[];
  returnTo: string;
  idempotencyKey: string;
  /** Stock including checkout reservations; publishing checks prize capacity against it. */
  stockOnHand?: number | null;
}) {
  const nextKey = useRef(2);
  const [entries, setEntries] = useState<DraftEntry[]>([emptyEntry("entry-1")]);
  const [totalSlots, setTotalSlots] = useState("");
  const category = product.category === "kuji" ? "kuji" : "gacha";
  const isKuji = category === "kuji";
  // Publishing requires prize capacity for all stock, including units held by
  // pending checkouts, so plan against on-hand stock whenever it is readable.
  const capacityBase = stockOnHand ?? product.availableQuantity;
  const capacityLabel = stockOnHand === null ? "판매 가용 수량" : "판매 재고(결제 대기 포함)";

  const calculation = useMemo(() => {
    const automaticGachaQuantities = isKuji ? null : allocateGachaDrawQuantities(capacityBase, entries.length);
    const candidateIds = new Set(prizeProducts.map((candidate) => candidate.id));
    const selectedIds = entries.map((entry) => entry.prizeProductId).filter(Boolean);
    const duplicateIds = new Set(selectedIds.filter((id, index) => selectedIds.indexOf(id) !== index));
    const tierCodes = entries.map((entry) => entry.tierCode.trim()).filter(Boolean);
    const duplicateTierCodes = new Set(tierCodes.filter((code, index) => tierCodes.indexOf(code) !== index));
    const parsed = entries.map((entry, index) => {
      const quantity = isKuji ? positiveInteger(entry.quantity, 10_000) : automaticGachaQuantities?.[index] ?? null;
      const tierCode = entry.tierCode.trim();
      const tierRank = nonNegativeInteger(entry.tierRank);
      return {
        prizeProductId: entry.prizeProductId,
        rarity: entry.rarity.trim(),
        weight: isKuji ? null : 1,
        quantity,
        tierCode,
        tierRank,
        effectiveWeight: !isKuji && quantity ? quantity : 0,
      };
    });
    const tierRanks = parsed.map((entry) => entry.tierRank).filter((rank): rank is number => rank !== null);
    const duplicateTierRanks = new Set(tierRanks.filter((rank, index) => tierRanks.indexOf(rank) !== index));
    const totalEffectiveWeight = parsed.reduce((sum, entry) => sum + entry.effectiveWeight, 0);
    const totalQuantity = parsed.reduce((sum, entry) => sum + (entry.quantity ?? 0), 0);
    const parsedTotalSlots = positiveInteger(totalSlots, 10_000);
    const commonComplete = prizeProducts.length > 0
      && parsed.length > 0
      && duplicateIds.size === 0
      && parsed.every((entry) => candidateIds.has(entry.prizeProductId) && entry.rarity && entry.quantity);
    const categoryComplete = isKuji
      ? parsedTotalSlots !== null
        && totalQuantity === parsedTotalSlots
        && duplicateTierCodes.size === 0
        && duplicateTierRanks.size === 0
        && parsed.every((entry) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(entry.tierCode) && entry.tierRank !== null)
      : Number.isSafeInteger(totalEffectiveWeight)
        && totalEffectiveWeight > 0;
    let complete = commonComplete && categoryComplete;
    let serialized = "[]";
    if (complete) {
      try {
        const payload = buildDrawVersionDraftPayload(category, parsed, parsedTotalSlots);
        serialized = JSON.stringify(payload.entries);
      } catch {
        complete = false;
      }
    }
    return {
      parsed, duplicateIds, duplicateTierCodes, duplicateTierRanks, totalEffectiveWeight,
      totalQuantity, parsedTotalSlots, complete, serialized,
    };
  }, [capacityBase, category, entries, isKuji, prizeProducts, totalSlots]);

  function updateEntry(key: string, patch: Partial<DraftEntry>) {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  }

  function addEntry() {
    const key = `entry-${nextKey.current}`;
    nextKey.current += 1;
    setEntries((current) => [...current, emptyEntry(key)]);
  }

  function removeEntry(key: string) {
    setEntries((current) => current.length === 1 ? current : current.filter((entry) => entry.key !== key));
  }

  if (prizeProducts.length === 0) {
    return <div className="draw-prize-empty">
      <strong>선택할 수 있는 경품 전용 SKU가 없습니다.</strong>
      <p>먼저 동일 IP의 활성 경품 전용 상품을 등록한 뒤 추첨 구성을 만드세요. 판매 상품이나 다른 IP 상품은 경품으로 사용할 수 없습니다.</p>
      <Link className="button-link primary" href={`/catalog/products?ipId=${encodeURIComponent(product.ipId)}&prizeOnly=true&afterCreate=${encodeURIComponent(returnTo)}`}>경품 SKU 등록하기</Link>
    </div>;
  }

  const quantityDifference = calculation.totalQuantity - capacityBase;
  const hasIncompleteEntry = !calculation.complete && calculation.duplicateIds.size === 0;

  return <form className="stack-form draw-version-form" action={createDrawVersion}>
    <input type="hidden" name="productId" value={product.id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <input type="hidden" name="entries" value={calculation.serialized} />
    {isKuji ? <input type="hidden" name="totalSlots" value={totalSlots} /> : null}

    <aside className="draw-lot-warning">
      <strong>물리 재고 lot 대조 필수</strong>
      <p>{isKuji
        ? "전체 쿠지 장수와 등급별 수량은 실제 봉인 덱과 정확히 같아야 합니다. 공개 전 tier 순서와 입고·검수 원장을 직접 대조하세요."
        : `전체 ${capacityLabel}을 선택한 경품 종류에 자동 배분합니다. 이는 추첨용 내부 배정량이며 상세 SKU의 실제 실물 재고를 확인했다는 뜻이 아닙니다. 기존 버전과 물리 lot이 중복되지 않는지 공개 전에 대조하세요.`}</p>
      {stockOnHand === null ? <p className="muted">재고 조회 권한이 없어 판매 가용 수량으로 계산했어요. 결제 대기 중인 예약이 있으면 공개가 거부될 수 있어요.</p> : null}
    </aside>

    {isKuji ? <label>전체 쿠지 장수
      <input
        type="number"
        value={totalSlots}
        onChange={(event) => setTotalSlots(event.target.value)}
        min={1}
        max={10_000}
        inputMode="numeric"
        required
      />
    </label> : null}

    <div className="draw-entry-list">
      {entries.map((entry, index) => {
        const parsed = calculation.parsed[index]!;
        const probability = calculation.totalEffectiveWeight > 0
          ? parsed.effectiveWeight / calculation.totalEffectiveWeight * 100
          : 0;
        const selected = prizeProducts.find((candidate) => candidate.id === entry.prizeProductId);
        return <fieldset className="draw-entry-row" key={entry.key}>
          <legend>경품 {index + 1}</legend>
          <label className="draw-prize-select">경품 전용 SKU
            <select
              value={entry.prizeProductId}
              onChange={(event) => updateEntry(entry.key, { prizeProductId: event.target.value })}
              required
            >
              <option value="">경품을 선택하세요</option>
              {prizeProducts.map((candidate) => {
                const selectedElsewhere = candidate.id !== entry.prizeProductId
                  && entries.some((item) => item.prizeProductId === candidate.id);
                return <option key={candidate.id} value={candidate.id} disabled={selectedElsewhere}>
                  {candidate.name} · {candidate.sku}
                </option>;
              })}
            </select>
            {selected ? <span className="draw-prize-meta">
              {selected.imageUrl ? <img src={selected.imageUrl} alt="" /> : <span className="draw-prize-image-placeholder" aria-hidden="true" />}
              <span><b>{selected.name}</b><small>SKU {selected.sku} · IP {selected.ipId}</small></span>
            </span> : null}
          </label>
          <label>{isKuji ? "상 이름 (고객 카드 표시)" : "등급"}
            <input
              value={entry.rarity}
              onChange={(event) => updateEntry(entry.key, { rarity: event.target.value })}
              maxLength={40}
              placeholder={isKuji ? "예: S상, A상, 스페셜" : "예: A, SECRET"}
              required
            />
            {isKuji ? <small>남은 수량이 0이 되면 고객 카드에서 자동으로 사라집니다.</small> : null}
          </label>
          {isKuji ? <>
            <label>등급 코드 (tierCode)
              <input
                value={entry.tierCode}
                onChange={(event) => updateEntry(entry.key, { tierCode: event.target.value })}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,39}"
                maxLength={40}
                placeholder="예: A, SPECIAL"
                required
              />
              <small>관리용 고유 코드입니다. 라스트원 자동 지급 규칙은 아직 별도 지원하지 않습니다.</small>
            </label>
            <label>등급 순서 (tierRank, 0부터)
              <input
                type="number"
                value={entry.tierRank}
                onChange={(event) => updateEntry(entry.key, { tierRank: event.target.value })}
                min={0}
                max={2_147_483_647}
                inputMode="numeric"
                required
              />
            </label>
          </> : null}
          {isKuji ? <label>유한 수량
            <input
              type="number"
              value={entry.quantity}
              onChange={(event) => updateEntry(entry.key, { quantity: event.target.value })}
              min={1}
              max={10_000}
              inputMode="numeric"
              required
            />
          </label> : null}
          <div className="draw-entry-result" aria-live="polite">
            {isKuji ? <>
              <span>배정 수량 <b>{(parsed.quantity ?? 0).toLocaleString("ko-KR")}</b></span>
              <span>전체 구성 비율 <b>{(calculation.parsedTotalSlots ? (parsed.quantity ?? 0) / calculation.parsedTotalSlots * 100 : 0).toLocaleString("ko-KR", { maximumFractionDigits: 6 })}%</b></span>
            </> : <>
              <span>자동 배정 수량 <b>{parsed.effectiveWeight.toLocaleString("ko-KR")}개</b></span>
              <span>초기 예상 확률 <b>{probability.toFixed(2)}%</b></span>
            </>}
          </div>
          <button type="button" className="draw-entry-remove" onClick={() => removeEntry(entry.key)} disabled={entries.length === 1}>경품 삭제</button>
        </fieldset>;
      })}
    </div>

    <div className="draw-builder-actions">
      <button type="button" onClick={addEntry} disabled={entries.length >= 200}>경품 행 추가</button>
      <span>같은 경품 SKU는 한 번만 선택할 수 있습니다.</span>
    </div>

    <dl className="draw-live-summary">
      <div><dt>{capacityLabel}</dt><dd>{capacityBase.toLocaleString("ko-KR")}</dd></div>
      {isKuji ? <div><dt>전체 쿠지 장수</dt><dd>{calculation.parsedTotalSlots?.toLocaleString("ko-KR") ?? "-"}</dd></div> : null}
      <div><dt>입력한 경품 수량</dt><dd>{calculation.totalQuantity.toLocaleString("ko-KR")}</dd></div>
      {!isKuji ? <div><dt>확률 계산용 전체 수량</dt><dd>{calculation.totalEffectiveWeight.toLocaleString("ko-KR")}개</dd></div> : null}
    </dl>

    {calculation.duplicateIds.size > 0 ? <p className="draw-capacity-message" data-kind="error" role="alert">같은 경품 SKU가 중복 선택되었습니다. 각 SKU는 한 행에만 배치하세요.</p>
      : isKuji && calculation.duplicateTierCodes.size > 0 ? <p className="draw-capacity-message" data-kind="error" role="alert">같은 tierCode를 두 번 사용할 수 없습니다.</p>
        : isKuji && calculation.duplicateTierRanks.size > 0 ? <p className="draw-capacity-message" data-kind="error" role="alert">같은 tierRank를 두 번 사용할 수 없습니다.</p>
          : isKuji && calculation.parsedTotalSlots === null ? <p className="draw-capacity-message" data-kind="neutral">전체 쿠지 장수를 1~10,000 사이로 입력하세요.</p>
            : isKuji && calculation.totalQuantity !== calculation.parsedTotalSlots ? <p className="draw-capacity-message" data-kind="error" role="alert">경품 수량 합계가 전체 쿠지 장수와 정확히 같아야 합니다.</p>
      : calculation.totalQuantity > 0 && quantityDifference < 0 ? <p className="draw-capacity-message" data-kind="error" role="alert">경품 수량이 현재 {capacityLabel}보다 {Math.abs(quantityDifference).toLocaleString("ko-KR")}개 부족합니다. 초안은 저장할 수 있지만 공개 전 판매 재고와 물리 lot을 맞춰야 합니다.</p>
        : calculation.totalQuantity > 0 && quantityDifference > 0 ? <p className="draw-capacity-message" data-kind="warning">경품 수량이 현재 {capacityLabel}보다 {quantityDifference.toLocaleString("ko-KR")}개 많습니다. 실제 입고·판매 계획과 일치하는지 확인하세요.</p>
          : calculation.totalQuantity > 0 && quantityDifference === 0 ? <p className="draw-capacity-message" data-kind="success">{isKuji ? `전체 쿠지 장수, 경품 수량, ${capacityLabel}이 모두 일치합니다.` : `경품 수량과 현재 ${capacityLabel}이 일치합니다.`}</p>
            : hasIncompleteEntry ? <p className="draw-capacity-message" data-kind="neutral">{isKuji ? "경품, 등급, tierCode, tierRank, 유한 수량을 모두 입력하세요." : `경품과 등급을 선택하세요. 전체 ${capacityLabel}은 경품 종류 수 이상이어야 합니다.`}</p> : null}

    <label className="reason-field"><span>초안 생성 사유<b>필수</b></span><textarea name="reason" minLength={2} maxLength={1000} required placeholder="감사 로그에 남길 구체적인 사유를 입력하세요." /></label>
    <div className="form-actions"><button className="primary" disabled={!calculation.complete}>{isKuji ? "쿠지 상 구성 초안 생성" : "확률표 초안 생성"}</button></div>
  </form>;
}
