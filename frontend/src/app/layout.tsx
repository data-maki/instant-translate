import type { Metadata } from "next";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "cottonoha · コトノハ",
  description: "日本語のままで、外国人と通じる。Voice-first JA ⇄ EN translation, built in Tokyo.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="theme-light" lang="ja">
      <body suppressHydrationWarning>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
