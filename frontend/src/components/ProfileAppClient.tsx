"use client";

import dynamic from "next/dynamic";

const ProfileAppNoSsr = dynamic(() => import("@/components/ProfileApp").then((module) => module.ProfileApp), {
  ssr: false
});

export function ProfileAppClient() {
  return <ProfileAppNoSsr />;
}
