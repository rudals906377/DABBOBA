import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Mirrors src/launch-copy.ts for the static <head>: only the exact build
// variable VITE_DABBOBA_COMMERCE_MODE=LIVE swaps the prelaunch metadata.
const PRELAUNCH_DESCRIPTION = "가챠부터 쿠지까지, 원하는 거 다 뽀바. 다뽀바의 사전 오픈 안내를 확인하세요.";
const PRELAUNCH_OG_DESCRIPTION = "상품 탐색과 관심 상품 저장부터 시작하는 다뽀바 사전 오픈을 준비하고 있습니다.";
const LIVE_DESCRIPTION = "가챠부터 쿠지까지, 원하는 거 다 뽀바. 다뽀바 앱에서 가챠를 뽑고 보관함에 모아 받아요.";
const LIVE_OG_DESCRIPTION = "다뽀바 앱에서 가챠를 뽑고, 보관함에 모아 한 번에 배송받아요.";

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
