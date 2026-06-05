"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { safeRouterPush } from "@/lib/safe-router";

type AuthMode = "sign-in" | "sign-up";
type FieldErrors = { email?: string; password?: string };

const SUPPORT_EMAIL = "jcllobet@gmail.com";
const DEFAULT_NEXT = "/chat";

// Only allow same-origin, root-relative paths; reject protocol/host hijacks.
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  return next;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const next = safeNext(rawNext);
  const isSignUp = mode === "sign-up";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function clearError(field: keyof FieldErrors) {
    setFieldErrors((f) => (f[field] ? { ...f, [field]: undefined } : f));
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!email.trim()) errs.email = "Enter your email.";
    else if (!isEmail(email)) errs.email = "Enter a valid email address.";
    if (!password) errs.password = "Enter your password.";
    return errs;
  }

  function focusFirstError(errs: FieldErrors) {
    if (errs.email && emailRef.current) emailRef.current.focus();
    else if (errs.password && passwordRef.current) passwordRef.current.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError(errs);
      return;
    }

    setPending(true);

    const onSuccess = () => {
      safeRouterPush(router, next);
    };

    const onError = (ctx: { error?: { message?: string; statusText?: string } }) => {
      setFormError(ctx.error?.message || ctx.error?.statusText || "Authentication failed.");
      setPending(false);
    };

    if (isSignUp) {
      await authClient.signUp.email(
        { email, password },
        { onError, onSuccess }
      );
      return;
    }

    await authClient.signIn.email(
      { email, password },
      { onError, onSuccess }
    );
  }

  const passwordErrorId = "password-error";
  const emailErrorId = "email-error";
  const passwordDescribedBy = fieldErrors.password ? passwordErrorId : undefined;

  const nextQuery = rawNext ? `?next=${encodeURIComponent(next)}` : "";
  const switchTarget = (isSignUp ? "/sign-in" : "/sign-up") + nextQuery;

  return (
    <main className="authPage">
      <section className="authCard" aria-label={isSignUp ? "Internal access" : "Sign in"}>
        <Link aria-label="cottonoha, home" className="authBrand" href="/">
          <span className="brandMark compact" aria-hidden="true">
            <Image alt="" height={34} src="/favicon.svg" width={34} />
          </span>
          <span>cottonoha</span>
        </Link>
        <div className="authHeader">
          <p className="panelKicker">{isSignUp ? "sign up" : "sign in"}</p>
          <h1>{isSignUp ? "Internal access" : "Welcome back"}</h1>
          <p>{isSignUp ? "Use the credentials configured for this build." : "Sign in to continue translating."}</p>
        </div>

        <form className="authForm" noValidate onSubmit={submit} aria-busy={pending}>
          <label className="contextField">
            Email
            <input
              aria-describedby={fieldErrors.email ? emailErrorId : undefined}
              aria-invalid={fieldErrors.email ? true : undefined}
              autoComplete="email"
              disabled={pending}
              inputMode="email"
              name="email"
              onChange={(event) => { setEmail(event.target.value); clearError("email"); }}
              placeholder="you@example.com"
              ref={emailRef}
              type="email"
              value={email}
            />
            {fieldErrors.email ? (
              <span className="fieldError" id={emailErrorId}>{fieldErrors.email}</span>
            ) : null}
          </label>
          <label className="contextField">
            <span className="fieldLabelRow">
              <span>Password</span>
              {!isSignUp ? (
                <a
                  className="fieldLabelLink"
                  href={`mailto:${SUPPORT_EMAIL}?subject=cottonoha%20password%20reset`}
                >
                  Forgot password?
                </a>
              ) : null}
            </span>
            <span className="passwordField">
              <input
                aria-describedby={passwordDescribedBy}
                aria-invalid={fieldErrors.password ? true : undefined}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                disabled={pending}
                name="password"
                onChange={(event) => { setPassword(event.target.value); clearError("password"); }}
                placeholder="Your password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="passwordReveal"
                disabled={pending}
                onClick={() => setShowPassword((v) => !v)}
                type="button"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
            {fieldErrors.password ? (
              <span className="fieldError" id={passwordErrorId}>{fieldErrors.password}</span>
            ) : null}
          </label>
          {formError ? (
            <div className="errorBox" role="alert">{formError}</div>
          ) : null}
          <button className="primaryButton" disabled={pending} type="submit">
            {pending ? "Signing in…" : isSignUp ? "Continue" : "Sign in"}
          </button>
        </form>

        <p className="authSwitch">
          {isSignUp ? "Already have access?" : "Need access?"}{" "}
          <Link href={switchTarget}>{isSignUp ? "Sign in" : "Sign up"}</Link>
        </p>
      </section>
    </main>
  );
}
