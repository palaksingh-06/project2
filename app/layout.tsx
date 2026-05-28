import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zero Based Costing Calculator",
  description:
    "Transport trip cost calculator with 10 cost-head breakdown for Indian freight lanes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
