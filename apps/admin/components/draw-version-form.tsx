"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { CatalogProduct } from "../lib/admin-types";
import { createDrawVersion } from "../lib/actions";

type DraftEntry = {
  key: string;
  prizeProductId: string;
  rarity: string;
  weight: string;
  quantity: string;
};

function emptyEntry(key: string): DraftEntry {
  return { key, prizeProductId: "", rarity: "", weight: "", quantity: "" };
}

function positiveInteger(value: string, maximum: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= maximum ? number : null;
}

export function DrawVersionForm({
  product,
  prizeProducts,
  returnTo,
  idempotencyKey,
}: {
  product: CatalogProduct;
  prizeProducts: CatalogProduct[];
  returnTo: string;
  idempotencyKey: string;
}) {
  const nextKey = useRef(2);
  const [entries, setEntries] = useState<DraftEntry[]>([emptyEntry("entry-1")]);

  const calculation = useMemo(() => {
    const candidateIds = new Set(prizeProducts.map((candidate) => candidate.id));
    const selectedIds = entries.map((entry) => entry.prizeProductId).filter(Boolean);
    const duplicateIds = new Set(selectedIds.filter((id, index) => selectedIds.indexOf(id) !== index));
    const parsed = entries.map((entry) => {
      const weight = positiveInteger(entry.weight, 1_000_000);
      const quantity = positiveInteger(entry.quantity, 10_000);
      return {
        prizeProductId: entry.prizeProductId,
        rarity: entry.rarity.trim(),
        weight,
        quantity,
        effectiveWeight: weight && quantity ? weight * quantity : 0,
      };
    });
    const totalEffectiveWeight = parsed.reduce((sum, entry) => sum + entry.effectiveWeight, 0);
    const totalQuantity = parsed.reduce((sum, entry) => sum + (entry.quantity ?? 0), 0);
    const complete = prizeProducts.length > 0
      && parsed.length > 0
      && duplicateIds.size === 0
      && parsed.every((entry) => candidateIds.has(entry.prizeProductId) && entry.rarity && entry.weight && entry.quantity)
      && Number.isSafeInteger(totalEffectiveWeight)
      && totalEffectiveWeight > 0;
    const serialized = complete
      ? JSON.stringify(parsed.map((entry) => ({
        prizeProductId: entry.prizeProductId,
        rarity: entry.rarity,
        weight: entry.weight,
        quantity: entry.quantity,
      })))
      : "[]";
    return { parsed, duplicateIds, totalEffectiveWeight, totalQuantity, complete, serialized };
  }, [entries, prizeProducts]);

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
      <p>먼저 동일 IP의 활성 경품 전용 상품을 등록한 뒤 확률표를 만드세요. 판매 상품이나 다른 IP 상품은 경품으로 사용할 수 없습니다.</p>
      <Link className="button-link primary" href={`/catalog/products?ipId=${encodeURIComponent(product.ipId)}&prizeOnly=true`}>경품 SKU 등록하기</Link>
    </div>;
  }

  const quantityDifference = calculation.totalQuantity - product.availableQuantity;
  const hasIncompleteEntry = !calculation.complete && calculation.duplicateIds.size === 0;

  return <form className="stack-form draw-version-form" action={createDrawVersion}>
    <input type="hidden" name="productId" value={product.id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <input type="hidden" name="entries" value={calculation.serialized} />

    <aside className="draw-lot-warning">
      <strong>물리 재고 lot 대조 필수</strong>
      <p>새 버전 수량에는 이전 버전이나 다른 초안과 중복되지 않는 별도 검수 재고(물리 lot)만 입력하세요. 현재 시스템에는 lot 원장이 없어 중복 투입을 자동으로 확인하지 못하므로, 공개 전 입고·검수 원장과 직접 대조해야 합니다.</p>
    </aside>

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
          <label>등급
            <input
              value={entry.rarity}
              onChange={(event) => updateEntry(entry.key, { rarity: event.target.value })}
              maxLength={40}
              placeholder="예: A, SECRET"
              required
            />
          </label>
          <label>기본 가중치
            <input
              type="number"
              value={entry.weight}
              onChange={(event) => updateEntry(entry.key, { weight: event.target.value })}
              min={1}
              max={1_000_000}
              inputMode="numeric"
              required
            />
          </label>
          <label>유한 수량
            <input
              type="number"
              value={entry.quantity}
              onChange={(event) => updateEntry(entry.key, { quantity: event.target.value })}
              min={1}
              max={10_000}
              inputMode="numeric"
              required
            />
          </label>
          <div className="draw-entry-result" aria-live="polite">
            <span>유효 가중치 <b>{parsed.effectiveWeight.toLocaleString("ko-KR")}</b></span>
            <span>현재 예상 확률 <b>{probability.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}%</b></span>
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
      <div><dt>판매 가용 수량</dt><dd>{product.availableQuantity.toLocaleString("ko-KR")}</dd></div>
      <div><dt>입력한 경품 수량</dt><dd>{calculation.totalQuantity.toLocaleString("ko-KR")}</dd></div>
      <div><dt>총 유효 가중치</dt><dd>{calculation.totalEffectiveWeight.toLocaleString("ko-KR")}</dd></div>
    </dl>

    {calculation.duplicateIds.size > 0 ? <p className="draw-capacity-message" data-kind="error" role="alert">같은 경품 SKU가 중복 선택되었습니다. 각 SKU는 한 행에만 배치하세요.</p>
      : calculation.totalQuantity > 0 && quantityDifference < 0 ? <p className="draw-capacity-message" data-kind="error" role="alert">경품 수량이 현재 판매 가용 수량보다 {Math.abs(quantityDifference).toLocaleString("ko-KR")}개 부족합니다. 초안은 저장할 수 있지만 공개 전 판매 재고와 물리 lot을 맞춰야 합니다.</p>
        : calculation.totalQuantity > 0 && quantityDifference > 0 ? <p className="draw-capacity-message" data-kind="warning">경품 수량이 현재 판매 가용 수량보다 {quantityDifference.toLocaleString("ko-KR")}개 많습니다. 실제 입고·판매 계획과 일치하는지 확인하세요.</p>
          : calculation.totalQuantity > 0 && quantityDifference === 0 ? <p className="draw-capacity-message" data-kind="success">경품 수량과 현재 판매 가용 수량이 일치합니다.</p>
            : hasIncompleteEntry ? <p className="draw-capacity-message" data-kind="neutral">경품, 등급, 가중치, 유한 수량을 모두 입력하면 예상 확률이 계산됩니다.</p> : null}

    <label className="reason-field"><span>초안 생성 사유<b>필수</b></span><textarea name="reason" minLength={2} maxLength={1000} required placeholder="감사 로그에 남길 구체적인 사유를 입력하세요." /></label>
    <div className="form-actions"><button className="primary" disabled={!calculation.complete}>확률표 초안 생성</button></div>
  </form>;
}
