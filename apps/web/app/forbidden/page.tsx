import Link from "next/link";
import { APP_TITLE } from "../../lib/shell";

export default function ForbiddenPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <p className="login-card__eyebrow">Access restricted</p>
        <h1>{APP_TITLE}</h1>
        <p className="login-card__copy">
          You do not have permission to open this page. Ask an admin if you need elevated access.
        </p>
        <p className="login-card__back">
          <Link href="/catalog">Back to catalog</Link>
        </p>
        <p className="login-card__back">
          <Link href="/login">Sign in with a different account</Link>
        </p>
      </section>
    </main>
  );
}
