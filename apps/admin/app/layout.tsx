import "@dabboba/ui/tokens.css";
import "./globals.css";
import { connection } from "next/server";

export const metadata = {
  title: "DABBOBA Operations",
  description: "DABBOBA 관리자 운영 콘솔",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every console page renders per request so proxy.ts's CSP nonce reaches
  // the framework scripts; a prerendered page would carry no nonce.
  await connection();
  return <html lang="ko"><body>{children}</body></html>;
}
