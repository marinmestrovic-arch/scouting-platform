import { LoginForm } from "../../components/auth/login-form";
import { APP_TITLE } from "../../lib/shell";

export default function LoginPage() {
  return (
    <main className="login-page login-page--with-brand">
      <aside aria-hidden="true" className="login-brand-panel">
        <span className="login-brand-panel__wordmark">
          ARCH<em>.</em>
        </span>
        <div>
          <p className="login-brand-panel__headline">
            Creator scouting for games <em>&amp; apps.</em>
          </p>
          <p className="login-brand-panel__sub">
            Atlas is ARCH.&apos;s workspace for creator discovery, scouting runs, and
            campaign exports.
          </p>
        </div>
        <div className="login-brand-panel__footer">
          <span className="login-brand-panel__feature">
            <span className="login-brand-panel__feature-bullet" />
            Scouting runs
          </span>
          <span className="login-brand-panel__feature">
            <span className="login-brand-panel__feature-bullet" />
            Creator database
          </span>
          <span className="login-brand-panel__feature">
            <span className="login-brand-panel__feature-bullet" />
            Campaign exports
          </span>
        </div>
      </aside>
      <section className="login-card">
        <h1>{APP_TITLE}</h1>
        <p className="login-card__copy">Sign in to Atlas to start a scouting run.</p>
        <LoginForm />
      </section>
    </main>
  );
}
