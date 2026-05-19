"use client";

import dynamic from "next/dynamic";
import type { TranslatorAppProps } from "@/components/TranslatorApp";

const TranslatorAppNoSsr = dynamic<TranslatorAppProps>(
  () => import("@/components/TranslatorApp").then((module) => module.TranslatorApp),
  { ssr: false }
);

export function TranslatorAppClient(props: TranslatorAppProps) {
  return <TranslatorAppNoSsr {...props} />;
}
