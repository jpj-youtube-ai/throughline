import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main style={{ padding: 32 }}>
        <h1>Throughline</h1>
        <form
          action={async () => {
            "use server";
            await signIn("github");
          }}
        >
          <button type="submit">Sign in with GitHub</button>
        </form>
      </main>
    );
  }

  return (
    <main style={{ padding: 32 }}>
      <h1>Throughline</h1>
      <p>Signed in as {session.user.name ?? session.user.login ?? "unknown"}</p>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
