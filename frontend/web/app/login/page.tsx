import { LoginForm } from "../../components/auth/login-form";
import { APP_TITLE } from "../../lib/shell";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>{APP_TITLE}</h1>
        <p className="login-card__copy">Sign in to start a scouting run.</p>
        <LoginForm />
      </section>
    </main>
  );
}
