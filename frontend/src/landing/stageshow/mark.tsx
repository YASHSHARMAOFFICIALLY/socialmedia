import { networkLogos } from "../components/network-logos";

// A network's logo at text size, in its brand colour (Instagram gets its pink; the gradient needs a <defs>).
export function Mark({ name, className = "ad-mark" }: { name: string; className?: string }) {
  const l = networkLogos[name];
  if (!l) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path d={l.path} fill={name === "Instagram" ? "#d6249f" : l.color} />
    </svg>
  );
}
