"use client";


import { Bar, Button, Check, Collapse, Stage, States, Tabs, Window, type Act } from './kit'
import './composer.css'

// Distora's composer, as the hero's product shot. One story: a post written once goes out to three
// networks. Beats: the X tab is picked and the post becomes a thread with its counters; the three
// checks tick in turn; Schedule is pressed and confirms on itself; the scheduled time is the payoff.
// The loop resets with a cause: the tab returns to "All networks" for the next post.
//
// Real strings (7): the post, the tab labels, the three network names, the time, the button.
// Everything else (the left rail, the second line of each check) is filler.

type S = { tab: number; checked: number; scheduled: boolean }

const initial: S = { tab: 0, checked: 0, scheduled: false }
// The poster is the payoff: the thread visible, all checks done, the button confirming.
const POSTER: S = { tab: 2, checked: 3, scheduled: true }

const TABS = ['All networks', 'LinkedIn', 'X', 'Instagram']
const POST = 'Friday at 10:00 we ship the thing we have been building all year. Here is what is new, in four short posts.'
const POST_2 = 'First, one post tuned for each network: its own caption, title and media per account.'
const NETWORKS = [
  { name: 'LinkedIn', note: 'Within limits' },
  { name: 'X', note: 'Thread of 4' },
  { name: 'Instagram', note: '4 photos, 1 video' },
]

// Simple Icons (CC0) paths, the same marks the site uses.
const MARK: Record<string, { color: string; d: string }> = {
  LinkedIn: { color: '#0A66C2', d: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
  X: { color: '#111113', d: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z' },
  Instagram: { color: '#d6249f', d: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z' },
}

function Mark({ name }: { name: string }) {
  return (
    <svg className="dc-mark" viewBox="0 0 24 24" aria-hidden>
      <path d={MARK[name].d} fill={MARK[name].color} />
    </svg>
  )
}

async function script(a: Act<S>) {
  await a.wait(900)

  // 1. Pick the X tab: the post becomes a thread with counters (wide only; the phone design is
  // just the schedule panel, so it starts at the checks)
  if (a.layout === 'wide') {
    await a.move('tab-x')
    await a.wait(250)
    await a.click()
    await a.set({ tab: 2 })
    await a.wait(1100)
  }

  // 2. The checks tick in turn, a beat apart
  for (const n of [1, 2, 3]) {
    await a.set({ checked: n })
    await a.wait(380)
  }
  await a.wait(500)

  // 3. Schedule: the button confirms on itself
  await a.move('schedule')
  await a.wait(300)
  await a.click()
  await a.set({ scheduled: true })

  // Payoff holds, then the next post: back to All networks
  await a.move('rest')
  await a.wait(2600)
  if (a.layout === 'wide') {
    await a.move('tab-all')
    await a.wait(200)
    await a.click()
  }
  await a.set({ tab: 0, checked: 0, scheduled: false })
  await a.move('rest')
  await a.wait(600)
}

export function DistoraComposer() {
  return (
    <Stage
      width={1040}
      height={420}
      compact={{ below: 640, width: 358, height: 400 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: { wide: { x: 979, y: 389 }, compact: { x: 317, y: 379 } } }}
      className="dc"
    >
      {(s, _rect, layout) => {
        const thread = s.tab === 2
        return (
          <>
            <Window
              title="Compose"
              className="dc-window"
              toolbar={layout === 'compact' ? <Bar w={22} h={22} r={11} tone={2} /> : undefined}
              sidebarWidth={168}
              sidebar={
                layout === 'wide' ? (
                  <div className="dc-rail" aria-hidden>
                    {[64, 48, 72, 56, 44, 60, 52, 68, 40].map((w, i) => (
                      <Bar key={i} w={w} h={7} tone={i === 0 ? 3 : 2} />
                    ))}
                  </div>
                ) : undefined
              }
            >
              <div className="dc-body">

                <main className="dc-main">
                  <Tabs className="dc-tabs" items={TABS} value={s.tab} targets={['tab-all', undefined, 'tab-x', undefined]} />
                  <div className="dc-post" data-thread={thread || undefined}>
                    <div className="dc-text">{POST}</div>
                    <div className="dc-meta">
                      <span>{thread ? 'Post 1 of 4' : ''}</span>
                      {/* X has a limit, so its count gains one; States holds the larger box so nothing shifts. */}
                      <States className="dc-count" align="end" value={thread ? 'x' : 'all'} states={{ all: '103 characters', x: '103 / 280' }} />
                    </div>
                  </div>
                  {/* The thread replaces the media row: the attachments fold away as post 2 opens,
                      so the second post's words stay inside the crop. */}
                  <Collapse open={!thread}>
                    <div className="dc-media" aria-hidden>
                      {[0, 1, 2, 3].map((i) => (
                        <Bar key={i} w={72} h={72} r={8} tone={i === 0 ? 3 : 2} />
                      ))}
                    </div>
                  </Collapse>
                  <Collapse open={thread && layout === 'wide'} reveal="drop">
                    <div className="dc-post dc-post--second">
                    <div className="dc-text">{POST_2}</div>
                    <div className="dc-meta">
                      <span>Post 2 of 4</span>
                      <span className="dc-count">85 / 280</span>
                    </div>
                    </div>
                  </Collapse>
                </main>

                <section className="dc-side">
                  <div className="dc-label">Schedule</div>
                  <div className="dc-when">Fri 20 Nov, 10:00</div>
                  <div className="dc-label dc-label--gap">Checks</div>
                  {NETWORKS.map((n, i) => (
                    <div key={n.name} className="dc-check">
                      <Check on={s.checked > i} pending={s.checked === i && s.checked > 0} size={16} />
                      <Mark name={n.name} />
                      <span className="dc-net">{n.name}</span>
                      {layout === 'wide' && <Bar w={[52, 64, 46][i]} h={6} tone={2} />}
                    </div>
                  ))}
                  <Button variant="primary" size="large" className="dc-schedule" data-target="schedule" data-cursor="pointer">
                    {/* A full-width button: both labels crossfade in one box, so nothing slides. */}
                    <States value={s.scheduled ? 'done' : 'todo'} states={{ todo: 'Schedule 3 posts', done: '3 posts scheduled' }} />
                  </Button>
                </section>
              </div>
            </Window>
            <span data-target="rest" className="dc-rest" />
          </>
        )
      }}
    </Stage>
  )
}
