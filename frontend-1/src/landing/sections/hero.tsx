import type { CSSProperties } from "react";
import { hero, heroCollage, platforms } from "../content";
import { gutter } from "../components/section";
import { HandNote, StickyNote } from "../components/craft";
import { PostPreview } from "../components/post-preview";
import { TornEdge } from "../components/torn-edge";

// Entrance delays in ms. The full storyboard is at the top of landing.css.
const TIMING = { title: 0, copy: 120, collage: 300, stagger: 90 } as const;
const delay = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;
const piece = (i: number) => delay(TIMING.collage + i * TIMING.stagger);

export function Hero() {
  const { posts } = heroCollage;
  return (
    <section id="top" aria-labelledby="hero-title" className="relative overflow-x-clip bg-linear-to-b from-sky to-mist">
      <div className={`${gutter} grid items-center gap-16 pt-32 pb-24 sm:pt-40 sm:pb-32 lg:grid-cols-[1fr_1.1fr]`}>
        <div>
          <h1 id="hero-title" className="rise font-heading text-display text-ink" style={delay(TIMING.title)}>
            {hero.title}
          </h1>
          <p className="rise mt-6 max-w-xl text-lg text-graphite sm:text-xl" style={delay(TIMING.copy)}>
            {hero.body}
          </p>
          <div className="rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-3" style={delay(TIMING.copy)}>
            <a
              href={hero.primary.href}
              className="inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-base font-medium text-canvas transition-shadow hover:shadow-lift"
            >
              {hero.primary.label}
            </a>
            <span className="font-hand text-2xl text-graphite">{hero.signupNote}</span>
          </div>
          <p className="rise mt-10 max-w-xl text-sm text-graphite" style={delay(TIMING.copy)}>
            <span className="font-medium text-ink">Posts to </span>
            {platforms.join(", ")}.
          </p>
        </div>

        {/* Collage: one launch post cut out three times. Pieces are positioned in % of the board
            so it scales from phone to desktop without reflowing. */}
        <div className="relative mx-auto aspect-[4/5] w-full max-w-xl sm:aspect-[6/5]">
          <HandNote arrow="down" className="absolute -top-12 left-[34%] z-40 hidden sm:flex">
            {heroCollage.note}
          </HandNote>
          <div className="drop absolute top-[2%] left-0 z-10 w-[64%] sm:w-[54%]" style={piece(0)}>
            <PostPreview {...posts.linkedin} className="lift -rotate-3" />
          </div>
          <div className="drop absolute top-0 right-0 z-20 w-[58%] sm:w-[46%]" style={piece(1)}>
            <PostPreview {...posts.instagram} className="lift rotate-2" />
          </div>
          <div className="drop absolute bottom-[4%] left-[6%] z-30 w-[66%] sm:left-[12%] sm:w-[54%]" style={piece(2)}>
            <PostPreview {...posts.x} className="lift rotate-1" />
          </div>
          <div className="drop absolute right-[2%] bottom-0 z-40 w-[40%] sm:w-[32%]" style={piece(3)}>
            <StickyNote className="lift rotate-3">
              <span className="block text-3xl">{heroCollage.sticky[0]}</span>
              {heroCollage.sticky[1]}
            </StickyNote>
          </div>
        </div>
      </div>
      <TornEdge />
    </section>
  );
}
