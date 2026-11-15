import { assistants } from "../content";
import { Section } from "../components/section";
import { Card } from "../components/card";
import { CircleMark, HandNote, StickyNote, Tape } from "../components/craft";

// Spans alternate 7/5 then 5/7 so the two rows don't read as a copy-paste grid,
// and each card holds a different kind of object: chat, terminal, notes, code.
export function Assistants() {
  const { chat, terminal, confirm, api } = assistants;
  return (
    <Section id="assistants" title={assistants.title} body={assistants.body}>
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7" tone="periwinkle" title={chat.title} body={chat.body} visual={<ChatWindow />} />
        <Card className="lg:col-span-5" title={terminal.title} body={terminal.body} visual={<Terminal />} />
        <Card className="lg:col-span-5" title={confirm.title} body={confirm.body} visual={<ConfirmNotes />} />
        <Card className="lg:col-span-7" tone="sky" title={api.title} body={api.body} visual={<ApiSnippet />} />
      </div>
    </Section>
  );
}

function ChatWindow() {
  const c = assistants.chat;
  return (
    <div className="lift relative w-full max-w-md -rotate-1 rounded-2xl bg-white p-4 text-sm shadow-lift">
      <Tape className="-top-3 left-8 -rotate-3" />
      <p className="ml-auto w-fit rounded-2xl bg-linen px-3 py-2 text-ink">{c.ask}</p>
      <p className="mt-3 text-graphite">
        Used Distora <span className="font-mono text-ink">{c.tool}</span>
      </p>
      <p className="mt-2 text-ink">{c.answer}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink">
        {c.results.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ol>
    </div>
  );
}

function Terminal() {
  return (
    <div className="lift relative w-full max-w-md rotate-1 overflow-hidden rounded-xl bg-ink shadow-lift">
      <Tape className="-top-2 right-10 rotate-6" />
      <div aria-hidden className="flex gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="size-2.5 rounded-full bg-white/25" />
        <span className="size-2.5 rounded-full bg-white/25" />
        <span className="size-2.5 rounded-full bg-white/25" />
      </div>
      <pre className="p-4 text-sm leading-relaxed whitespace-pre-wrap text-canvas">
        {assistants.terminal.lines.map((l) => (l.prompt ? `$ ${l.text}` : `  ${l.text}`)).join("\n")}
      </pre>
    </div>
  );
}

function ConfirmNotes() {
  const [preview, yes, posts] = assistants.confirm.notes;
  return (
    // Notes step diagonally down the card, each joined by a drawn arrow.
    <div className="flex w-full max-w-xs flex-col">
      <StickyNote tone="periwinkle" className="lift w-fit -rotate-3 text-xl">{preview}</StickyNote>
      <HandNote arrow="down" className="-my-2 ml-16 h-12 [&_svg]:size-12" />
      <div className="relative ml-auto mr-auto w-fit">
        <CircleMark className="-inset-4" />
        <StickyNote className="lift rotate-2 text-xl">{yes}</StickyNote>
      </div>
      <HandNote arrow="down" className="-my-2 ml-auto mr-20 h-12 [&_svg]:size-12" />
      <StickyNote tone="mint" className="lift ml-auto w-fit -rotate-1 text-xl">{posts}</StickyNote>
    </div>
  );
}

function ApiSnippet() {
  const a = assistants.api;
  return (
    <div className="lift relative w-full max-w-lg -rotate-1 rounded-xl bg-white p-4 font-mono text-sm shadow-lift">
      <Tape className="-top-3 left-1/2 -translate-x-1/2" />
      <p className="break-all text-ink">{a.request}</p>
      <pre className="mt-3 overflow-x-auto text-graphite">{a.payload}</pre>
      <p className="mt-3 text-ink">{a.response}</p>
    </div>
  );
}
