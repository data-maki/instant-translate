"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { safeRouterPush } from "@/lib/safe-router";

export function SignOutButton({ className = "secondaryButton" }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    safeRouterPush(router, "/sign-in");
  }

  return (
    <button className={className} disabled={pending} onClick={() => void signOut()} type="button">
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
