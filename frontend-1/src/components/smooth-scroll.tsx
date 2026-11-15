"use client";

import { ReactLenis } from "lenis/react";
import { useSyncExternalStore } from "react";

const reducedMotion = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(reducedMotion);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Smooth scrolling for the whole page. Turned off when the OS asks for reduced motion.
// The server renders nothing, so Lenis only starts after hydration.
export function SmoothScroll() {
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(reducedMotion).matches,
    () => true,
  );
  if (reduced) return null;
  return <ReactLenis root options={{ anchors: true }} />;
}
