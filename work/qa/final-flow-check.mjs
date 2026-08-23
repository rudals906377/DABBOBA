import { chromium } from "playwright";

const baseURL = "http://127.0.0.1:4174/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 });
const errors = [];

page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
page.on("requestfailed", (request) => errors.push(`network: ${request.url()} ${request.failure()?.errorText ?? "failed"}`));

const screen = page.getByTestId("device-screen");

async function settle(delay = 250) {
  await page.waitForTimeout(delay);
  await page.mouse.move(1360, 1160);
}

async function shot(name) {
  await settle();
  await screen.screenshot({ path: `work/qa/final-${name}.png`, animations: "disabled" });
}

async function currentMainLabel() {
  return page.locator('.flow-screen[data-flow-current="true"] main').getAttribute("aria-label");
}

await page.goto(baseURL, { waitUntil: "networkidle" });
await screen.waitFor();
await settle(250);

const dimensions = await screen.evaluate((element) => ({
  width: element.clientWidth,
  height: element.clientHeight,
  scrollTop: element.scrollTop,
}));

await shot("catalog");
await page.getByRole("button", { name: /별빛 마법부 픽셀 참 컬렉션/ }).click();
await settle(450);
const detailFocus = await currentMainLabel();
await shot("detail");

await page.getByRole("button", { name: "뽑기 진행하기" }).click();
await page.getByTestId("bottom-sheet").waitFor();
await settle(350);
await shot("quantity");
await page.getByTestId("bottom-sheet").getByRole("button", { name: "결제하기" }).click();
await settle(450);
const checkoutFocus = await currentMainLabel();

await page.getByRole("button", { name: /쿠폰 사용 안 함/ }).click();
const noCoupon = page.getByRole("radio", { name: "COUPON 사용하지 않기" });
await noCoupon.focus();
await noCoupon.press("ArrowUp");
await settle(100);
const welcomeCoupon = page.getByRole("radio", { name: "WELCOME 첫 뽑기 1,000원 할인" });
const couponKeyboard = {
  sheetVisible: await page.getByTestId("bottom-sheet").isVisible(),
  welcomeChecked: await welcomeCoupon.getAttribute("aria-checked"),
  activeText: await page.locator(":focus").innerText(),
};
await page.keyboard.press("Escape");
await settle(350);

const cardPayment = page.getByRole("radio", { name: "간편카드" });
await cardPayment.focus();
await cardPayment.press("ArrowDown");
await settle(100);
const paymentKeyboard = {
  kakaoChecked: await page.getByRole("radio", { name: "카카오페이" }).getAttribute("aria-checked"),
  activeText: await page.locator(":focus").innerText(),
};
await shot("checkout");

await page.getByRole("button", { name: "결제하기" }).click();
await settle(1_450);
const drawFocus = await currentMainLabel();
const drawBackButtons = await page.getByRole("button", { name: "뒤로 가기" }).count();
await shot("draw");

await page.getByRole("button", { name: /뽑기 · 1회/ }).click();
await page.getByRole("heading", { name: "뽑기 완료" }).waitFor({ timeout: 4_000 });
await settle(250);
await shot("result");
await page.getByTestId("sheet-overlay").click({ position: { x: 12, y: 12 } });
await settle(1_100);

const finalState = {
  currentMain: await currentMainLabel(),
  flowScreens: await page.locator(".flow-screen").count(),
  drawBackButtons,
  screenScrollTop: await screen.evaluate((element) => element.scrollTop),
  focusedMain: await page.locator('.flow-screen[data-flow-current="true"] main').evaluate((element) => document.activeElement === element),
};

console.log(JSON.stringify({ dimensions, detailFocus, checkoutFocus, couponKeyboard, paymentKeyboard, drawFocus, finalState, errors }, null, 2));

if (
  dimensions.width !== 393 ||
  dimensions.height !== 852 ||
  couponKeyboard.sheetVisible !== true ||
  couponKeyboard.welcomeChecked !== "true" ||
  paymentKeyboard.kakaoChecked !== "true" ||
  drawBackButtons !== 0 ||
  finalState.currentMain !== "DABBOBA 상품 목록" ||
  finalState.flowScreens !== 1 ||
  finalState.screenScrollTop !== 0 ||
  finalState.focusedMain !== true ||
  errors.length > 0
) {
  process.exitCode = 1;
}

await browser.close();
