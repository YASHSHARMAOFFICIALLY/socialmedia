import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A product screen in a window frame. The only element on the page with a shadow (design.md),
// because it should feel like a real app sitting above the page.
// The screen is a picture of the product: its contents are hidden from assistive tech and
// described once by `label` instead, and nothing inside is focusable.
export function Window({ title, label, className, children }: { title: string; label: string; className?: string; children: ReactNode }) {
  return (
    <figure className={cn("overflow-hidden rounded-2xl border border-line bg-surface shadow-window", className)}>
      <figcaption className="sr-only">{label}</figcaption>
      <div aria-hidden className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-line" />
          <span className="size-3 rounded-full bg-line" />
          <span className="size-3 rounded-full bg-line" />
        </span>
        <span className="flex-1 text-center text-[13px] font-medium text-muted">{title}</span>
        <span className="w-12" />
      </div>
      <div aria-hidden>{children}</div>
    </figure>
  );
}
