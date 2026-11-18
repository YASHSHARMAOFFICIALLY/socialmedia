"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

// Last resort: the root layout itself crashed, so no fonts, CSS or header. Inline styles only.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => reportError(error), [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#fff", color: "#111", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <main style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 32, margin: 0 }}>PostRally hit an error</h1>
          <p style={{ color: "#555", fontSize: 18, lineHeight: 1.5 }}>It&apos;s on our side, not yours. Nothing you scheduled is affected.</p>
          <button type="button" onClick={retry} style={{ minHeight: 48, padding: "0 24px", borderRadius: 999, border: 0, background: "#111", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
