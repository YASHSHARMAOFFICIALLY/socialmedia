"use client";

import dynamic from "next/dynamic";

// The animated composer (stageshow) only runs in the browser: the kit measures the DOM and drives
// its own clock. While it loads, an empty box at the stage's own proportions holds the space so the
// page doesn't shift (1040 x 420 wide, 358 x 400 in the phone column).
const ComposerDemo = dynamic(() => import("./composer-demo").then((m) => m.DistoraComposer), {
  ssr: false,
  loading: () => <div aria-hidden className="aspect-[1040/420] max-[639px]:aspect-[358/400]" />,
});

export function ComposerDemoSlot() {
  return (
    <figure className="m-0">
      <ComposerDemo />
      <figcaption className="sr-only">
        Distora&apos;s composer: switching to the X tab turns the post into a thread, the LinkedIn, X and Instagram checks pass, and Schedule confirms 3 posts for Friday 10:00.
      </figcaption>
    </figure>
  );
}
