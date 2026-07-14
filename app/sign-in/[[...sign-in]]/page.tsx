import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <section
      aria-labelledby="sign-in-heading"
      className="pattern-leaves px-4 py-12 sm:py-16 lg:py-20"
    >
      <div className="container mx-auto grid min-h-[36rem] max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)] lg:gap-16">
        <div className="mx-auto max-w-xl text-center lg:mx-0 lg:text-left">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Your Curio Garden account
          </p>
          <h1
            id="sign-in-heading"
            className="font-display text-4xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-5xl"
          >
            Welcome back to the garden.
          </h1>
          <p className="mt-5 text-base leading-7 text-foreground-2 sm:text-lg">
            Sign in to sync your bookmarks, playlists, listening progress, and
            dashboard across devices.
          </p>
        </div>

        <div className="flex w-full justify-center lg:justify-end">
          <SignIn />
        </div>
      </div>
    </section>
  );
}
