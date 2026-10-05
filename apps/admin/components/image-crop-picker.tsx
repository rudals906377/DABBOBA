"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { cropOutputSize, imageCropRect } from "../lib/image-crop-geometry";

type ImageSource = { file: File; url: string; width: number; height: number };
type ImageCropPickerProps = {
  productId: string;
  expectedVersion: number;
  returnTo: string;
  role: "primary" | "storefront" | "gallery";
  idempotencyKeys: { intent: string; complete: string; attach: string };
  label: string;
  guidance: string;
  buttonLabel: string;
  ratios: readonly { label: string; value: number }[];
  minimumWidth?: number;
  minimumHeight?: number;
};

export function ImageCropPicker({ productId, expectedVersion, returnTo, role, idempotencyKeys, label, guidance, buttonLabel, ratios, minimumWidth = 0, minimumHeight = 0 }: ImageCropPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const selectionRef = useRef(0);
  const cropRevisionRef = useRef(0);
  const [source, setSource] = useState<ImageSource | null>(null);
  const [ratio, setRatio] = useState(ratios[0]?.value ?? 1);
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(50);
  const [vertical, setVertical] = useState(50);
  const [applying, setApplying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);

  useEffect(() => {
    const canvas = previewRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !source) return;
    const effectiveRatio = ratio === 0 ? source.width / source.height : ratio;
    const rect = imageCropRect(source.width, source.height, effectiveRatio, zoom, horizontal, vertical);
    canvas.width = Math.max(1, Math.round(Math.min(600, 600 * effectiveRatio)));
    canvas.height = Math.max(1, Math.round(canvas.width / effectiveRatio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  }, [source, ratio, zoom, horizontal, vertical]);

  function resetCrop() {
    cropRevisionRef.current += 1;
    setZoom(1);
    setHorizontal(50);
    setVertical(50);
    setConfirmed(false);
    setMessage("");
  }

  function invalidateCrop() {
    cropRevisionRef.current += 1;
    setConfirmed(false);
    setMessage("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    selectionRef.current += 1;
    const selection = selectionRef.current;
    imageRef.current = null;
    setSource(null);
    resetCrop();
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      input.value = "";
      setMessage("JPG, PNG, WEBP, GIF 파일 중 10MB 이하 사진을 선택해 주세요.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (selection !== selectionRef.current) { URL.revokeObjectURL(url); return; }
      if (!image.naturalWidth || !image.naturalHeight) {
        URL.revokeObjectURL(url);
        setMessage("사진 크기를 읽을 수 없습니다. 다른 파일을 선택해 주세요.");
        return;
      }
      if (image.naturalWidth * image.naturalHeight > 40_000_000) {
        URL.revokeObjectURL(url);
        input.value = "";
        setMessage("사진이 너무 큽니다. 4천만 화소 이하 파일을 선택해 주세요.");
        return;
      }
      imageRef.current = image;
      setSource({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (selection === selectionRef.current) setMessage("사진을 열 수 없습니다. 다른 파일을 선택해 주세요.");
    };
    image.src = url;
  }

  async function applyCrop() {
    const image = imageRef.current;
    const input = inputRef.current;
    if (!source || !image || !input || applying) return;
    const selection = selectionRef.current;
    const cropRevision = cropRevisionRef.current;
    setApplying(true);
    setMessage("");
    try {
      const effectiveRatio = ratio === 0 ? source.width / source.height : ratio;
      const rect = imageCropRect(source.width, source.height, effectiveRatio, zoom, horizontal, vertical);
      const { width, height } = cropOutputSize(rect, effectiveRatio, 2400);
      if (width < 1 || height < 1) throw new Error("선택한 사진 영역이 너무 작습니다. 확대를 줄여 주세요.");
      if (width < minimumWidth || height < minimumHeight) {
        throw new Error(`선택한 영역은 최소 ${minimumWidth}×${minimumHeight}px이어야 합니다. 확대를 줄이거나 더 큰 원본을 선택해 주세요.`);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("이 브라우저에서 사진 자르기를 사용할 수 없습니다.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingQuality = "high";
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
      const mimeType = source.file.type === "image/png" || source.file.type === "image/gif" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.9));
      if (!blob || blob.size > 10 * 1024 * 1024) throw new Error("잘라낸 사진이 10MB를 넘습니다. 확대하거나 JPG 원본을 사용해 주세요.");
      if (selection !== selectionRef.current || cropRevision !== cropRevisionRef.current) return;
      const stem = source.file.name.replace(/\.[^.]+$/, "").slice(0, 180) || "product";
      const file = new File([blob], `${stem}-crop.${mimeType === "image/png" ? "png" : "jpg"}`, { type: mimeType });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      setConfirmed(true);
      setMessage(`자르기 적용 완료 · ${width}×${height}px · ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    } catch (error) {
      setConfirmed(false);
      setMessage(error instanceof Error ? error.message : "사진 자르기에 실패했습니다.");
    } finally {
      setApplying(false);
    }
  }

  return <form className="stack-form catalog-image-form catalog-crop-picker" action="/api/catalog/images" method="post" encType="multipart/form-data" data-crop-confirmed={confirmed} onSubmit={(event) => {
    if (confirmed && !applying && !submitting) { setSubmitting(true); return; }
    event.preventDefault();
    setMessage("사진을 선택하고 자르기 적용을 완료한 뒤 업로드해 주세요.");
  }}>
    <input type="hidden" name="productId" value={productId} />
    <input type="hidden" name="expectedVersion" value={expectedVersion} />
    <input type="hidden" name="role" value={role} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <input type="hidden" name="idempotencyKey" value={idempotencyKeys.intent} />
    <input type="hidden" name="completeIdempotencyKey" value={idempotencyKeys.complete} />
    <input type="hidden" name="attachIdempotencyKey" value={idempotencyKeys.attach} />
    <label>{label}
      <input ref={inputRef} type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required onChange={handleFileChange} />
      <small>{guidance}</small>
    </label>
    {source ? <div className="catalog-crop-editor">
      <p className="muted">미리보기에서 원하는 위치를 맞추고 <strong>자르기 적용</strong>을 누르세요. 적용 전에는 업로드할 수 없습니다.</p>
      <canvas ref={previewRef} className="catalog-crop-preview" role="img" aria-label="잘라낼 상품 사진 미리보기" />
      {ratios.length > 1 ? <label>사진 비율
        <select value={ratio} onChange={(event) => { setRatio(Number(event.target.value)); invalidateCrop(); }}>
          {ratios.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </label> : null}
      <label>확대 · {zoom.toFixed(1)}배
        <input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(event) => { setZoom(Number(event.target.value)); invalidateCrop(); }} />
      </label>
      <label>가로 위치 · {horizontal}%
        <input type="range" min="0" max="100" value={horizontal} onChange={(event) => { setHorizontal(Number(event.target.value)); invalidateCrop(); }} />
      </label>
      <label>세로 위치 · {vertical}%
        <input type="range" min="0" max="100" value={vertical} onChange={(event) => { setVertical(Number(event.target.value)); invalidateCrop(); }} />
      </label>
      <button type="button" disabled={applying} onClick={() => void applyCrop()}>{applying ? "사진 자르는 중…" : "자르기 적용"}</button>
      {source.file.type === "image/gif" ? <small>GIF는 잘라낸 첫 장면을 PNG 사진으로 저장합니다.</small> : null}
    </div> : null}
    {message ? <p role="status" className={confirmed ? "catalog-crop-success" : "catalog-crop-error"}>{message}</p> : null}
    <label className="reason-field"><span>{label} 변경 사유<b>필수</b></span><textarea name="reason" minLength={2} maxLength={1000} required placeholder="감사 로그에 남길 구체적인 사유를 입력하세요." /></label>
    <div className="form-actions"><button className="primary" disabled={!confirmed || applying || submitting}>{submitting ? "사진 저장 중…" : buttonLabel}</button></div>
  </form>;
}
