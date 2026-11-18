import "./landing.css";
import { SiteHeader } from "./sections/site-header";
import { Hero } from "./sections/hero";
import { Demo } from "./sections/demo";
import { Product } from "./sections/product";
import { Assistants } from "./sections/assistants";
import { More } from "./sections/more";
import { Pricing } from "./sections/pricing";
import { Faq } from "./sections/faq";
import { Closing } from "./sections/closing";
import { SiteFooter } from "./sections/site-footer";

// Hills photo hero, then a light page (design.md). The assistant is the differentiator, so it comes straight after
// the one-line "What is it?": hero, what it is, try it, product screens, the rest, FAQ, a closing ask.
export function LandingPage() {
  return (
    <div className="landing relative flex-1 bg-paper font-sans text-ink scheme-light">
      <SiteHeader />
      <main>
        <Hero />
        <Demo />
        <Assistants />
        <Product />
        <More />
        <Pricing />
        <Faq />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
