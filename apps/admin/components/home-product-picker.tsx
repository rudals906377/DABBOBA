"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type HomeProductChoice = { id: string; name: string; category?: string; ipId?: string };

const CATEGORY_LABELS: Record<string, string> = { gacha: "가챠", kuji: "쿠지", figure: "피규어", tcg: "카드" };

// The page sends the sale-product list once; every section form reads it here
// instead of serializing the whole list into each row.
const HomeProductChoicesContext = createContext<HomeProductChoice[]>([]);

export function HomeProductChoicesProvider({ products, children }: { products: HomeProductChoice[]; children: ReactNode }) {
  return <HomeProductChoicesContext.Provider value={products}>{children}</HomeProductChoicesContext.Provider>;
}

type SectionFilter = { layoutKind: string; ipId: string };

function readSectionFilter(form: HTMLFormElement | null): SectionFilter {
  const value = (name: string) => {
    const field = form?.elements.namedItem(name);
    return field instanceof HTMLSelectElement || field instanceof HTMLInputElement ? field.value : "";
  };
  return { layoutKind: value("layoutKind"), ipId: value("ipId") };
}

function matchesSection(product: HomeProductChoice, filter: SectionFilter) {
  // The API accepts only products of the section's card layout and linked IP.
  return (!filter.layoutKind || !product.category || product.category === filter.layoutKind)
    && (!filter.ipId || !product.ipId || product.ipId === filter.ipId);
}

function choiceLabel(product: HomeProductChoice) {
  const category = product.category ? CATEGORY_LABELS[product.category] ?? product.category : null;
  return category ? `[${category}] ${product.name}` : product.name;
}

export function HomeProductPicker({ products: explicitProducts, initialIds }: { products?: HomeProductChoice[]; initialIds: string[] }) {
  const sharedProducts = useContext(HomeProductChoicesContext);
  const products = explicitProducts ?? sharedProducts;
  const rootRef = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState(initialIds);
  const [next, setNext] = useState("");
  const [filter, setFilter] = useState<SectionFilter>({ layoutKind: "", ipId: "" });

  useEffect(() => {
    const form = rootRef.current?.closest("form") ?? null;
    const update = () => setFilter(readSectionFilter(form));
    update();
    form?.addEventListener("change", update);
    return () => form?.removeEventListener("change", update);
  }, []);

  function move(index: number, offset: number) {
    const changed = [...ids];
    [changed[index], changed[index + offset]] = [changed[index + offset]!, changed[index]!];
    setIds(changed);
  }
  const available = products.filter((product) => !ids.includes(product.id) && matchesSection(product, filter));
  return <div className="stack-form" ref={rootRef}>
    <input type="hidden" name="manualProductIds" value={ids.join("\n")} />
    {ids.length ? <ol className="home-product-picker">{ids.map((id, index) => {
      const product = products.find((candidate) => candidate.id === id);
      return <li key={id}>
        <span>{product ? choiceLabel(product) : "현재 연결된 상품 (목록에 없음)"}{product && !matchesSection(product, filter) ? <strong className="home-product-mismatch"> · 선택한 상품 유형·작품과 맞지 않아요</strong> : null}</span>
        <div><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${index + 1}번째 상품 위로`}>↑</button><button type="button" disabled={index === ids.length - 1} onClick={() => move(index, 1)} aria-label={`${index + 1}번째 상품 아래로`}>↓</button><button type="button" onClick={() => setIds(ids.filter((value) => value !== id))}>제외</button></div>
      </li>;
    })}</ol> : <p className="muted">선택한 상품이 없습니다.</p>}
    <div className="quick-links"><label>추가할 상품<select value={next} onChange={(event) => setNext(event.target.value)}><option value="">상품을 선택하세요</option>{available.map((product) => <option key={product.id} value={product.id}>{choiceLabel(product)}</option>)}</select></label><button type="button" disabled={!next || ids.length >= 20} onClick={() => { setIds([...ids, next]); setNext(""); }}>상품 추가</button></div>
  </div>;
}
