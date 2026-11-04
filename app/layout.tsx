import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "现货仓库 · 库存管理",
  description: "独立 SKU 盘点、入库与 ERP 订单库存管理。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
