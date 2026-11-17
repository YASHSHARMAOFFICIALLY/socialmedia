"use client";

import dynamic from "next/dynamic";

// Browser-only (the kit measures the DOM); the wrapper holds the stage's proportions from first paint.
const Demo = dynamic(() => import("./calendar-demo").then((m) => m.CalendarDemo), { ssr: false });

export function CalendarDemoSlot() {
  return (
    <figure className="m-0">
      <div aria-hidden inert className="aspect-[720/400] max-[639px]:aspect-[358/400]">
        <Demo />
      </div>
      <figcaption className="sr-only">
        PostRally&apos;s calendar for one week in Berlin time: an X thread is dragged onto 10:00 on Friday, where another X post already sits, and PostRally warns that they clash. Moved to 10:30 it is fine, and the note shows when it goes out.
      </figcaption>
    </figure>
  );
}
