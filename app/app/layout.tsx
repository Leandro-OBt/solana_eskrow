import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Counter Program | Solana Anchor Bootcamp",
  description:
    "Frontend para o Counter Program — programa em Rust/Anchor com 4 instruções: Initialize, Increment, Decrement e Reset. Aula 2 do Bootcamp Solana.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
