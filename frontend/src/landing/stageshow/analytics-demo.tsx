"use client";

import { Count, Stage, Tooltip, Window, type Act } from "./kit";
import { Mark } from "./mark";
import "./analytics-demo.css";

// The Measure section: per-network figures, then the totals. Beats: the Likes total rolls up from the
// three rows, then Comments; Views gets no total, a pill lands there instead and the cursor rests on it
// so the reason shows. Plays once; the poster is the end.
//
// The figures are an example account, not real data (the window says so). Real strings: the three
// networks, nine figures, the two column totals, the pill and its reason.

type S = { likes: number; comments: number; pill: boolean; tip: boolean };

const ROWS = [
  { net: "Instagram", likes: 1240, comments: 86, views: 18400 },
  { net: "LinkedIn", likes: 610, comments: 142, views: 9300 },
  { net: "X", likes: 380, comments: 57, views: 41200 },
];
const SUM = { likes: ROWS.reduce((n, r) => n + r.likes, 0), comments: ROWS.reduce((n, r) => n + r.comments, 0) };

const initial: S = { likes: 0, comments: 0, pill: false, tip: false };
const poster: S = { likes: SUM.likes, comments: SUM.comments, pill: true, tip: true };

async function script(a: Act<S>) {
  await a.wait(900);
  await a.set({ likes: SUM.likes });
  await a.wait(700);
  await a.set({ comments: SUM.comments });
  await a.wait(800);
  await a.set({ pill: true });
  await a.wait(500);
  await a.move("pill");
  await a.wait(250);
  await a.set({ tip: true });
  await a.wait(3200);
}

const n = (v: number) => v.toLocaleString("en-US");

export function AnalyticsDemo() {
  return (
    <Stage<S>
      width={720}
      height={360}
      compact={{ below: 640, width: 358, height: 380 }}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      cursor={{ at: { wide: { x: 640, y: 330 }, compact: { x: 300, y: 350 } } }}
      className="ad2"
    >
      {(s, rect) => (
        <>
          <Window title="Analytics" className="ad2-win">
            <div className="ad2-table" role="presentation">
              <div className="ad2-row ad2-row--head">
                <span>Network</span>
                <span>Likes</span>
                <span>Comments</span>
                <span>Views</span>
              </div>
              {ROWS.map((r) => (
                <div key={r.net} className="ad2-row">
                  <span className="ad2-net">
                    <Mark name={r.net} className="ad2-mark" />
                    {r.net}
                  </span>
                  <span>{n(r.likes)}</span>
                  <span>{n(r.comments)}</span>
                  <span>{n(r.views)}</span>
                </div>
              ))}
              <div className="ad2-row ad2-row--total">
                <span>All networks</span>
                <span><Count value={s.likes} /></span>
                <span><Count value={s.comments} /></span>
                <span>
                  <span className="ad2-pill" data-target="pill" data-on={s.pill || undefined}>Not added up</span>
                </span>
              </div>
            </div>
            <p className="ad2-foot">Example account: example figures, not real data.</p>
          </Window>
          <Tooltip show={s.tip} at={rect("pill")} side="above" className="ad2-tip">
            Each network counts views differently
          </Tooltip>
          <span data-target="rest" style={{ position: "absolute", right: 40, bottom: 20 }} />
        </>
      )}
    </Stage>
  );
}
