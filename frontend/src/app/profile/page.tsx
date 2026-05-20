import { ProfileAppClient } from "@/components/ProfileAppClient";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session) {
    redirect("/sign-in?next=/profile");
  }

  return <ProfileAppClient />;
}
