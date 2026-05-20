import { betterAuth } from "better-auth";
import Database from "better-sqlite3";

export const auth = betterAuth({
  database: new Database("./auth.db"),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000", "cottonoha://"],
  emailAndPassword: { enabled: true },
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
