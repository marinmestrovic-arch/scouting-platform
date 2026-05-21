import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "../../components/auth/login-form";
import { APP_TITLE } from "../../lib/shell";

export default function LoginPage() {
  return (
    <main className="login-page login-page--with-brand">
      <aside aria-hidden="true" className="login-brand-panel">
        <div className="login-brand-panel__logo">
          <Image alt="Arch" height={28} priority src="/arch-logo.svg" width={104} />
        </div>
        <div>
          <h2 className="login-brand-panel__headline">
            The campaign-manager workspace for <em>creator scouting at scale.</em>
          </h2>
          <p className="login-brand-panel__sub">
            Plan briefs, run discovery, qualify creators and ship clean lists to HubSpot — all from one
            calm, internal cockpit.
          </p>
        </div>
        <div className="login-brand-panel__footer">
          <div className="login-brand-panel__feature">
            <span className="login-brand-panel__feature-bullet">→</span>
            <span>Run focused scouting against a 200k+ creator catalog with structured briefs.</span>
          </div>
          <div className="login-brand-panel__feature">
            <span className="login-brand-panel__feature-bullet">→</span>
            <span>Track every run, manager and client in one shared dashboard.</span>
          </div>
          <div className="login-brand-panel__feature">
            <span className="login-brand-panel__feature-bullet">→</span>
            <span>Export to CSV or push directly to HubSpot with full coverage.</span>
          </div>
        </div>
      </aside>

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
