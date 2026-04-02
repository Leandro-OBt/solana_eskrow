"use client";

import dynamic from "next/dynamic";
import { SolanaProviders } from "../components/SolanaProviders";

const EscrowApp = dynamic(
  () =>
    import("../components/EscrowApp").then((mod) => ({
      default: mod.default,
    })),
  { ssr: false }
);

export default function Home() {
  return (
    <SolanaProviders>
      <EscrowApp />
    </SolanaProviders>
  );
}
