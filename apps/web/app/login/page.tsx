import Link from "next/link";
import { LoginForm } from "../../components/auth/login-form";
import { APP_TITLE } from "../../lib/shell";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <p className="login-card__eyebrow">Internal access</p>
        <h1>{APP_TITLE}</h1>
        <p className="login-card__copy">
          Sign in with your assigned work email and password to continue to the catalog.
        </p>
        <LoginForm />
        <p className="login-card__note">
          Contact an admin if your account is inactive or you need a password reset.
        </p>
        <p className="login-card__back">
          <Link href="/">Back to workspace overview</Link>
        </p>
      </section>
    </main>
  );
}
