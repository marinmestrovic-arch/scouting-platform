import Link from "next/link";
import { APP_TITLE } from "../lib/shell";

export default function HomePage() {
  return (
    <main className="bootstrap-home">
      <h1>{APP_TITLE}</h1>
      <p>Week 0 scaffold is ready.</p>
      <p>
        Continue with the <Link href="/login">Auth.js sign-in scaffold</Link>.
      </p>
      <p>
        Or open <Link href="/catalog">the authenticated shell placeholder</Link>.
      </p>
    </main>
  );
}
