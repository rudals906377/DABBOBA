import type { CatalogIp, CatalogProduct, Character } from "../lib/admin-types";
import { createCharacter, createIp, createProduct, updateCharacter, updateIp, updateProduct } from "../lib/actions";
import { ReasonField, ReturnTo } from "./operations";

export function IpForm({ item, returnTo, initialName }: { item?: CatalogIp; returnTo: string; initialName?: string }) {
  const action = item ? updateIp : createIp;
  return <form className="stack-form" action={action}>
    {item ? <><input type="hidden" name="ipId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}<ReturnTo value={returnTo} />
    <div className="field-grid">
      <label>슬러그<input name="slug" defaultValue={item?.slug} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={100} required /></label>
      <label>한국어 이름<input name="nameKo" defaultValue={item?.nameKo || initialName} maxLength={160} required /></label>
      <label>영문 이름<input name="nameEn" defaultValue={item?.nameEn} maxLength={160} required /></label>
      <label>일문 이름<input name="nameJa" defaultValue={item?.nameJa || ""} maxLength={160} /></label>
      <label className="span-2">별칭 (쉼표 또는 줄바꿈)<textarea name="aliases" defaultValue={item?.aliases.join(", ")} maxLength={5000} /></label>
      <label className="span-2">설명<textarea name="description" defaultValue={item?.description} maxLength={5000} /></label>
      <label className="span-2">이미지 URL<input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} /></label>
      <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} /> 활성</label>
    </div>
    <ReasonField label={item ? "수정 사유" : "등록 사유"} /><div className="form-actions"><button className="primary">{item ? "IP 수정" : "IP 등록"}</button></div>
  </form>;
}

export function CharacterForm({ item, returnTo }: { item?: Character; returnTo: string }) {
  const action = item ? updateCharacter : createCharacter;
  return <form className="stack-form" action={action}>
    {item ? <><input type="hidden" name="characterId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}<ReturnTo value={returnTo} />
    <div className="field-grid">
      <label>IP ID<input name="ipId" defaultValue={item?.ipId} maxLength={120} required /></label><label>캐릭터 이름<input name="name" defaultValue={item?.name} maxLength={160} required /></label>
      <label className="span-2">별칭 (쉼표 또는 줄바꿈)<textarea name="aliases" defaultValue={item?.aliases.join(", ")} maxLength={4000} /></label>
      <label className="span-2">이미지 URL<input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} /></label>
      <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} /> 활성</label>
    </div>
    <ReasonField label={item ? "수정 사유" : "등록 사유"} /><div className="form-actions"><button className="primary">{item ? "캐릭터 수정" : "캐릭터 등록"}</button></div>
  </form>;
}

export function ProductForm({ item, returnTo, initialName, initialIpId, initialPrizeOnly = false }: {
  item?: CatalogProduct;
  returnTo: string;
  initialName?: string;
  initialIpId?: string;
  initialPrizeOnly?: boolean;
}) {
  const action = item ? updateProduct : createProduct;
  return <form className="stack-form" action={action}>
    {item ? <><input type="hidden" name="productId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}<ReturnTo value={returnTo} />
    <div className="field-grid">
      <label>SKU<input name="sku" defaultValue={item?.sku} maxLength={80} required /></label><label>IP ID<input name="ipId" defaultValue={item?.ipId || initialIpId} maxLength={120} required /></label>
      {item ? <>
        <label>카테고리<input value={item.category} readOnly aria-readonly="true" title="카테고리 변경은 새 SKU 등록으로 처리합니다." /></label>
        <input type="hidden" name="category" value={item.category} />
      </> : <label>카테고리<select name="category" defaultValue="figure">{["gacha", "figure", "kuji", "tcg"].map((v) => <option key={v}>{v}</option>)}</select></label>}
      <label>상품명<input name="name" defaultValue={item?.name || initialName} maxLength={240} required /></label>
      <label>제조사<input name="manufacturer" defaultValue={item?.manufacturer || ""} maxLength={160} /></label><label>출시일<input type="date" name="releaseDate" defaultValue={item?.releaseDate || ""} /></label>
      <label>서버 기준 가격 (원)<input type="number" name="price" min={0} max={2147483647} defaultValue={item?.price ?? 0} required /></label>
      {item ? <label>가용 수량 (재고 운영에서 조정)<input type="number" name="availableQuantity" value={item.availableQuantity} readOnly aria-readonly="true" /></label>
        : <label>초기 가용 수량<input type="number" name="availableQuantity" min={0} max={2147483647} defaultValue={0} required /></label>}
      <label className="span-2">캐릭터 UUID (쉼표 또는 줄바꿈)<textarea name="characterIds" defaultValue={item?.characterIds.join(", ")} placeholder="비워 저장하면 연결을 모두 해제합니다." /></label>
      <label className="span-2">메타데이터 JSON<textarea name="metadata" defaultValue={JSON.stringify(item?.metadata || {}, null, 2)} required /></label>
      <label className="span-2">이미지 URL<input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} /></label>
      <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} /> 활성</label>
      {item ? <div className="span-2 immutable-field">
        <input type="hidden" name="isPrizeOnly" value={item.isPrizeOnly ? "on" : "off"} />
        <span>상품 용도</span>
        <strong>{item.isPrizeOnly ? "경품 전용 SKU" : "판매 상품 SKU"}</strong>
        <small>상품 용도는 생성 후 바꿀 수 없습니다. 용도가 달라지면 새 SKU를 등록하세요.</small>
      </div> : <label className="span-2 check-field product-kind-field">
        <input type="checkbox" name="isPrizeOnly" defaultChecked={initialPrizeOnly} />
        <span><strong>경품 전용 SKU</strong><small>체크하면 공개 상품 목록과 일반 주문에서 제외되고, 같은 IP의 가챠·쿠지 경품 후보로만 사용됩니다. 생성 후 변경할 수 없습니다.</small></span>
      </label>}
    </div>
    <ReasonField label={item ? "수정 사유" : "등록 사유"} /><div className="form-actions"><button className="primary">{item ? "상품 수정" : "상품 등록"}</button></div>
  </form>;
}
