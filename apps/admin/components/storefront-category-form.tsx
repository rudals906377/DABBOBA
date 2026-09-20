import type { StorefrontCategorySetting } from "../lib/admin-types";
import { updateStorefrontCategorySetting } from "../lib/actions";
import { ReasonField, ReturnTo } from "./operations";

const AVAILABILITY_LABELS = {
  active: "판매 중",
  "coming-soon": "준비 중",
  hidden: "숨김",
} as const;

export function StorefrontCategoryForm({ item, returnTo }: {
  item: StorefrontCategorySetting;
  returnTo: string;
}) {
  const supportsHome = item.category === "gacha" || item.category === "kuji";
  return <form className="stack-form" action={updateStorefrontCategorySetting}>
    <ReturnTo value={returnTo} />
    <input type="hidden" name="category" value={item.category} />
    <input type="hidden" name="expectedVersion" value={item.version} />
    <div className="field-grid">
      <label>내부 카테고리<input value={item.category} readOnly aria-readonly="true" /></label>
      <label>표시 이름<input name="label" defaultValue={item.label} maxLength={40} required /></label>
      <label>노출 순서<input type="number" name="sortOrder" min={0} max={2147483647} defaultValue={item.sortOrder} required /></label>
      <label>운영 상태
        <select name="availability" defaultValue={item.availability} required>
          {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="check-field"><input type="checkbox" name="showOnHome" defaultChecked={item.showOnHome} disabled={!supportsHome} /> 홈 노출{supportsHome ? "" : " (현재 가챠·쿠지만 지원)"}</label>
      <label className="check-field"><input type="checkbox" name="showOnCatalog" defaultChecked={item.showOnCatalog} /> 뽀바 노출</label>
      <label className="check-field"><input type="checkbox" name="showOnExchange" defaultChecked={item.showOnExchange} /> 교환방 노출</label>
      <label className="check-field"><input type="checkbox" name="showOnWanted" defaultChecked={item.showOnWanted} /> 신청방 노출</label>
      <label className="span-2">안내 문구<textarea name="description" defaultValue={item.description} maxLength={240} /></label>
      <label className="span-2">대표 이미지 URL<input type="url" name="imageUrl" defaultValue={item.imageUrl ?? ""} maxLength={2000} /></label>
      <label className="span-2">아이콘 키<input name="iconKey" defaultValue={item.iconKey ?? ""} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} placeholder="예: capsule" /></label>
    </div>
    <aside className="draw-lot-warning">
      <strong>안전한 변경 범위</strong>
      <p>표시 설정만 바뀝니다. 내부 카테고리 값과 결제·뽑기 방식은 변경되지 않습니다. 저장 후 실행 중인 앱에도 자동 반영됩니다.</p>
    </aside>
    <ReasonField label="수정 사유" />
    <div className="form-actions"><button className="primary">카테고리 설정 저장</button></div>
  </form>;
}
