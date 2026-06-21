import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Mark } from "@/components/icons";
import { buttonClass } from "@/components/ui";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 text-spine">
          <Mark width={26} height={26} />
          <span className="font-display text-2xl font-bold tracking-tight text-ink">Throughline</span>
        </div>

        <h1 className="font-display mt-9 text-[2.6rem] font-bold leading-[1.06] text-ink">
          Every decision
          <br />
          keeps its reason.
        </h1>
        <p className="mt-4 max-w-prose text-graphite">
          Throughline turns a team&apos;s approved ideas into spec-linked tasks for Claude Code — and records the{" "}
          <span className="font-medium text-ink">why</span>{" "}
          behind each one in an append-only log, so the project&apos;s history never gets lost.
        </p>

        <div className="spine mt-9 mb-10 text-sm">
          <div className="spine-node pb-3.5">
            <span className="font-mono text-spine-deep">idea approved</span>{" "}
            <span className="text-graphite">— reached the 2-vote gate</span>
          </div>
          <div className="spine-node pb-3.5">
            <span className="font-mono text-spine-deep">REQ-017 declared</span>{" "}
            <span className="text-graphite">— split out of drift</span>
          </div>
          <div className="spine-node" data-kind="merge">
            <span className="font-mono text-spine-deep">TASK-014 merged</span>{" "}
            <span className="text-graphite">— by alice</span>
          </div>
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/dashboard" });
          }}
        >
          <button type="submit" className={buttonClass("primary")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
