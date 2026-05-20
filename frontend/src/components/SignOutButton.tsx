"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "secondaryButton" }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button className={className} disabled={pending} onClick={() => void signOut()} type="button">
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
