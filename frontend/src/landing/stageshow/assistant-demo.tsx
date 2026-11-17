"use client";

import { Bar, Button, Code, Collapse, Field, Stage, States, Stream, Text, Window, type Act } from "./kit";
import { networkLogos } from "../components/network-logos";
import { apiLines, demos, type Demo } from "./assistant-demos";
import "./assistant-demo.css";

// One hero per /integrations/<slug>: the person asks, the assistant answers with a preview, and the
// confirm button turns into its own result. Beats: the question is typed and sent; Thinking; the answer
// streams in; the card opens under it; the cursor presses the button and it confirms on itself. Plays once
// when in view; the poster is the payoff. The REST API page plays the request instead of a chat.
//
// Real strings: the question, the answer, two card rows, the button's two labels, the placeholder.

type S = { draft: string; sent: boolean; phase: "idle" | "thinking" | "answer"; words: number; card: boolean; done: boolean; lines: number };

const initial: S = { draft: "", sent: false, phase: "idle", words: 0, card: false, done: false, lines: 0 };
const poster = (words: number, lines: number): S => ({ draft: "", sent: true, phase: "answer", words, card: true, done: true, lines });

function chatScript(d: Demo, words: number) {
  return async (a: Act<S>) => {
    await a.wait(700);
    await a.type("draft", d.q, { interval: 30 });
    await a.wait(350);
    a.put({ sent: true, draft: "" });
    await a.wait(450);
    a.put({ phase: "thinking" });
    await a.wait(1000);
    a.put({ phase: "answer" });
    for (let i = 1; i <= words; i++) { a.put({ words: i }); await a.wait(34); }
    await a.wait(300);
    a.put({ card: true });
    await a.wait(900);
    if (d.card.button) {
      await a.move("confirm");
      await a.wait(300);
      await a.click();
      await a.set({ done: true });
      await a.move("rest");
    }
    await a.wait(2400);
  };
}

async function apiScript(a: Act<S>) {
  await a.wait(700);
  for (let i = 1; i <= apiLines.length; i++) { a.put({ lines: i }); await a.wait(i === apiLines.length ? 700 : 260); }
  await a.wait(2600);
}

function Mark({ name }: { name: string }) {
  const l = networkLogos[name];
  if (!l) return null;
  return (
    <svg className="ad-mark" viewBox="0 0 24 24" aria-hidden>
      <path d={l.path} fill={name === "Instagram" ? "#d6249f" : l.color} />
    </svg>
  );
}

export function AssistantDemo({ slug, demo }: { slug?: string; demo?: Demo }) {
  const d = demo ?? (slug ? demos[slug] : undefined);
  if (!d) return null;

  if (d === "api") {
    return (
      <Stage width={760} height={300} compact={{ below: 640, width: 358, height: 300 }} initial={initial} poster={poster(0, apiLines.length)} script={apiScript} play="once" className="ad">
        {(s) => (
          <Window title="Request" className="ad-win ad-win--api">
            <div className="ad-code"><Code lines={apiLines} count={s.lines} numbers={false} /></div>
          </Window>
        )}
      </Stage>
    );
  }

  const words = d.a.split(" ").length;
  return (
    <Stage width={760} height={440} compact={{ below: 640, width: 358, height: 560 }} initial={initial} poster={poster(words, 0)} script={chatScript(d, words)} play="once" className="ad" cursor={{ at: { wide: { x: 700, y: 400 }, compact: { x: 320, y: 500 } } }}>
      {(s) => (
        <>
          <Window title={d.title} className="ad-win">
            <div className="ad-body" data-mono={d.mono || undefined}>
              <div className="ad-thread">
                <div className="ad-past" aria-hidden>
                  <Bar w={170} h={28} r={14} tone={1} />
                  <Bar w="84%" h={8} r={4} tone={2} />
                  <Bar w="58%" h={8} r={4} tone={2} />
                </div>
                <Collapse open={s.sent} reveal="drop" from="below">
                  <div className="ad-q"><Text>{d.q}</Text></div>
                </Collapse>
                <Collapse open={s.phase === "thinking"}><Text className="ad-thinking">Thinking</Text></Collapse>
                <Collapse open={s.phase === "answer"}>
                  <div className="ad-a" data-on>
                    <Stream className="ad-stream" text={d.a} count={s.words} />
                    <Collapse open={s.card} reveal="drop">
                      <div className="ad-card">
                        <div className="ad-heading">{d.card.heading}</div>
                        {d.card.rows.map((r) => (
                          <div key={r.network} className="ad-row"><Mark name={r.network} /><span className="ad-net">{r.network}</span><span className="ad-note">{r.text}</span></div>
                        ))}
                        {d.card.button && d.card.done && (
                          <Button variant="primary" size="small" className="ad-confirm" data-target="confirm" data-cursor="pointer">
                            <States value={s.done ? "done" : "todo"} states={{ todo: d.card.button, done: d.card.done }} />
                          </Button>
                        )}
                      </div>
                    </Collapse>
                  </div>
                </Collapse>
              </div>
              <Field value={s.draft} placeholder={d.placeholder} focused={!s.sent} />
            </div>
          </Window>
          <span data-target="rest" style={{ position: "absolute", right: 40, bottom: 40 }} />
        </>
      )}
    </Stage>
  );
}
