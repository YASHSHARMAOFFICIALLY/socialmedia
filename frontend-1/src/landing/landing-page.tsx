import "./landing.css";
import { SiteHeader } from "./sections/site-header";
import { Hero } from "./sections/hero";
import { Assistants } from "./sections/assistants";
import { Features } from "./sections/features";
import { Faq } from "./sections/faq";
import { SiteFooter } from "./sections/site-footer";

// Light only on purpose: the warm paper canvas is the brand (frontend-1/design.md), not a theme.
export function LandingPage() {
  return (
    <div className="landing relative flex-1 bg-canvas font-sans text-ink scheme-light">
      <SiteHeader />
      <main>
        <Hero />
        <Assistants />
        <Features />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
