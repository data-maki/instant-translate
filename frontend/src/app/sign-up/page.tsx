import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { getSession } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function SignUpPage() {
  const session = getSession(await headers());

  if (session) {
    redirect("/chat");
  }

  return (
    <Suspense fallback={null}>
      <AuthForm mode="sign-up" />
    </Suspense>
  );
}
