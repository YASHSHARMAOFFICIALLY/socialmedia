import type { Metadata } from "next";
import { LandingPage } from "@/landing/landing-page";
import { footer, productName } from "@/landing/content";
import { mdAlt } from "@/lib/ai-pages";
import { siteUrl } from "@/lib/site";
import { JsonLd } from "@/components/json-ld";

export const metadata: Metadata = { alternates: { canonical: "/", types: mdAlt("/") } };

// Organization + WebSite structured data for search and AI engines. Static, so safe to inline.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    // alternateName + disambiguatingDescription separate us from the unrelated "Postrally" treasure-hunt app and the Rauschenberg print.
    // ponytail: add sameAs (X, LinkedIn, Product Hunt) once those profiles exist, see TODO.local.md.
    { "@type": "Organization", "@id": `${siteUrl}/#org`, name: productName, alternateName: "Post Rally", url: siteUrl, description: footer.description, disambiguatingDescription: "A social media scheduling and publishing tool, not a treasure-hunt app." },
    { "@type": "SoftwareApplication", "@id": `${siteUrl}/#app`, name: productName, alternateName: "Post Rally", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: siteUrl, description: footer.description, publisher: { "@id": `${siteUrl}/#org` } },
    { "@type": "WebSite", "@id": `${siteUrl}/#site`, name: productName, url: siteUrl, publisher: { "@id": `${siteUrl}/#org` } },
  ],
};

export default function Home() {
  return (
    <>
      <JsonLd data={jsonLd} />
      <LandingPage />
    </>
  );
}
