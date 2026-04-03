"use client";

import { useEffect, useState } from "react";

function getIsDocumentVisible(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return document.visibilityState === "visible";
}

export function useDocumentVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => getIsDocumentVisible());

  useEffect(() => {
    function handleVisibilityChange(): void {
      setIsVisible(getIsDocumentVisible());
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
