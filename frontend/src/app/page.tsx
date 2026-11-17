import type { Metadata } from "next";
import { LandingPage } from "@/landing/landing-page";
import { footer, productName } from "@/landing/content";
import { mdAlt } from "@/lib/ai-pages";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/", types: mdAlt("/") } };

// Organization + WebSite structured data for search and AI engines. Static, so safe to inline.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${siteUrl}/#org`, name: productName, url: siteUrl, description: footer.description },
    { "@type": "WebSite", "@id": `${siteUrl}/#site`, name: productName, url: siteUrl, publisher: { "@id": `${siteUrl}/#org` } },
  ],
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <LandingPage />
    </>
  );
}
