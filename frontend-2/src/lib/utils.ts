import { createCn } from "cn/config";

// Our @theme font-size tokens (text-display, text-heading in globals.css) must be known to the merger,
// or it reads them as colours and drops them when a colour class like text-ink follows.
// Add every new --text-* token here.
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["display", "heading"] }] } },
});
