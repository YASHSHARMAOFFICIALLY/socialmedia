"use client";

import Clarity from "@microsoft/clarity";
import { useEffect } from "react";

const projectId = "zf6jqmmwh2";
let started = false;

// Microsoft Clarity session analytics. Mount-only: starts once in the browser (the flag keeps React
// StrictMode's double mount in dev from starting it twice) and renders nothing.
export function ClarityAnalytics() {
  useEffect(() => {
    if (started) return;
    started = true;
    Clarity.init(projectId);
  }, []);
  return null;
}
