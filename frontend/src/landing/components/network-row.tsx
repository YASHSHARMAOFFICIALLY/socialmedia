import type { CSSProperties } from "react";
import { platforms } from "../content";
import { networkLogos } from "./network-logos";

// The eleven networks as white app-icon tiles (Sheltered style): "lands everywhere", shown.
// From xl up they are scattered left and right of the headline as named tags that fly out of the
// composer screen; below xl, where the text needs the width, they are one row under
// the button that wraps to 6 + 5. Only one layout is displayed at a time, so screen readers hear
// "Posts to" and the eleven names once. Animation: landing.css `.network-tile`.
//
// Storyboard (ms after load): first tile at 900, then one every 55ms, last settles ~1900.
const TIMING = { first: 900, stagger: 55 } as const;

const tileClass =
  "network-tile grid place-items-center bg-white/95 shadow-[0_4px_14px_rgb(4_40_90/0.16),inset_0_0_0_1px_rgb(0_0_0/0.04)] transition-transform duration-200 ease-out hover:-translate-y-0.5";

function Tile({ name, index, from }: { name: string; index: number; from: string }) {
  return (
    <li
      title={name}
      className={`${tileClass} size-11 rounded-[13px] sm:size-16 sm:rounded-[18px]`}
      style={{ animationDelay: `${TIMING.first + index * TIMING.stagger}ms`, "--tile-from": from } as CSSProperties}
    >
      <svg viewBox="0 0 24 24" className="size-6 sm:size-8" role="img" aria-label={name}>
        <path d={networkLogos[name].path} fill={networkLogos[name].color} />
      </svg>
    </li>
  );
}

function InstagramGradient() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <linearGradient id="ig-gradient" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset="0.35" stopColor="#FA7E1E" />
          <stop offset="0.6" stopColor="#D62976" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Below xl: one row under the button.
export function NetworkRow() {
  return (
    <ul role="list" aria-label="Posts to" className="mx-auto mt-12 flex max-w-[20rem] flex-wrap justify-center gap-2 sm:max-w-none sm:gap-3 xl:hidden">
      {platforms.map((name, i) => (
        <Tile key={name} name={name} index={i} from="0 18px" />
      ))}
    </ul>
  );
}

// From xl up: the first design, tags scattered left and right in a zigzag either side of the text,
// each a brand-colour app icon with its name. They fly out of the composer screen (bottom centre)
// and land in their spot. Spots are % of the hero image area, clear of the headline and body copy.
// Ten tags, five each side, so the composition is balanced. Telegram is the eleventh network: it is
// still in the list for screen readers (visually hidden) and in the row on smaller screens.
const spots = [
  [8, 12], [83, 10], [2, 23], [87, 22], [9, 35], [81, 34],
  [2, 47], [87, 46], [10, 59], [80, 58],
] as const;

function tagIcon(name: string) {
  if (name === "Instagram") return { bg: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285aeb 90%)", fg: "#fff" };
  if (name === "YouTube") return { bg: "#fff", fg: "#FF0000" };
  return { bg: networkLogos[name].color, fg: "#fff" };
}

export function NetworkColumns() {
  return (
    <>
      <InstagramGradient />
      <ul role="list" aria-label="Posts to" className="pointer-events-none absolute inset-x-0 top-0 hidden h-[56rem] [container-type:size] xl:block">
        {platforms.map((name, i) => {
          if (i >= spots.length) return <li key={name} className="sr-only">{name}</li>;
          const [x, y] = spots[i];
          const icon = tagIcon(name);
          return (
            <li
              key={name}
              className="network-tile absolute inline-flex items-center gap-2.5 rounded-[18px] bg-white py-1.5 pr-4 pl-1.5 text-[15px] font-semibold text-ink shadow-[0_10px_28px_rgb(8_40_110/0.22)]"
              style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${TIMING.first + i * TIMING.stagger}ms`, "--tile-from": `${50 - x}cqw ${100 - y}cqh` } as CSSProperties}
            >
              <span
                className="grid size-10 place-items-center rounded-[12px] shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_0_0_1px_rgb(0_0_0/0.08)]"
                style={{ background: icon.bg }}
              >
                <svg viewBox="0 0 24 24" className="size-[22px]" role="img" aria-label={name}>
                  <path d={networkLogos[name].path} fill={icon.fg} />
                </svg>
              </span>
              <span aria-hidden>{name}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
