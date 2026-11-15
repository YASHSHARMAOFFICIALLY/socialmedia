# Variant 2: Hills photo hero + product-first light

References (chosen by the user, studied live on 2026-11-14): meetribbon.app and tapmac.app heroes.
Both use a full-bleed landscape behind a big serif headline with italic accent words, one button,
and a tiny mono meta line. The composer screen hangs over the hero's bottom edge so the product shows above the fold.

Design read: product landing for creators, small teams and developers. Dial: ENERGY 3 hero / 2 page,
RHYTHM 2, MOTION 2 (hero story plays once, page is calm).

## Hero: the story in one picture
Full-bleed photo: green hills, wildflowers, big cloudy sky ("Wide Cinematic Surreal Landscape",
imageory.in, public/hero-hills.jpg, 1279x720). White headline in the sky. The eleven networks sit in one
row of white app-icon tiles under the button below 1280px; from 1280px up they are named tags (brand-colour
icon + name) scattered left and right of the text in a zigzag, five each side (Telegram stays in the
screen-reader list and the smaller-screen row), flying out of the composer screen on load.
Birds glide across the top (sky-life.tsx).

Readability (distribution.studio technique): the photo goes soft-focus behind the text (backdrop blur 18px in
the same oval), then a faint oval of clear sky in the photo's own blue (#0566ad to #0a6fb6, 75% opacity,
620px wide below 1024px, 66% above, full strength on phones) sits behind the text only, cut off above
the horizon. Body copy is 24px from sm up, which WCAG counts as large text (3:1), so the oval stays
faint. Measured, text hidden, worst pixel: 1280px headline 3.5:1, body 3.1:1 (blur alone: 1.2:1); 375px headline 5.6:1,
body (20px, needs 4.5) 5.4:1. The small note line was removed from the hero (the FAQ and the
assistants section cover both facts).
Tried and rejected: a flat blue patch, a graduated sky with glowing letters, a clear-sky field photo.
The real fix is still a photo with clear sky behind the text, as Ribbon and TapMac have.

## Palette
Hero: hills photo, soft-focus sky behind the text, white text, white button with play icon, named network
tags. The composer screen sits in a pure white frame (#ffffff, hairline, one soft shadow).

Page (below hero):
| Token | Value | Use |
|---|---|---|
| paper | #ffffff | page background (pure white) |
| surface | #ffffff | cards and product screens |
| line | #e7e7ea | 1px borders (neutral: no warm or milky tint anywhere) |
| ink | #111113 | text, primary button |
| muted | #5b5b62 | secondary text (6.7:1 on paper) |
| signal | #e5531a | small orange marks only: dots, active tab |
| signal-soft | #fdede5 | chip backgrounds |
| ok | #1d7a45 | checks, always with text |

## "Try it" bento (sections/assistants.tsx)
Pattern from a reference bento (github.com/Sam721166/timmo, no licence: pattern copied, code written
fresh). Cards are pure white (#ffffff) with a hairline; colour lives only in the widgets inside
(brand colours, heatmap, status badges, time-of-day chips). Each card has a label and a status pill
on top, a working widget in the middle and its actions at the bottom: assistant (pick app and prompt,
confirm twice to see the replay), team approval (approve, then edit to send it back), best-time
heatmap per network (example data, labelled), per-network limits (type to test), and one 10:00 shown
across four cities with time-of-day colours. CLI and webhooks moved to "And the rest".
The site has one theme: pure white, no dark mode (`dark:` only matches a `.dark` class never set).

## Type
- Headlines everywhere: Instrument Serif, italic for the accent phrase (Ribbon "*shrinking*", TapMac "*taps*").
- Body and UI: Inter. Code and the hero meta line: Geist Mono, uppercase, wide tracking (TapMac's
  "FREE · V0.1.0 · 473 KB" line, used once).

## Below the hero
Ribbon order: "What is Distora?" (the composer screen hangs from the hero above it), then split text + screen sections,
TapMac card grid, plain feature list, FAQ (title left, questions right), footer. Cards: white, hairline
border, no shadow. Product screens are the only elements with a shadow.

## Motion
Hero: planes fly once on load and billboards light as each lands, a few stars twinkle. Off with
reduced motion (billboards show lit). Page: Lenis smooth scroll and hover colours only.

## Footer and search pages
Postiz/Ribbon SEO footer, light: brand block with "Ask AI about Distora" (ChatGPT, Claude, Perplexity,
Grok links that open the assistant with a 10-line fact prompt), then columns with brand glyphs:
Distora (sections), Use it from (/integrations/*), Networks (/channels/*), For AI and search
(llms.txt, sitemap). Every link opens a real page: 5 integration and 11 network pages are generated
from src/landing/seo-pages.ts with their own title, description and canonical URL, plus
sitemap.xml, robots.txt and llms.txt. Compare and guide pages come later and are not linked yet.
Set NEXT_PUBLIC_SITE_URL at deploy (falls back to localhost).
