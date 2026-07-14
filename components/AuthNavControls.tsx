import { Show, SignInButton, UserButton } from "@clerk/nextjs";

const desktopButtonClass =
  "btn-secondary min-h-9 cursor-pointer px-3 py-2 text-sm no-underline";

const mobileButtonClass =
  "btn-secondary min-h-11 w-full cursor-pointer justify-center px-4 py-3 text-sm no-underline";

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
          <UserButton />
        </div>
      </Show>
    </div>
  );
};
