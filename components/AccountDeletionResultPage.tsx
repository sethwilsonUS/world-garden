import Link from "next/link";

type AccountDeletionResultPageProps =
  | {
      status: "deleted";
    }
  | {
      status: "pending";
    };

const resultContent = {
  deleted: {
    eyebrow: "Account deleted",
    title: "Your Curio Garden account has been deleted.",
    description:
      "Your sign-in is gone. Curio Garden will finish removing any remaining signed-in data in the background.",
  },
  pending: {
    eyebrow: "Deletion in progress",
    title: "Your deletion request is still being finished.",
    description:
      "Curio Garden has saved the request and will keep working even if you close this page. You do not need to submit it again.",
  },
} as const;

export const AccountDeletionResultPage = ({
  status,
}: AccountDeletionResultPageProps) => {
  const content = resultContent[status];

  return (
    <div className="container mx-auto px-4 pb-20 pt-12 sm:pt-16">
      <div className="mx-auto max-w-2xl">
        <section
          aria-labelledby="account-deletion-result-heading"
          className={`garden-bed overflow-hidden ${
            status === "deleted" ? "border-accent-border" : "border-serious/35"
          }`}
        >
          <div
            className={`border-b p-6 sm:p-8 ${
              status === "deleted"
                ? "border-accent-border bg-accent-bg"
                : "border-serious/25 bg-surface-2"
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-[0.14em] ${
                status === "deleted" ? "text-accent" : "text-serious"
              }`}
            >
              {content.eyebrow}
            </p>
            <h1
              id="account-deletion-result-heading"
              className="mt-3 font-display text-[2rem] font-bold leading-[1.12] text-foreground sm:text-[2.35rem]"
            >
              {content.title}
            </h1>
            <p className="mt-4 text-[1.02rem] leading-[1.75] text-foreground-2">
              {content.description}
            </p>
          </div>

          <div className="p-6 sm:p-8">
            <h2 className="font-display text-xl font-semibold text-foreground">
              What remains on devices and in the shared garden
            </h2>
            <p className="mt-3 text-sm leading-[1.8] text-foreground-2">
              Browser-only history and preferences are not part of the
              server-side account, so they remain until you clear them in your
              browser. Files already downloaded to a phone, computer, or podcast
              app cannot be recalled.
            </p>
            <p className="mt-4 text-sm leading-[1.8] text-foreground-2">
              Anonymous feedback, shared article and audio caches, and
              aggregated analytics also remain because Curio Garden does not
              treat them as account-owned data.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/"
                className="btn-primary min-h-11 px-6 py-3 text-sm no-underline"
              >
                Return to Curio Garden
              </Link>
              <Link
                href="/feedback"
                className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-accent underline underline-offset-4"
              >
                Share feedback
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
