import type { AdminHomeSection, CatalogIp } from "../lib/admin-types";
import { createHomeSection, updateHomeSection } from "../lib/actions";
import { ReasonField, ReturnTo } from "./operations";

const HOME_SECTION_LAYOUT_LABELS = {
  gacha: "가챠",
  kuji: "쿠지",
} as const;

const HOME_SECTION_SOURCE_LABELS = {
  MANUAL: "수동 선택",
  IP: "IP 최신순",
  NEW: "최근 30일 신상품",
  POPULAR: "최근 30일 인기순",
} as const;

export function HomeSectionForm({ item, ips, returnTo, configured }: {
  item?: AdminHomeSection;
  ips: CatalogIp[];
  returnTo: string;
  configured: boolean;
}) {
  const selectedIpAvailable = !item?.ipId || ips.some((ip) => ip.id === item.ipId);
  return <form className="stack-form" action={item ? updateHomeSection : createHomeSection}>
    <ReturnTo value={returnTo} />
    {item ? <><input type="hidden" name="sectionId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></>
      : <label>섹션 ID<input name="sectionId" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={120} required placeholder="예: spy-family" /></label>}
    <div className="field-grid">
      <label>제목<input name="title" defaultValue={item?.title} maxLength={120} required /></label>
      <label>부제<textarea name="subtitle" defaultValue={item?.subtitle ?? ""} maxLength={240} rows={2} placeholder="선택 입력 · 섹션 설명" /></label>
      <label>상품 구성
        <select name="sourceKind" defaultValue={item?.sourceKind ?? "IP"} required>
          {Object.entries(HOME_SECTION_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>연결 IP (선택)
        <select name="ipId" defaultValue={item?.ipId ?? ""}>
          <option value="">전체 IP</option>
          {!selectedIpAvailable && item?.ipId ? <option value={item.ipId}>연결 IP를 현재 검색 결과에서 찾을 수 없음 ({item.ipId})</option> : null}
          {ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo} / {ip.nameEn}{ip.isActive ? "" : " (IP 비활성)"}</option>)}
        </select>
      </label>
      <label>상품 유형
        <select name="layoutKind" defaultValue={item?.layoutKind ?? ""} required>
          <option value="" disabled>가챠 또는 쿠지를 선택하세요</option>
          {Object.entries(HOME_SECTION_LAYOUT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>최대 노출 수<input type="number" name="visibleLimit" min={1} max={20} defaultValue={item?.visibleLimit ?? 20} required /></label>
      <label>노출 순서<input type="number" name="sortOrder" min={0} max={2147483647} defaultValue={item?.sortOrder ?? 0} required /></label>
      {item ? <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={item.isActive} /> 홈 노출</label>
        : <input type="hidden" name="isActive" value="off" />}
    </div>
    <label>수동 상품 순서
      <textarea
        name="manualProductIds"
        defaultValue={item?.manualProductIds.join("\n") ?? ""}
        rows={5}
        placeholder={"상품 ID를 위에서부터 노출 순서대로 입력하세요.\n예: demon-slayer-gacha"}
      />
      <span className="muted">수동 선택일 때만 사용합니다. 쉼표 또는 줄바꿈으로 최대 20개까지 입력할 수 있습니다.</span>
    </label>
    {(item?.sourceKind ?? "IP") === "IP" && !item?.ipId ? <aside className="draw-lot-warning">
      <strong>연결 IP 선택 필요</strong>
      <p>IP 최신순 구성은 연결 IP를 선택해야 저장할 수 있습니다.</p>
    </aside> : null}
    {item && item.layoutKind === null ? <aside className="draw-lot-warning">
      <strong>상품 유형 선택 필요</strong>
      <p>기존 홈 섹션에는 상품 유형이 없습니다. 가챠 또는 쿠지를 선택해야 변경 내용을 저장할 수 있습니다.</p>
    </aside> : null}
    {!item ? <aside className="draw-lot-warning">
      <strong>{configured ? "홈 섹션 추가 안내" : "첫 홈 섹션 생성 안내"}</strong>
      <p>홈 상품 레일은 관리자 섹션으로만 구성됩니다. 상품 구성 기준, 카드 유형, 노출 수와 순서를 확인한 뒤 홈 노출을 켜세요. 새 섹션은 항상 비노출 상태로 생성됩니다.</p>
      <label className="check-field"><input type="checkbox" name="confirmCatalogOverride" required /> 위 영향을 확인했습니다.</label>
    </aside> : null}
    <ReasonField label={item ? "수정 사유" : "생성 사유"} />
    <div className="form-actions"><button className="primary">{item ? "변경 저장" : "비노출로 생성"}</button></div>
  </form>;
}
