import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Mirrors src/launch-copy.ts for the static <head>: only the exact build
// variable VITE_DABBOBA_COMMERCE_MODE=LIVE swaps the prelaunch metadata.
const PRELAUNCH_DESCRIPTION = "포함된 상품 중 1개를 만나는 다뽀바. 사전 오픈 안내를 확인하세요.";
const PRELAUNCH_OG_DESCRIPTION = "포함된 상품과 공개 구성을 확인하고, 캡슐을 열면 포함된 상품 중 1개를 받는 다뽀바를 준비하고 있습니다.";
const LIVE_DESCRIPTION = "공개된 구성을 확인하고 포함된 상품 중 1개를 만나세요. 획득한 상품은 보관함에서 배송을 신청할 수 있어요.";
const LIVE_OG_DESCRIPTION = "다뽀바 앱에서 공개된 구성을 확인하고, 포함된 상품 중 1개를 받아 모아 한 번에 배송해요.";

function launchMetadata(live: boolean): Plugin {
  return {
    name: "dabboba-launch-metadata",
    transformIndexHtml(html) {
      if (!live) return html;
      for (const prelaunch of [PRELAUNCH_DESCRIPTION, PRELAUNCH_OG_DESCRIPTION]) {
        if (!html.includes(prelaunch)) throw new Error("Storefront prelaunch metadata changed; update vite.config.ts");
      }
      return html.replace(PRELAUNCH_DESCRIPTION, LIVE_DESCRIPTION).replace(PRELAUNCH_OG_DESCRIPTION, LIVE_OG_DESCRIPTION);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const live = (process.env.VITE_DABBOBA_COMMERCE_MODE ?? env.VITE_DABBOBA_COMMERCE_MODE) === "LIVE";
  return {
    build: {
      outDir: "dist",
    },
    plugins: [react(), launchMetadata(live)],
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
    },
  };
});
