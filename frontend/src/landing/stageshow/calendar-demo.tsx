"use client";

import { Stage, States, Window, cellOf, type Act, type Point } from "./kit";
import { Mark } from "./mark";
import "./calendar-demo.css";

// The Plan section's calendar: a post is dragged onto 10:00 on Friday, where another X post already
// sits, and PostRally warns before it lets you keep it; one row down it is fine. Beats: pick up the
// X thread, drop it on the launch thread (the note turns amber and names the clash), a pause to read,
// drag it to 10:30 (the note turns green and says when it goes out). Plays once; the poster is the end.
//
// Real strings: the three post titles on the grid, the two notes, the week and the days.

type Cell = { col: number; row: number };
type S = { cell: Cell; lifted: boolean; at: Point | null; target: Cell | null };

const DAYS = ["Wed 18", "Thu 19", "Fri 20"];
const TIMES = ["10:00", "10:30", "11:00", "11:30"];
const ROW_H = 60;
const FIXED = [
  { col: 0, row: 1, net: "LinkedIn", label: "Hiring post" },
  { col: 1, row: 2, net: "Instagram", label: "Weekly tips" },
  { col: 2, row: 0, net: "X", label: "Launch thread" },
];
const START: Cell = { col: 1, row: 0 };
const CLASH: Cell = { col: 2, row: 0 };
const END: Cell = { col: 2, row: 1 };

const initial: S = { cell: START, lifted: false, at: null, target: null };
const poster: S = { cell: END, lifted: false, at: null, target: null };

const colW = (layout: string) => (layout === "compact" ? 94 : 200);
const same = (a: Cell, b: Cell) => a.col === b.col && a.row === b.row;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

async function carry(a: Act<S>, from: Cell, to: Cell) {
  const W = colW(a.layout);
  const grid = a.rect("grid", { layout: true });
  const box = (c: Cell) => ({ x: grid.x + c.col * W + 3, y: grid.y + c.row * ROW_H + 3 });
  const src = box(from);
  const dst = box(to);
  const grab = { x: src.x + (W - 6) * 0.7, y: src.y + (ROW_H - 6) / 2 };
  await a.move(grab);
  await a.wait(150);
  let prev = from;
  await a.drag(
    { x: dst.x + (grab.x - src.x), y: dst.y + (grab.y - src.y) },
    (p) => {
      const at = { x: p.x - (grab.x - src.x), y: p.y - (grab.y - src.y) };
      prev = {
        col: clamp(cellOf(at.x + (W - 6) / 2 - grid.x, W, prev.col), 0, DAYS.length - 1),
        row: clamp(cellOf(at.y + ROW_H / 2 - grid.y, ROW_H, prev.row), 0, TIMES.length - 1),
      };
      a.put({ lifted: true, at: { x: at.x - grid.x, y: at.y - grid.y }, target: prev });
    },
    { duration: 1100 },
  );
  await a.set({ lifted: false, at: null, target: null, cell: prev });
}

async function script(a: Act<S>) {
  await a.wait(800);
  await carry(a, START, CLASH);
  await a.move("rest");
  await a.wait(1900);
  await carry(a, CLASH, END);
  await a.move("rest");
  await a.wait(2400);
}

export function CalendarDemo() {
  return (
    <Stage<S>
      width={720}
      height={400}
      compact={{ below: 640, width: 358, height: 400 }}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      cursor={{ at: "rest" }}
      className="cd"
    >
      {(s, _rect, layout) => {
        const W = colW(layout);
        const home = { x: s.cell.col * W + 3, y: s.cell.row * ROW_H + 3 };
        const pos = s.at ?? home;
        const shown = s.target ?? s.cell;
        const rest = !s.lifted;
        const state = rest && same(s.cell, CLASH) ? "clash" : rest && same(s.cell, END) ? "ok" : "idle";
        return (
          <>
            <Window title="Calendar" className="cd-win" data-layout={layout}>
              <div className="cd-bar">
                <span className="cd-week">Week of 16 Nov</span>
                <span className="cd-note" data-state={state}>
                  <States
                    align="end"
                    value={state}
                    states={{ idle: "Europe/Berlin", clash: "Clashes with Launch thread", ok: "Fri 20 Nov, 10:30" }}
                  />
                </span>
              </div>
              <div className="cd-head" style={{ gridTemplateColumns: `var(--cd-hours) repeat(3, ${W}px)` }}>
                <span />
                {DAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="cd-body">
                <div className="cd-hours" aria-hidden>
                  {TIMES.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="cd-grid" data-target="grid" style={{ width: W * 3, backgroundSize: `${W}px ${ROW_H}px` }}>
                  {FIXED.map((e) => (
                    <div key={e.label} className="cd-card" style={{ translate: `${e.col * W + 3}px ${e.row * ROW_H + 3}px`, width: W - 6, height: ROW_H - 6 }}>
                      <Mark name={e.net} className="cd-mark" />
                      <span>{e.label}</span>
                    </div>
                  ))}
                  {s.target && !same(s.target, s.cell) && (
                    <div className="cd-slot" style={{ translate: `${shown.col * W + 3}px ${shown.row * ROW_H + 3}px`, width: W - 6, height: ROW_H - 6 }} />
                  )}
                  <div
                    className="cd-card cd-card--mine"
                    data-lifted={s.lifted || undefined}
                    data-state={state}
                    style={{ translate: `${pos.x}px ${pos.y}px`, width: W - 6, height: ROW_H - 6 }}
                  >
                    <Mark name="X" className="cd-mark" />
                    <span>Product thread</span>
                  </div>
                </div>
              </div>
            </Window>
            <span data-target="rest" style={{ position: "absolute", right: 36, bottom: 40 }} />
          </>
        );
      }}
    </Stage>
  );
}
