import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cottonoha",
  description: "Live English and Japanese conversation translation for life in Japan.",
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
