type AuthResponse = {
  error?: {
    message?: string;
    statusText?: string;
  };
};

type AuthCallbacks = {
  onError?: (ctx: AuthResponse) => void;
  onSuccess?: () => void;
};

async function postAuth(path: string, body?: Record<string, unknown>, callbacks?: AuthCallbacks) {
  const response = await fetch(`/api/auth/${path}`, {
    body: JSON.stringify(body ?? {}),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as AuthResponse["error"];
    callbacks?.onError?.({ error: { message: error?.message || "Authentication failed.", statusText: response.statusText } });
    return;
  }

  callbacks?.onSuccess?.();
}

export const authClient = {
  signIn: {
    email(body: { email: string; password: string }, callbacks?: AuthCallbacks) {
      return postAuth("sign-in/email", body, callbacks);
    }
  },
  signUp: {
    email(body: { email: string; name?: string; password: string }, callbacks?: AuthCallbacks) {
      return postAuth("sign-up/email", body, callbacks);
    }
  },
  signOut() {
    return postAuth("sign-out");
  }
};
