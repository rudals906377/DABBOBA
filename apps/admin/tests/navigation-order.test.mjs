import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_NAVIGATION } from "../lib/navigation.ts";

test("admin navigation keeps every route and capability in the approved Korean order with IP last", () => {
  assert.deepEqual(ADMIN_NAVIGATION, [
    { href: "/audit-logs", label: "감사 로그", eyebrow: "AUDIT", capability: "audit.read" },
    { href: "/posts", label: "게시물", eyebrow: "POSTS", capability: "moderation.manage" },
    { href: "/commerce/payments", label: "결제", eyebrow: "PAYMENTS", capability: "payments.read" },
    { href: "/notices", label: "공지사항", eyebrow: "NOTICE", capability: "notices.manage" },
    { href: "/administrators", label: "관리자", eyebrow: "RBAC", capability: "administrators.manage" },
    { href: "/exchanges", label: "교환", eyebrow: "EXCHANGE", capability: "exchange.manage" },
    { href: "/", label: "대시보드", eyebrow: "OVERVIEW", capability: "dashboard.read" },
    { href: "/comments", label: "댓글", eyebrow: "COMMENTS", capability: "moderation.manage" },
    { href: "/inquiries", label: "문의", eyebrow: "SUPPORT", capability: "inquiries.manage" },
    { href: "/commerce/shipping", label: "배송", eyebrow: "SHIPPING", capability: "shipping.manage" },
    { href: "/catalog/products", label: "상품", eyebrow: "PRODUCTS", capability: "catalog.manage" },
    { href: "/reports", label: "신고", eyebrow: "REPORTS", capability: "reports.manage" },
    { href: "/commerce/inventory", label: "재고", eyebrow: "INVENTORY", capability: "inventory.read" },
    { href: "/commerce/orders", label: "주문", eyebrow: "ORDERS", capability: "orders.read" },
    { href: "/catalog/requests", label: "카탈로그 신청", eyebrow: "REQUESTS", capability: "catalogRequests.manage" },
    { href: "/catalog/categories", label: "카테고리", eyebrow: "CATEGORIES", capability: "catalog.manage" },
    { href: "/catalog/characters", label: "캐릭터", eyebrow: "CHARACTERS", capability: "catalog.manage" },
    { href: "/account-deletions", label: "탈퇴 검토", eyebrow: "ACCOUNT EXIT", capability: "accountDeletions.manage" },
    { href: "/catalog/home-sections", label: "홈 구성", eyebrow: "HOME", capability: "catalog.manage" },
    { href: "/commerce/refunds", label: "환불 검토", eyebrow: "REFUNDS", capability: "refunds.manage" },
    { href: "/users", label: "회원", eyebrow: "USERS", capability: "users.manage" },
    { href: "/catalog/ips", label: "IP", eyebrow: "CATALOG", capability: "catalog.manage" },
  ]);
  assert.equal(new Set(ADMIN_NAVIGATION.map(({ href }) => href)).size, 22);
});
