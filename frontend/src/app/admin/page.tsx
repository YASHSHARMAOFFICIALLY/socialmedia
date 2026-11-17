import type { Metadata } from "next";
import { OpsDashboard } from "@/admin/ops-dashboard";

// Owner-only console. Not linked anywhere, not in the sitemap, and never indexed. The page itself is
// public HTML; every number behind it needs the ops token (checked by the API).
export const metadata: Metadata = { title: "Owner console | PostRally", robots: { index: false, follow: false } };

export default function Page() {
  return <OpsDashboard />;
}
