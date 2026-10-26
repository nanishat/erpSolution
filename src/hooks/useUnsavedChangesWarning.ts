"use client";

import { useCallback, useEffect, useRef } from "react";

export function useUnsavedChangesWarning(isDirty: boolean) {
  const submittedRef = useRef(false);

  const markSubmitted = useCallback(() => {
    submittedRef.current = true;
  }, []);

  const resetSubmitted = useCallback(() => {
    submittedRef.current = false;
  }, []);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const handleClick = (event: MouseEvent) => {
      if (submittedRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (window.confirm("You have unsaved changes. Leave this page?")) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isDirty]);

  return { markSubmitted, resetSubmitted };
}
