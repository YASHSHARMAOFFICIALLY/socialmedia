import { cn } from "@/lib/utils";
import { Tape } from "./craft";

// A scheduled post as it will look on the network, cut out and taped into the scrapbook.
// Account names are honest placeholders ("Your brand"), not invented people.

export type PostPreviewProps = {
  network: string;
  account: string;
  text: string;
  when: string;
  image?: boolean;
  className?: string;
};

export function PostPreview({ network, account, text, when, image = false, className }: PostPreviewProps) {
  return (
    <article className={cn("relative rounded-2xl bg-white p-4 text-left shadow-float", className)}>
      <Tape className="-top-3 left-1/2 -translate-x-1/2 rotate-2" />
      <header className="flex items-center gap-2">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-ink font-heading text-sm text-canvas">
          Y
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{account}</span>
        <span className="text-xs font-medium text-graphite">{network}</span>
      </header>
      {image && <Scene className="mt-3 aspect-[4/3] w-full rounded-lg" />}
      <p className="mt-3 text-sm text-ink">{text}</p>
      <p className="mt-3 inline-flex rounded-full bg-linen px-3 py-1 text-xs font-medium text-ink">Scheduled {when}</p>
    </article>
  );
}

// Illustrated stand-in for the post's photo, drawn in the page palette.
function Scene({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="160" height="120" className="fill-periwinkle" />
      <circle cx="112" cy="40" r="16" className="fill-marigold" />
      <path d="M0 86 C 30 64, 58 66, 84 84 C 104 98, 134 90, 160 74 V120 H0 Z" className="fill-mint" />
      <path d="M0 100 C 40 88, 80 104, 160 94 V120 H0 Z" className="fill-moss" />
      <path d="M44 52 l22 -8 l-6 8 l6 8 z" className="fill-white" />
    </svg>
  );
}
