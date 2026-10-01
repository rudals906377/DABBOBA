"use client";
import { useState } from "react";

export type HomeProductChoice = { id: string; name: string };
export function HomeProductPicker({ products, initialIds }: { products: HomeProductChoice[]; initialIds: string[] }) {
  const [ids, setIds] = useState(initialIds);
  const [next, setNext] = useState("");
  function move(index: number, offset: number) {
    const changed = [...ids];
    [changed[index], changed[index + offset]] = [changed[index + offset]!, changed[index]!];
    setIds(changed);
  }
  return <div className="stack-form">
    <input type="hidden" name="manualProductIds" value={ids.join("\n")} />
    {ids.length ? <ol className="home-product-picker">{ids.map((id, index) => <li key={id}>
      <span>{products.find((product) => product.id === id)?.name ?? "현재 연결된 상품 (목록에 없음)"}</span>
      <div><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${index + 1}번째 상품 위로`}>↑</button><button type="button" disabled={index === ids.length - 1} onClick={() => move(index, 1)} aria-label={`${index + 1}번째 상품 아래로`}>↓</button><button type="button" onClick={() => setIds(ids.filter((value) => value !== id))}>제외</button></div>
    </li>)}</ol> : <p className="muted">선택한 상품이 없습니다.</p>}
    <div className="quick-links"><label>추가할 상품<select value={next} onChange={(event) => setNext(event.target.value)}><option value="">상품을 선택하세요</option>{products.filter((product) => !ids.includes(product.id)).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><button type="button" disabled={!next || ids.length >= 20} onClick={() => { setIds([...ids, next]); setNext(""); }}>상품 추가</button></div>
  </div>;
}
