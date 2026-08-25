import "@dabboba/ui/tokens.css";
import "./globals.css";

export const metadata = {
  title: "DABBOBA Operations",
  description: "DABBOBA 관리자 운영 콘솔",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
