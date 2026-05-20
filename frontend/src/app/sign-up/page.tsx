import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function SignUpPage() {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (session) {
    redirect("/chat");
  }

  return (
    <Suspense fallback={null}>
      <AuthForm mode="sign-up" />
    </Suspense>
  );
}
