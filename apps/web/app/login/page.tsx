import Link from "next/link";
import { LoginForm } from "../../components/auth/login-form";
import { APP_TITLE } from "../../lib/shell";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <p className="login-card__eyebrow">Week 0 Auth.js UI Scaffold</p>
        <h1>{APP_TITLE}</h1>
        <p className="login-card__copy">
          Sign in to continue. This scaffold uses demo credentials until Week 1 backend auth lands.
        </p>
        <LoginForm />
        <p className="login-card__note">
          Demo credentials: <code>demo@scouting.local</code> / <code>demo-password</code>
        </p>
        <p className="login-card__note">
          You can override them with <code>AUTH_DEMO_EMAIL</code> and{" "}
          <code>AUTH_DEMO_PASSWORD</code>.
        </p>
        <p className="login-card__note">
          Set <code>AUTH_DEMO_ROLE</code> to <code>admin</code> if you need to test admin navigation.
        </p>
        <p className="login-card__back">
          <Link href="/">Back to workspace overview</Link>
        </p>
      </section>
    </main>
  );
}
