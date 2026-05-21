import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import Database from "better-sqlite3";

export const auth = betterAuth({
  database: new Database("./auth.db"),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000", "cottonoha://"],
  emailAndPassword: { enabled: true },
  // The bearer plugin lets non-browser clients (the iOS app) authenticate to
  // the FastAPI backend with `Authorization: Bearer <session-token>`. The
  // backend forwards that header back to /api/auth/get-session here, which
  // resolves the token to a user — so the FastAPI side never has to trust a
  // client-supplied identity.
  plugins: [bearer()],
  // Social providers disabled for now — uncomment and fill in client IDs/secrets
  // (and the matching env vars in frontend/.env.local) to re-enable.
  // socialProviders: {
  //   google: {
  //     clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  //     clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  //   },
  //   gitlab: {
  //     clientId: process.env.GITLAB_CLIENT_ID ?? "",
  //     clientSecret: process.env.GITLAB_CLIENT_SECRET ?? "",
  //   },
  // },
});
