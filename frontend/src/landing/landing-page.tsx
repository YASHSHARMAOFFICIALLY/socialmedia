import "./landing.css";
import { SiteHeader } from "./sections/site-header";
import { Hero } from "./sections/hero";
import { Demo } from "./sections/demo";
import { Product } from "./sections/product";
import { Assistants } from "./sections/assistants";
import { More } from "./sections/more";
import { Faq } from "./sections/faq";
import { SiteFooter } from "./sections/site-footer";

// Hills photo hero, then a light page (design.md). Ribbon order: hero, "What is it?" demo, details, FAQ.
export function LandingPage() {
  return (
    <div className="landing relative flex-1 bg-paper font-sans text-ink scheme-light">
      <SiteHeader />
      <main>
        <Hero />
        <Demo />
        <Product />
        <Assistants />
        <More />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
