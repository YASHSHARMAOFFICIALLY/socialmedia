import { cn } from "@/lib/utils";

// Torn pastel paper laid behind a visual: the scrapbook motif from frontend-1/design.md.
// Purely decorative, so it is hidden from assistive tech and never holds text.
const tornEdge =
  "polygon(2% 4%, 18% 0%, 35% 3%, 52% 1%, 70% 4%, 88% 0%, 100% 3%, 98% 22%, 100% 45%, 97% 68%, 100% 90%, 96% 100%, 78% 97%, 60% 100%, 41% 96%, 22% 100%, 4% 97%, 0% 78%, 3% 55%, 0% 33%, 3% 15%)";

const tones = {
  mint: "bg-mint",
  marigold: "bg-marigold",
  periwinkle: "bg-periwinkle",
  sky: "bg-sky",
} as const;

export type ScrapTone = keyof typeof tones;

export function PaperScrap({ tone, className }: { tone: ScrapTone; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute", tones[tone], className)}
      style={{ clipPath: tornEdge }}
    />
  );
}
