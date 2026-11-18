"use client";

import dynamic from "next/dynamic";

// Recharts is the heaviest library on the home page, and this chart is far below the fold and
// decorative (the bento is aria-hidden). It loads after the page is interactive; the placeholder
// keeps the same height so nothing shifts when it arrives.
export const CampaignChart = dynamic(
  () => import("./campaign-chart").then((m) => m.CampaignChart),
  { ssr: false, loading: () => <div className="h-44 w-full" /> },
);
