import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SNRG Order Converter",
  description: "Convert handwritten sales orders into ERPNext-ready Excel rows."
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
