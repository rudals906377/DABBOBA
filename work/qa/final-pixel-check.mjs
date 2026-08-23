import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 });
const errors = [];

page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
page.on("requestfailed", (request) => errors.push(`network: ${request.url()}`));

await page.goto("http://127.0.0.1:4174/", { waitUntil: "networkidle" });
await page.getByTestId("device-picker").click();
await page.getByTestId("device-option-pixel-10").click();
await page.waitForTimeout(350);

const screen = page.getByTestId("device-screen");
await page.mouse.move(1360, 1160);
await screen.screenshot({ path: "work/qa/final-pixel-catalog.png", animations: "disabled" });

await page.getByRole("button", { name: /별빛 마법부 픽셀 참 컬렉션/ }).click();
await page.waitForTimeout(350);
await page.getByRole("button", { name: "뽑기 진행하기" }).click();
await page.getByTestId("bottom-sheet").getByRole("button", { name: "결제하기" }).click();
await page.waitForTimeout(350);
await page.getByRole("button", { name: "결제하기" }).click();
await page.waitForTimeout(1_450);
await page.mouse.move(1360, 1160);
await screen.screenshot({ path: "work/qa/final-pixel-draw.png", animations: "disabled" });

const metrics = await screen.evaluate((element) => ({
  width: element.clientWidth,
  height: element.clientHeight,
  scrollTop: element.scrollTop,
  scrollWidth: element.scrollWidth,
  clientWidth: element.clientWidth,
}));

console.log(JSON.stringify({ metrics, errors }, null, 2));
if (metrics.scrollTop !== 0 || metrics.scrollWidth > metrics.clientWidth || errors.length > 0) process.exitCode = 1;

await browser.close();
