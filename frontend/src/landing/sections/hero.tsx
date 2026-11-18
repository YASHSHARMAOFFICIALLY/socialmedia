import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { hero } from "../content";
import { gutter } from "../components/layout";
import { NetworkColumns, NetworkRow } from "../components/network-row";
import { SkyLife } from "../components/sky-life";
import { ComposerDemoSlot } from "../stageshow/composer-demo-slot";
import hills from "../../../public/hero-hills.jpg";

// TapMac/Ribbon-style hero: the hills photo (imageory.in, clouds and wildflowers) settling in
// slowly, with a soft oval of clear sky in the photo's own blue behind the text only, so white text
// reads (measured, see design.md) while the clouds still frame it.
// A two-voice headline whose words rise in
// one by one, and the eleven networks as app icons: two columns either side of the text on wide
// screens, a row under the button on smaller ones.
// The composer hangs over the bottom edge so the product is visible above the fold: an animated
// stageshow demo (stageshow/composer-demo.tsx) that shows one post going out to three networks.
//
// Storyboard (ms after load):
//    0  photo starts settling (scale 1.06 to 1 over 2.4s)
//    0  headline words rise, one every 35ms
//  400  body copy rises
//  520  button rises
//  640  composer screen rises
//    0  birds glide past every 46s (sky-life.tsx)
//  900  network icons land, one every 55ms (network-row.tsx)
// Words start at once, 35ms apart: the last headline word is the LCP element, so this delay is LCP time.
const TIMING = { firstWord: 0, wordStagger: 35, body: 400, cta: 520, screen: 640 } as const;

export function Hero() {
  let word = 0;
  return (
    <section id="top" aria-labelledby="hero-title" className="relative overflow-x-clip">
      <div className="relative overflow-hidden bg-[#1d66cd]">
        <Image
          src={hills}
          alt=""
          priority
          sizes="100vw"
          className="hero-photo absolute inset-0 size-full object-cover object-bottom"
        />
        {/* Clear blue in the photo's own sky colour behind the text only; the clouds frame it. */}
        {/* Depth of field: the photo goes soft behind the text (distribution.studio style), sharp at the
            sides and over the hills. A faint tint in the photo's own sky blue sits on top if needed. */}
        <div aria-hidden className="hero-focus absolute inset-0" />
        <div aria-hidden className="hero-clearing absolute inset-0" />
        <div aria-hidden className="hero-top-fade absolute inset-x-0 top-0 h-28" />
        <SkyLife />
        <NetworkColumns />

        <div className={`${gutter} relative pt-32 pb-72 text-center sm:pt-32 sm:pb-[26rem]`}>
          <h1 id="hero-title" className="text-white">
            {hero.lines.map((line, i) => (
              <span
                key={line}
                className={
                  i === 0
                    ? "block font-sans text-[clamp(1.8rem,1rem+4vw,4.5rem)] leading-[1.02] font-bold tracking-[-0.04em]"
                    : "block font-heading text-[clamp(2.3rem,1.2rem+5.8vw,6rem)] leading-[1] italic"
                }
              >
                {line.split(" ").map((w, j) => (
                  <Fragment key={w}>
                    {j > 0 && " "}
                    <span className="word-in inline-block" style={{ animationDelay: `${TIMING.firstWord + word++ * TIMING.wordStagger}ms` }}>
                      {w}
                    </span>
                  </Fragment>
                ))}
              </span>
            ))}
          </h1>
          {/* 24px from sm up counts as large text for WCAG (3:1), so the sky behind it needs less blue. */}
          <p className="hero-in mx-auto mt-6 max-w-3xl text-xl leading-snug font-medium text-balance text-white sm:text-2xl" style={{ animationDelay: `${TIMING.body}ms` }}>
            {hero.body}
          </p>
          <div className="hero-in mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: `${TIMING.cta}ms` }}>
            {/* The one solid action: sign-up is live. "See what it does" stays as the second, lighter choice. */}
            <Link
              href="/signup"
              className="inline-flex min-h-13 items-center rounded-full bg-ink px-7 text-base font-semibold text-white shadow-[0_12px_32px_rgb(4_40_90/0.35)] transition-transform duration-200 ease-out hover:-translate-y-0.5"
            >
              {hero.signup}
            </Link>
            <a
              href={hero.primary.href}
              className="group inline-flex min-h-13 items-center gap-3 rounded-full bg-linear-to-b from-white to-[#eef4fb] py-1.5 pr-7 pl-1.5 text-base font-semibold text-ink shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgb(255_255_255/0.6),0_12px_32px_rgb(4_40_90/0.35)] transition-transform duration-200 ease-out hover:-translate-y-0.5"
            >
              <span aria-hidden className="grid size-10 place-items-center rounded-full bg-[#0a6fb6] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition-transform duration-200 ease-out group-hover:scale-105">
                <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v10m0 0 4-4m-4 4L4 9" />
                </svg>
              </span>
              {hero.primary.label}
            </a>
          </div>
          <NetworkRow />
        </div>
      </div>

      <div className={`${gutter} hero-in relative z-10 -mt-32 sm:-mt-40`} style={{ animationDelay: `${TIMING.screen}ms` }}>
        <ComposerDemoSlot />
      </div>
    </section>
  );
}
