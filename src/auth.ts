import NextAuth from "next-auth";
import { providers } from "./auth/providers";
import { getDb } from "./db/client";
import { upsertUserFromGithubProfile } from "./auth/users";

interface GithubProfile {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    // On sign-in, provision our SPEC §3 user row and remember its id on the JWT.
    async jwt({ token, profile, account }) {
      if (account?.provider === "github" && profile) {
        const gh = profile as unknown as GithubProfile;
        const user = await upsertUserFromGithubProfile(getDb(), {
          githubId: Number(gh.id),
          githubLogin: String(gh.login),
          name: gh.name ?? null,
          avatarUrl: gh.avatar_url ?? null,
        });
        token.uid = user.id;
        token.login = user.githubLogin;
      }
      return token;
    },
    // Expose our app user id for attribution throughout the app.
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      if (typeof token.login === "string") session.user.login = token.login;
      return session;
    },
  },
});
