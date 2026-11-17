"use client";

import { KuroLaptopSticker, PipRocketSticker } from "stick-it-up";

// Two stickers (stick-it-up, MIT) slapped next to the "Try it" heading: writing on one side, posts
// launching on the other. Named imports here keep the bundle to these two; importing the package
// by name inside dynamic() pulls in all 10 MB of it.
export default function HeadingStickers() {
  return (
    <>
      <span aria-hidden className="absolute top-0 -left-36 hidden -rotate-12 lg:block">
        <KuroLaptopSticker size={104} peel />
      </span>
      <span aria-hidden className="absolute -top-6 -right-32 hidden rotate-[10deg] lg:block">
        <PipRocketSticker size={112} peel />
      </span>
    </>
  );
}
