import Link from "next/link";
import { APP_TITLE } from "../lib/shell";

export default function HomePage() {
  return (
    <main className="bootstrap-home">
      <h1>{APP_TITLE}</h1>
      <p>The scouting workspace is available behind the authenticated app shell.</p>
      <p>
        Continue with <Link href="/login">the Auth.js sign-in flow</Link>.
      </p>
      <p>
        Or open <Link href="/dashboard">the new scouting dashboard</Link>.
      </p>
    </main>
  );
}
