import type { CatalogIp, CatalogProduct, Character } from "../lib/admin-types";
import { clearGalleryProductImage, clearStorefrontProductImage, createCharacter, createIp, createProduct, updateCharacter, updateIp, updateProduct } from "../lib/actions";
import { ReasonField, ReturnTo, safeExternalUrl } from "./operations";
import { ImageCropPicker } from "./image-crop-picker";

export function IpForm({ item, returnTo, initialName }: { item?: CatalogIp; returnTo: string; initialName?: string }) {
  const action = item ? updateIp : createIp;
  return <form className="stack-form" action={action}>
    {item ? <><input type="hidden" name="ipId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}<ReturnTo value={returnTo} />
    <div className="field-grid">
      {item ? <input type="hidden" name="slug" value={item.slug} /> : null}
      <label>한국어 이름<input name="nameKo" defaultValue={item?.nameKo || initialName} maxLength={160} required /></label>
      <label>영문 이름 (선택)<input name="nameEn" defaultValue={item?.nameEn} maxLength={160} /></label>
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

export function CharacterForm({ item, returnTo, ips = [] }: { item?: Character; returnTo: string; ips?: CatalogIp[] }) {
  const action = item ? updateCharacter : createCharacter;
  return <form className="stack-form" action={action}>
    {item ? <><input type="hidden" name="characterId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}<ReturnTo value={returnTo} />
    <div className="field-grid">
      <WorkSelect ips={ips} value={item?.ipId} /><label>캐릭터 이름<input name="name" defaultValue={item?.name} maxLength={160} required /></label>
      <label className="span-2">별칭 (쉼표 또는 줄바꿈)<textarea name="aliases" defaultValue={item?.aliases.join(", ")} maxLength={4000} /></label>
      <label className="span-2">외부 이미지 URL (선택)<input type="url" name="imageUrl" defaultValue={item?.imageUrl || ""} maxLength={2000} />
        <small>캐릭터 이미지는 외부 URL만 연결할 수 있습니다. 이 화면에서는 파일 업로드와 자르기를 지원하지 않습니다.</small>
      </label>
      <label className="check-field"><input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} /> 활성</label>
    </div>
    <ReasonField label={item ? "수정 사유" : "등록 사유"} /><div className="form-actions"><button className="primary">{item ? "캐릭터 수정" : "캐릭터 등록"}</button></div>
  </form>;
}

function WorkSelect({ ips, value }: { ips: CatalogIp[]; value?: string }) {
  return <label>작품<select name="ipId" defaultValue={value || ""} required>
    <option value="" disabled>작품을 선택하세요</option>
    {value && !ips.some((ip) => ip.id === value) ? <option value={value}>현재 연결된 작품</option> : null}
    {ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.nameKo}{ip.isActive === false ? " (비노출)" : ""}</option>)}
  </select></label>;
}

export function ProductForm({ item, returnTo, initialName, initialIpId, initialPrizeOnly = false, ips = [] }: {
  item?: CatalogProduct;
  returnTo: string;
  initialName?: string;
  initialIpId?: string;
  initialPrizeOnly?: boolean;
  ips?: CatalogIp[];
}) {
  const action = item ? updateProduct : createProduct;
  return <form className="stack-form" action={action}>
    <input type="hidden" name="simpleCatalog" value="on" />
    {item ? <><input type="hidden" name="productId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : null}<ReturnTo value={returnTo} />
    <div className="field-grid">
      <WorkSelect ips={ips} value={item?.ipId || initialIpId} />
      {item ? <>
        <label>상품 종류<input value={item.category === "gacha" ? "가챠" : item.category === "kuji" ? "쿠지" : item.category} readOnly aria-readonly="true" title="종류 변경은 새 SKU 등록으로 처리합니다." /></label>
        <input type="hidden" name="category" value={item.category} />
      </> : <label>상품 종류<select name="category" defaultValue="gacha"><option value="gacha">가챠</option><option value="kuji">쿠지</option><option value="figure">피규어 (내부 전용)</option><option value="tcg">카드 (내부 전용)</option></select></label>}
      <label>상품명<input name="name" defaultValue={item?.name || initialName} maxLength={240} placeholder="고객에게 보일 상품 이름" required /></label>
      <label>가격 (원)<input type="number" name="price" min={0} max={2147483647} defaultValue={item?.price ?? 0} required /></label>
      {item ? <div className="immutable-field"><span>재고</span><strong>{item.availableQuantity.toLocaleString("ko-KR")}개</strong><small>수량 변경은 재고 메뉴에서 처리하세요.</small></div>
        : <label>처음 등록할 재고 수<input type="number" name="availableQuantity" min={0} max={2147483647} defaultValue={0} required /></label>}
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
        <strong>{item.isPrizeOnly ? "구성 상품" : "판매 상품"}</strong>
        <small>상품 용도는 생성 후 바꿀 수 없습니다. 다른 용도는 새 상품으로 등록하세요.</small>
      </div> : <label className="span-2 check-field product-kind-field">
        <input type="checkbox" name="isPrizeOnly" defaultChecked={initialPrizeOnly} />
        <span><strong>구성 상품으로 등록</strong><small>개별 판매하지 않고 가챠·쿠지 구성에만 사용합니다. 생성 후 용도는 변경할 수 없습니다.</small></span>
      </label>}
    </div>
    <details className="catalog-optional"><summary>추가 정보 (선택)</summary><div className="field-grid">
      <label>제조사<input name="manufacturer" defaultValue={item?.manufacturer || ""} maxLength={160} /></label><label>출시일<input type="date" name="releaseDate" defaultValue={item?.releaseDate || ""} /></label>
    </div></details>
    {!item ? <p className="muted">사진은 상품 등록 후 ‘사진 관리’에서 직접 잘라 올려주세요.</p> : null}
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
  role: "primary" | "storefront" | "gallery";
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
      : [{ label: "원본 비율 · 전체 사진", value: 0 }, { label: "6:5", value: 6 / 5 }, { label: "4:3", value: 4 / 3 }, { label: "1:1", value: 1 }]}
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

function GalleryImageClearForm({ item, imageUrl, index, returnTo }: { item: CatalogProduct; imageUrl: string; index: number; returnTo: string }) {
  return <form className="stack-form catalog-image-form" action={clearGalleryProductImage}>
    <input type="hidden" name="productId" value={item.id} />
    <input type="hidden" name="expectedVersion" value={item.version} />
    <input type="hidden" name="imageUrl" value={imageUrl} />
    <ReturnTo value={returnTo} />
    <p><strong>상세 슬라이드 {index + 1} 연결 해제</strong></p>
    <p className="muted">이 사진만 상품 상세 슬라이드에서 제거합니다. 기본 대표·목록·경품 사진은 유지됩니다.</p>
    <label className="check-field"><input type="checkbox" name="confirmGalleryImageClear" required />이 사진 연결 해제를 확인했습니다.</label>
    <ReasonField label="상세 슬라이드 사진 연결 해제 사유" />
    <div className="form-actions"><button className="danger">슬라이드 사진 제거</button></div>
  </form>;
}

export function ProductImageForm({ item, returnTo }: { item: CatalogProduct; returnTo: string }) {
  const gallery = Array.isArray(item.metadata?.detailGalleryImageUrls)
    ? item.metadata.detailGalleryImageUrls.filter((url): url is string => typeof url === "string")
    : [];
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
      {gallery.map((url, index) => <CurrentProductImage key={`${index}-${url}`} label={`상세 슬라이드 ${index + 1}`} url={url} />)}
    </div>
    <ProductImageUploadForm
      item={item}
      returnTo={returnTo}
      role="primary"
      label="새 대표 사진"
      guidance="상품 상세와 기존 화면에 사용하는 기본 사진 · 원본 비율로 전체 사진을 유지하거나 6:5·4:3·1:1로 자르기 · JPG, PNG, WEBP, GIF · 최대 10MB"
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
    {gallery.length < 8 ? <ProductImageUploadForm
      item={item}
      returnTo={returnTo}
      role="gallery"
      label="새 상세 슬라이드 사진"
      guidance="상품 상세에서 등록 순서대로 넘겨 볼 사진 · 최대 8장 · JPG, PNG, WEBP, GIF · 각 10MB 이하. 첫 사진부터 차례로 한 장씩 등록하세요."
      buttonLabel="상세 슬라이드 사진 추가"
    /> : <p className="muted">상세 슬라이드 사진은 최대 8장입니다.</p>}
    {gallery.length ? <p className="muted">상세 슬라이드 사진이 있으면 고객 상세 화면에는 이 사진들만 표시됩니다. 기본 대표 사진은 슬라이드에 자동 추가되지 않습니다.</p> : null}
    {item.storefrontImageUrl ? <StorefrontImageClearForm item={item} returnTo={returnTo} /> : null}
    {gallery.map((url, index) => <GalleryImageClearForm key={`${index}-${url}`} item={item} imageUrl={url} index={index} returnTo={returnTo} />)}
  </>;
}
