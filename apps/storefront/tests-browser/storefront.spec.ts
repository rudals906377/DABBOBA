import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const widths = await page.locator("html").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}

test("mobile storefront keeps every prelaunch destination usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "원하는 거 다 뽀바" })).toBeVisible();
  await expect(page.getByText("사전 오픈 준비 중")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const dots = page.getByRole("navigation", { name: "소개 화면 바로가기" }).getByRole("link");
  await expect(dots).toHaveCount(6);
  for (const dot of await dots.all()) {
    const box = await dot.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }

  for (const cue of await page.locator(".scroll-cue").all()) {
    await expect(cue).toBeHidden();
  }

  await page.getByRole("link", { name: "보관·배송 화면으로 이동" }).click();
  await expect(page.getByRole("heading", { name: "뽑은 상품, 모아서 한 번에 받아요" })).toBeInViewport();
  await expect(page.getByText("획득일부터 60일 보관")).toBeVisible();
  await expect(page.getByText("24,900원 이상 무료 배송")).toBeVisible();
  await expect(page.getByText("54,900원 이상 무료 배송")).toBeVisible();
  await expect(page.getByText("배송비 3,000원")).toBeVisible();

  await page.getByRole("link", { name: "이용 안내 화면으로 이동" }).click();
  await expect(page.getByRole("heading", { name: "곧, 앱에서 만나요" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "고객지원 보기" })).toHaveAttribute("href", "/support");
  for (const name of ["이용약관", "개인정보처리방침", "고객지원", "계정 삭제"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeAttached();
  }

  await expect(page.getByRole("link", { name: /구매하기|결제하기|뽑기 시작/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("desktop storefront preserves the one-message-per-screen hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "페이지 안내" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "원하는 거 다 뽀바" })).toBeVisible();
  await page.getByRole("link", { name: "앱 화면 미리보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "취향에 맞는 뽑기를 한눈에" })).toBeInViewport();
  await expect(page.locator(".phone-preview")).toBeInViewport();
  await expectNoHorizontalOverflow(page);
});
