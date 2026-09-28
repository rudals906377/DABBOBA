import type { CatalogIp, CatalogProduct, Character } from "../lib/admin-types";
import { clearStorefrontProductImage, createCharacter, createIp, createProduct, updateCharacter, updateIp, updateProduct } from "../lib/actions";
import { ReasonField, ReturnTo, safeExternalUrl } from "./operations";
import { ImageCropPicker } from "./image-crop-picker";

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
      <label className="span-2">홈 인기 작품용 1:1 대표 이미지 URL
        <input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} />
        <small>홈 인기 작품 레일에 사용하는 정사각형 IP 이미지입니다.</small>
      </label>
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
      <label className="span-2">외부 이미지 URL (선택)<input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} />
        <small>컴퓨터에 있는 사진은 상품을 등록한 뒤 ‘사진 자르기·업로드’에서 선택하고 직접 잘라 올려주세요. 외부 URL은 자르기 기능을 거치지 않습니다.</small>
      </label>
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
      <label>관리 코드 (SKU)<input name="sku" defaultValue={item?.sku} maxLength={80} placeholder="예: gacha-kimetsu-001" required /><small>상품마다 다른 영문·숫자 코드입니다.</small></label><label>작품 ID<input name="ipId" defaultValue={item?.ipId || initialIpId} maxLength={120} placeholder="작품 메뉴에서 확인" required /></label>
      {item ? <>
        <label>상품 종류<input value={item.category === "gacha" ? "가챠" : item.category === "kuji" ? "쿠지" : item.category} readOnly aria-readonly="true" title="종류 변경은 새 SKU 등록으로 처리합니다." /></label>
        <input type="hidden" name="category" value={item.category} />
      </> : <label>상품 종류<select name="category" defaultValue="gacha"><option value="gacha">가챠</option><option value="kuji">쿠지</option><option value="figure">피규어 (내부 전용)</option><option value="tcg">카드 (내부 전용)</option></select></label>}
      <label>상품명<input name="name" defaultValue={item?.name || initialName} maxLength={240} placeholder="고객에게 보일 상품 이름" required /></label>
      <label>제조사<input name="manufacturer" defaultValue={item?.manufacturer || ""} maxLength={160} /></label><label>출시일<input type="date" name="releaseDate" defaultValue={item?.releaseDate || ""} /></label>
      <label>가격 (원)<input type="number" name="price" min={0} max={2147483647} defaultValue={item?.price ?? 0} required /></label>
      {item ? <label>가용 수량 (재고 운영에서 조정)<input type="number" name="availableQuantity" value={item.availableQuantity} readOnly aria-readonly="true" /></label>
        : <label>처음 등록할 재고 수<input type="number" name="availableQuantity" min={0} max={2147483647} defaultValue={0} required /></label>}
      <label className="span-2">캐릭터 UUID (쉼표 또는 줄바꿈)<textarea name="characterIds" defaultValue={item?.characterIds.join(", ")} placeholder="비워 저장하면 연결을 모두 해제합니다." /></label>
      <label className="span-2">메타데이터 JSON<textarea name="metadata" defaultValue={JSON.stringify(item?.metadata || {}, null, 2)} required /></label>
      <label className="span-2">이미지 URL<input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} /></label>
      <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} /> 활성</label>
      {item?.isPrizeOnly || (!item && initialPrizeOnly) ? <>
        <input type="hidden" name="saleStatus" value="DRAFT" />
        <div className="immutable-field"><span>판매 상태</span><strong>경품 전용</strong></div>
      </> : <label>판매 상태
        <select name="saleStatus" defaultValue={item?.saleStatus ?? "DRAFT"}>
          <option value="DRAFT">작성 중</option>
          <option value="COMING_SOON">오픈 예정</option>
          <option value="ON_SALE">판매 중</option>
          <option value="PAUSED">판매 중지</option>
        </select>
        <small>판매 중은 양수 가격·공개 이미지·재고·가챠/쿠지 구성이 모두 준비된 경우만 저장됩니다.</small>
      </label>}
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
    {!item ? <p className="muted">쿠지 판매 상품은 등록 후 이어지는 <strong>쿠지 상 구성</strong>에서 상 이름·노출 순서·수량을 설정하고 공개합니다.</p> : null}
    <ReasonField label={item ? "수정 사유" : "등록 사유"} /><div className="form-actions"><button className="primary">{item ? "상품 수정" : "상품 등록"}</button></div>
  </form>;
}

function ProductImageUploadForm({
  item,
  returnTo,
  role,
  label,
  guidance,
  buttonLabel,
}: {
  item: CatalogProduct;
  returnTo: string;
  role: "primary" | "storefront";
  label: string;
  guidance: string;
  buttonLabel: string;
}) {
  return <ImageCropPicker
    productId={item.id}
    expectedVersion={item.version}
    returnTo={returnTo}
    role={role}
    idempotencyKeys={{ intent: crypto.randomUUID(), complete: crypto.randomUUID(), attach: crypto.randomUUID() }}
    label={label}
    guidance={guidance}
    buttonLabel={buttonLabel}
    ratios={role === "storefront"
      ? [{ label: item.category === "kuji" ? "16:9" : "1:1", value: item.category === "kuji" ? 16 / 9 : 1 }]
      : [{ label: "6:5 · 상세 추천", value: 6 / 5 }, { label: "4:3", value: 4 / 3 }, { label: "1:1", value: 1 }]}
    minimumWidth={role === "storefront" ? item.category === "kuji" ? 1200 : 1080 : 0}
    minimumHeight={role === "storefront" ? item.category === "kuji" ? 675 : 1080 : 0}
  />;
}

function safeProductImageUrl(value: string | null) {
  const external = safeExternalUrl(value);
  if (external) return external;
  return value && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : null;
}

function CurrentProductImage({ label, url }: { label: string; url: string | null }) {
  const safeUrl = safeProductImageUrl(url);
  return <section className="catalog-image-current" data-image-status={url ? "populated" : "empty"}>
    <strong>{label}</strong>
    <p>{url ? "등록됨" : "등록되지 않음"}</p>
    {url ? <>
      {safeUrl ? <>
        <img
          src={safeUrl}
          alt={`${label} 미리보기`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ display: "block", width: "100%", maxWidth: 240, height: "auto", borderRadius: 8 }}
        />
        <a className="button-link" href={safeUrl} target="_blank" rel="noreferrer noopener">현재 사진 열기</a>
      </> : <p className="muted">현재 URL은 안전하게 미리 볼 수 없습니다.</p>}
      <small style={{ overflowWrap: "anywhere" }}>{url}</small>
    </> : null}
  </section>;
}

function StorefrontImageClearForm({ item, returnTo }: { item: CatalogProduct; returnTo: string }) {
  return <form className="stack-form catalog-image-form" action={clearStorefrontProductImage}>
    <input type="hidden" name="productId" value={item.id} />
    <input type="hidden" name="expectedVersion" value={item.version} />
    <input type="hidden" name="role" value="storefront" />
    <ReturnTo value={returnTo} />
    <p><strong>현재 목록 사진 연결 해제</strong></p>
    <p className="muted">목록 카드와의 연결만 해제합니다. 대표 사진과 업로드된 파일은 삭제되지 않습니다.</p>
    <label className="check-field">
      <input type="checkbox" name="confirmStorefrontImageClear" required />
      목록 사진 연결 해제를 확인했습니다.
    </label>
    <ReasonField label="목록 사진 연결 해제 사유" />
    <div className="form-actions"><button className="danger">목록 사진 연결 해제</button></div>
  </form>;
}

export function ProductImageForm({ item, returnTo }: { item: CatalogProduct; returnTo: string }) {
  const storefront = item.category === "gacha"
    ? {
        label: "새 가챠 목록 사진",
        guidance: "가챠샵 목록 전용 · 정확한 1:1 비율 · 최소 1080×1080px · JPG, PNG, WEBP, GIF · 최대 10MB",
      }
    : item.category === "kuji"
      ? {
          label: "새 쿠지 목록 사진",
          guidance: "쿠지샵 목록 전용 · 정확한 16:9 비율 · 최소 1200×675px · JPG, PNG, WEBP, GIF · 최대 10MB",
        }
      : null;

  return <>
    <div className="catalog-image-current-grid">
      <CurrentProductImage label="현재 대표 사진" url={item.imageUrl} />
      <CurrentProductImage label="현재 목록 사진" url={item.storefrontImageUrl} />
    </div>
    <ProductImageUploadForm
      item={item}
      returnTo={returnTo}
      role="primary"
      label="새 대표 사진"
      guidance="상품 상세와 기존 화면에 사용하는 기본 사진 · 업로드 전에 6:5·4:3·1:1 중 골라 자르기 · JPG, PNG, WEBP, GIF · 최대 10MB"
      buttonLabel="대표 사진 업로드 및 연결"
    />
    {storefront ? <ProductImageUploadForm
      item={item}
      returnTo={returnTo}
      role="storefront"
      label={storefront.label}
      guidance={storefront.guidance}
      buttonLabel="목록 사진 업로드 및 연결"
    /> : <p className="muted">목록 사진은 가챠·쿠지 상품에만 등록할 수 있습니다.</p>}
    {item.storefrontImageUrl ? <StorefrontImageClearForm item={item} returnTo={returnTo} /> : null}
  </>;
}
