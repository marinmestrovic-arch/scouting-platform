import React from "react";

export function SignOutForm() {
  return (
    <form
      action={async () => {
        "use server";
        const { signOut } = await import("../../auth");
        await signOut({ redirectTo: "/login" });
      }}
      suppressHydrationWarning
    >
      <button className="auth-shell__signout" suppressHydrationWarning type="submit">
        Sign out
      </button>
    </form>
  );
}
