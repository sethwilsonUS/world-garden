import { Show, SignInButton, UserButton } from "@clerk/nextjs";

const desktopButtonClass =
  "btn-secondary min-h-11 cursor-pointer px-3 py-2 text-sm no-underline";

const mobileButtonClass =
  "btn-secondary min-h-11 w-full cursor-pointer justify-center px-4 py-3 text-sm no-underline";

const AccountDataIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={16}
    height={16}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8L20 8.5v10A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8M8 17h5" />
  </svg>
);

export const AuthNavControls = ({ mobile = false }: { mobile?: boolean }) => {
  const wrapperClass = mobile
    ? "flex flex-col gap-2"
    : "flex items-center gap-2 pl-1";

  const buttonClass = mobile ? mobileButtonClass : desktopButtonClass;
  const signedInClass = mobile ? "px-3 pt-2" : "pl-1";

  return (
    <div className={wrapperClass}>
      <Show when="signed-out">
        <SignInButton>
          <button className={buttonClass}>Sign in</button>
        </SignInButton>
      </Show>

      <Show when="signed-in">
        <div className={signedInClass}>
          <span className="sr-only">Open account menu</span>
          <UserButton>
            <UserButton.MenuItems>
              <UserButton.Link
                label="Account & data"
                labelIcon={<AccountDataIcon />}
                href="/account"
              />
            </UserButton.MenuItems>
          </UserButton>
        </div>
      </Show>
    </div>
  );
};
