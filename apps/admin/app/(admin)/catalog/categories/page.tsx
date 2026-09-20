import { StorefrontCategoryForm } from "../../../../components/storefront-category-form";
import { Feedback, PageHeader, StatusBadge, first } from "../../../../components/operations";
import { adminApi } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { SearchParams, StorefrontCategorySettingList } from "../../../../lib/admin-types";

const AVAILABILITY_LABELS = {
  active: "판매 중",
  "coming-soon": "준비 중",
  hidden: "숨김",
} as const;

export default async function StorefrontCategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await requireCapability("catalog.manage");
  const settings = await adminApi<StorefrontCategorySettingList>("/v1/admin/category-settings", { token: session.token });
  const returnTo = "/catalog/categories";
  return <>
    <PageHeader
      eyebrow="STOREFRONT CATEGORIES"
      title="카테고리"
      description="앱 카테고리의 표시 이름, 순서, 운영 상태와 화면별 노출을 관리합니다. 저장한 설정은 실행 중인 앱에도 자동 반영됩니다."
    />
    <Feedback searchParams={query} />
    <section className="data-panel">
      <table className="data-table">
        <thead><tr><th>순서 / 카테고리</th><th>상태</th><th>노출 화면</th><th>안내</th><th>작업</th></tr></thead>
        <tbody>{settings.items.map((item) => {
          const surfaces = [
            item.showOnHome && "홈",
            item.showOnCatalog && "뽀바",
            item.showOnExchange && "교환방",
            item.showOnWanted && "신청방",
          ].filter(Boolean).join(" · ") || "노출 없음";
          return <tr key={item.category}>
            <td><strong>{item.sortOrder}. {item.label}</strong><br /><span className="muted">{item.category}</span></td>
            <td><StatusBadge value={AVAILABILITY_LABELS[item.availability]} /></td>
            <td>{surfaces}</td>
            <td>{item.description || <span className="muted">안내 없음</span>}</td>
            <td><details className="inline-details" open={first(query.edit) === item.category}><summary>수정</summary><StorefrontCategoryForm item={item} returnTo={returnTo} /></details></td>
          </tr>;
        })}</tbody>
      </table>
    </section>
  </>;
}
