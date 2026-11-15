import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Scrapbook pieces from frontend-1/design.md: tape, sticky notes, lined index cards and handwritten
// notes with drawn arrows. They give the page its handmade identity. Decoration is aria-hidden;
// anything that carries meaning (note text) stays readable.

export function Tape({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute z-10 h-6 w-20 bg-white/55 shadow-sm backdrop-blur-[1px]", className)}
      style={{ clipPath: "polygon(3% 0, 97% 6%, 100% 50%, 96% 100%, 4% 94%, 0 50%)" }}
    />
  );
}

const noteTones = {
  marigold: "bg-marigold",
  mint: "bg-mint",
  periwinkle: "bg-periwinkle",
} as const;

export function StickyNote({
  tone = "marigold",
  className,
  children,
}: {
  tone?: keyof typeof noteTones;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative p-4 font-hand text-2xl leading-tight text-ink shadow-lift", noteTones[tone], className)}>
      {children}
    </div>
  );
}

// White card with ruled lines, like an index card pinned into the scrapbook.
export function IndexCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn("relative rounded-sm bg-white px-5 pt-3 pb-4 shadow-lift", className)}
      style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 31px, rgb(184 202 245 / 0.7) 31px 32px)" }}
    >
      {children}
    </div>
  );
}

// A loose hand-drawn arrow. The path draws itself once (see .scribble in landing.css).
const arrows = {
  down: "M10 4 C 30 20, 34 46, 22 70 M12 58 L22 72 L32 60",
  right: "M4 30 C 26 8, 54 10, 74 28 M60 20 L76 30 L62 40",
  left: "M76 30 C 54 8, 26 10, 6 28 M20 20 L4 30 L18 40",
} as const;

export function HandNote({
  children,
  arrow,
  className,
}: {
  children?: ReactNode;
  arrow?: keyof typeof arrows;
  className?: string;
}) {
  return (
    <div className={cn("pointer-events-none flex items-center gap-1 font-hand text-2xl text-graphite", className)}>
      {arrow === "left" && <Arrow d={arrows.left} />}
      {children && <span>{children}</span>}
      {arrow && arrow !== "left" && <Arrow d={arrows[arrow]} />}
    </div>
  );
}

function Arrow({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 80 80" className="size-14 shrink-0 fill-none stroke-graphite">
      <path className="scribble" d={d} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}

// Papaya hand-drawn ring: the page's one accent, used to mark the step that matters most.
export function CircleMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 200 100" preserveAspectRatio="none" className={cn("pointer-events-none absolute fill-none stroke-papaya", className)}>
      <path
        className="scribble"
        d="M30 20 C 80 2, 170 8, 192 42 C 206 70, 150 96, 92 94 C 34 92, 2 72, 8 46 C 12 28, 40 14, 70 10"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={1}
      />
    </svg>
  );
}
