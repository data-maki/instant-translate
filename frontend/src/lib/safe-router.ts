import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** Navigate after the App Router action queue is ready (avoids init race). */
export function safeRouterPush(router: Pick<AppRouterInstance, "push" | "refresh">, href: string) {
  if (typeof window === "undefined") {
    return;
  }
  const navigate = () => {
    router.push(href);
    router.refresh();
  };
  requestAnimationFrame(() => {
    queueMicrotask(navigate);
  });
}
