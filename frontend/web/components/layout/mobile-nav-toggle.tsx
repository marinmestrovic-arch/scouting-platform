"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const SHELL_OPEN_CLASS = "auth-shell--mobile-nav-open";
const BODY_LOCK_CLASS = "body--mobile-nav-open";

export function MobileNavToggle() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const shell = document.querySelector(".auth-shell");
    shell?.classList.toggle(SHELL_OPEN_CLASS, open);
    document.body.classList.toggle(BODY_LOCK_CLASS, open);
    return () => {
      shell?.classList.remove(SHELL_OPEN_CLASS);
      document.body.classList.remove(BODY_LOCK_CLASS);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-controls="auth-shell-primary-nav"
        aria-expanded={open}
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        className="auth-shell__menu-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className="auth-shell__menu-bars">
          <span />
          <span />
          <span />
        </span>
      </button>
      <button
        type="button"
        aria-hidden={!open}
        aria-label="Close navigation menu"
        className="auth-shell__menu-backdrop"
        hidden={!open}
        onClick={() => setOpen(false)}
        tabIndex={open ? 0 : -1}
      />
    </>
  );
}
