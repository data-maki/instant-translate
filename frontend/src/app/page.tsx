import { LandingPage } from "@/components/LandingPage";
import { getSession } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = getSession(await headers());

  if (session) {
    redirect("/chat");
  }

  return <LandingPage />;
}
