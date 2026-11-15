import { cn } from "@/lib/utils";
import { networkLogos } from "./network-logos";
import { assistantLogos } from "./assistant-logos";

// One brand glyph (network or AI app) in its own colour. Instagram uses its pink, since the
// gradient only exists in the hero. Decorative: the name is always written next to it.
export const brandColor = (name: string) => (name === "Instagram" ? "#d6249f" : (networkLogos[name] ?? assistantLogos[name as keyof typeof assistantLogos])?.color);

export function BrandGlyph({ name, className }: { name: string; className?: string }) {
  const logo = networkLogos[name] ?? assistantLogos[name as keyof typeof assistantLogos];
  if (!logo) return null;
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("size-4 shrink-0", className)}>
      <path d={logo.path} fill={brandColor(name)} />
    </svg>
  );
}
