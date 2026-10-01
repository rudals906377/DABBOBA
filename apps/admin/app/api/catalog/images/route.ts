import { revalidatePath } from "next/cache";
import { getAdminSession } from "../../../../lib/auth";
import { can } from "../../../../lib/capabilities";
import { catalogUploadForm, CatalogUploadBodyError } from "../../../../lib/catalog-upload-body";
import { productImageError, productImageReason, saveProductImage } from "../../../../lib/product-image-upload";
import { internalRedirect, safeInternalPath } from "../../../../lib/request-security";
import { isSameOriginRequestHeaders } from "../../../../lib/request-origin";

function feedback(destination: string, kind: "success" | "error", message: string) {
  const url = new URL(destination, "https://admin.invalid");
  url.searchParams.delete(kind === "success" ? "error" : "success");
  url.searchParams.set(kind, message);
  const response = internalRedirect(`${url.pathname}${url.search}${url.hash}`, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  // Native forms supply Origin. Fail closed without it; never depend on CORS or SameSite alone.
  if (!request.headers.get("origin") || request.headers.get("origin") !== new URL(request.url).origin || !isSameOriginRequestHeaders(request.headers)) {
    return Response.json({ error: "cross-origin request rejected" }, { status: 403 });
  }
  const session = await getAdminSession();
  if (!session) return internalRedirect("/login?reason=session-required", 303);
  if (!can(session.actor, "catalog.manage")) return Response.json({ error: "not authorized" }, { status: 403 });

  let form: FormData;
  try {
    form = await catalogUploadForm(request);
  } catch (error) {
    return Response.json({ error: error instanceof CatalogUploadBodyError ? error.message : "사진 업로드 요청을 읽지 못했습니다." }, {
      status: error instanceof CatalogUploadBodyError ? error.status : 400,
      headers: { "cache-control": "no-store" },
    });
  }
  const destination = safeInternalPath(form.get("returnTo"), "/catalog/products");
  try {
    await saveProductImage(form, session.token, productImageReason(form));
  } catch (error) {
    return feedback(destination, "error", productImageError(error));
  }
  revalidatePath(destination.split("?")[0] || "/catalog/products");
  return feedback(destination, "success", "상품 사진을 저장했습니다.");
}
