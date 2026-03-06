export function SignOutForm() {
  return (
    <form
      action={async () => {
        "use server";
        const { signOut } = await import("../../auth");
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button className="auth-shell__signout" type="submit">
        Sign out
      </button>
    </form>
  );
}
