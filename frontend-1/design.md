# Craft Docs — Style Reference
> Digital Scrapbook Collage. The design feels like a thoughtful, tactile scrapbook where structured digital notes meet soft, organic textures.

Source: craft.do (Refero extraction, 2026-04-11). Saved 2026-11-14 as design direction for our landing page. See also `docs/landing-reference.md` for section patterns (bento, FAQ, footer, SEO).

**Theme:** light

Source measurements are normalized; roles and recommendations are interpreted. Font summary lists are independent, not paired by position. HTML examples are reconstructions, not source components.

The design aesthetic is gentle, creative, and tactile, evoking the feeling of a personal journal or artist's scrapbook. This is achieved through a warm, off-white canvas (#fff3e7), a palette of soft pastels (#9bd8a9, #fde99b), and organic, torn-paper collage elements. The primary visual signature is the typographic pairing: a sophisticated, tightly-tracked serif (`UntitledSerifFont`) for large, literary headlines, contrasted with a clean, functional sans-serif (`UntitledSansFont`) for all UI and body text. Rounded corners (14px, 24px) are prevalent, but are punctuated by pill-shaped buttons, creating a soft and approachable interface. Deep, multi-layered shadows provide a subtle, non-intrusive sense of depth, making elements feel floated rather than stacked.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Canvas | `#fff3e7` | `--color-canvas` | Main page background, creating a warm, paper-like base. |
| Ink | `#030302` | `--color-ink` | Primary text, headlines, and filled UI elements. |
| White | `#ffffff` | `--color-white` | Card surfaces, contrast text on dark backgrounds. |
| Linen | `#f7f7f7` | `--color-linen` | Secondary light backgrounds, subtle dividers. |
| Cloud | `#efefef` | `--color-cloud` | Subtle container backgrounds, hover states. |
| Ash | `#e1e1e1` | `--color-ash` | Borders and dividers. |
| Stone | `#bebbba` | `--color-stone` | Secondary body text, disabled states. |
| Graphite | `#41413f` | `--color-graphite` | Sub-headings and secondary text with more emphasis. |
| Mint | `#9bd8a9` | `--color-mint` | Decorative background shapes, UI tags — a primary brand pastel. |
| Marigold | `#fde99b` | `--color-marigold` | Decorative background shapes, UI highlights — a warm primary brand pastel. |
| Periwinkle | `#b8caf5` | `--color-periwinkle` | Decorative background shapes, UI highlights — a cool primary brand pastel. |
| Sky | `linear-gradient(in oklab, rgb(158, 212, 239) 0px, rgb(209, 238, 249) 100%)` | `--color-sky` | Hero background textures and atmospheric elements. |
| Papaya | `#ff4500` | `--color-papaya` | Accent frames on cards, callouts within illustrations. |
| Azure | `#0087ff` | `--color-azure` | Interactive icons and links within product mockups. |

## Tokens — Typography

### UntitledSerifFont — Used exclusively for large, impactful headlines (H1/H2). Its literary feel provides a signature contrast to the functional sans-serif UI, making statements feel personal and crafted. · `--font-untitledseriffont`
- **Substitute:** Lora, Merriweather
- **Weights:** 400
- **Sizes:** 24px, 28px, 30px, 32px, 36px, 46px, 54px, 56px, 66px
- **Line height:** 1.05-1.2
- **Letter spacing:** Tight negative tracking at large sizes (e.g., -2.64px at 66px), normal at smaller sizes.
- **OpenType features:** `"liga"`
- **Role:** Used exclusively for large, impactful headlines (H1/H2). Its literary feel provides a signature contrast to the functional sans-serif UI, making statements feel personal and crafted.

### UntitledSansFont — The workhorse font for all UI elements, including buttons, navigation, body copy, and captions. Provides clarity and readability. · `--font-untitledsansfont`
- **Substitute:** Inter, Figtree
- **Weights:** 400, 500, 700
- **Sizes:** 12px, 14px, 16px, 18px, 20px, 24px
- **Line height:** 1.4-1.5
- **Letter spacing:** Slightly negative tracking at subheading sizes (e.g., -0.72px at 24px), slightly positive at small sizes.
- **OpenType features:** `"liga"`
- **Role:** The workhorse font for all UI elements, including buttons, navigation, body copy, and captions. Provides clarity and readability.

### Type Scale

| Role | Family | Weight | Size | Line Height | Letter Spacing | Token |
|------|--------|--------|------|-------------|----------------|-------|
| caption | — | — | 12px | 1.5 | 0.12px | `--text-caption` |
| body-sm | — | — | 14px | 1.5 | 0.14px | `--text-body-sm` |
| body | — | — | 16px | 1.5 | -0.24px | `--text-body` |
| subheading | — | — | 24px | 1.4 | -0.72px | `--text-subheading` |
| heading-sm | — | — | 36px | 1.2 | -0.72px | `--text-heading-sm` |
| heading | — | — | 46px | 1.1 | -1.38px | `--text-heading` |
| heading-lg | — | — | 56px | 1.05 | -2.24px | `--text-heading-lg` |
| display | — | — | 66px | 1.1 | -2.64px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 48 | 48px | `--spacing-48` |
| 60 | 60px | `--spacing-60` |
| 80 | 80px | `--spacing-80` |
| 120 | 120px | `--spacing-120` |
| 180 | 180px | `--spacing-180` |
| 188 | 188px | `--spacing-188` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 16-24px |
| pills | 9999px |
| inputs | 14px |
| buttons | 14px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| xl | `rgba(0, 0, 0, 0.01) 0px 50px 40px 0px, rgba(0, 0, 0, 0.02...` | `--shadow-xl` |
| sm | `rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0...` | `--shadow-sm` |
| md | `rgba(0, 0, 0, 0.1) 0px 12px 12px 2px, rgba(0, 0, 0, 0.06)...` | `--shadow-md` |
| md-2 | `rgba(0, 0, 0, 0.08) 0px 4px 16px 0px` | `--shadow-md-2` |
| subtle | `rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0p...` | `--shadow-subtle` |
| md-3 | `rgba(0, 0, 0, 0.1) 0px 4px 12px 0px` | `--shadow-md-3` |

### Layout

- **Page max-width:** 1280px
- **Section gap:** 96-120px
- **Card padding:** 24px
- **Element gap:** 8-16px

## Components

### Primary Pill Button
**Role:** The main 'Try Craft Free' call-to-action in the sticky navigation header.

A pill-shaped button (9999px radius) with an Ink (#030302) background and White (#ffffff) text. Features a subtle lift shadow on hover.

### Navigation Link
**Role:** Standard links within the main header navigation.

Unstyled text link using UntitledSansFont at 16px. Text color is Ink (#030302). A subtle underline or background color change appears on hover.

### Testimonial Quote
**Role:** Displays user feedback and social proof.

A large quotation in UntitledSerifFont, often italicized, in Ink (#030302). Attributed to a user with a small circular avatar and name in UntitledSansFont.

### Collage Background Element
**Role:** Decorative, atmospheric elements that make up the scrapbook aesthetic.

Abstract shapes with torn-paper edges, often filled with a brand pastel like Mint (#9bd8a9) or a simple dot/grid pattern. Layered behind content with low-opacity shadows.

## Do's and Don'ts

### Do
- Use `UntitledSerifFont` for all major headlines (H1, H2) to establish the brand's literary, crafted feel.
- Apply tight negative letter-spacing (e.g., -2.24px at 56px) to serif headlines for a professional, refined look.
- Layer torn-paper textures and soft pastel color blocks (`Mint`, `Marigold`) to create the signature collage aesthetic.
- Use the complex, multi-layered shadow style on all key floating elements like cards.
- Set main page content on the warm `Canvas` (#fff3e7) background, not pure white.
- Combine generous corner radii (14px, 24px) with pill-shaped buttons for a friendly, approachable UI.
- Maintain generous vertical whitespace (96px+) between content sections.

### Don't
- Don't use the serif font for UI controls, body copy, or any text smaller than 24px.
- Don't use pure black text; always use the softer `Ink` (#030302).
- Don't use hard, single-source drop shadows. Stick to the soft, deep, multi-layered shadow style.
- Don't use sharp 0px corners on buttons or cards.
- Don't use a pure white (#ffffff) page background for long-form content.
- Don't clutter the layout; prioritize spaciousness and clear, centered compositions.
- Don't use vibrant accent colors for large background surfaces; reserve them for small highlights or illustrative frames.

## Elevation

- **Primary Card, Floating UI Element:** `rgba(0, 0, 0, 0.01) 0px 50px 40px 0px, rgba(0, 0, 0, 0.02) 0px 50px 40px 0px, rgba(0, 0, 0, 0.05) 0px 20px 40px 0px, rgba(0, 0, 0, 0.08) 0px 3px 10px 0px`
- **Hovered Button, Dropdown Menu:** `rgba(0, 0, 0, 0.1) 0px 12px 12px 2px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px`
- **Navigation Bar:** `rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px`

## Imagery

The visual language is a distinctive collage of clean UI screenshots and tactile, analog textures. Imagery includes torn paper edges, subtle grid patterns, and flat pastel color fields that frame or sit behind product mockups. This juxtaposition of digital precision and physical craft is central to the brand. Photography is used sparingly for user testimonials, appearing within small, rounded frames. The overall effect is approachable and creative, suggesting that the digital tool is a space for tangible, real-world ideas.

## Layout

The page begins with a full-bleed, textured hero section that immerses the user. Below this, the layout transitions to a centered, max-width container (approx. 1280px) on a warm Canvas background. Generous vertical spacing (~96-120px) separates content sections, creating a calm, unhurried rhythm. Content is typically arranged in centered stacks for major headlines or simple, balanced grids for features (e.g., a five-column grid of icons and labels). The design avoids complex, asymmetric layouts in favor of clear, centered compositions that feel stable and easy to parse.

## Agent Prompt Guide

### Quick Color Reference
- **Page Background:** `Canvas` (#fff3e7)
- **Primary Text:** `Ink` (#030302)
- **Card Background:** `White` (#ffffff)
- **Pill CTA Background:** `Ink` (#030302)
- **Brand Pastels:** `Mint` (#9bd8a9), `Marigold` (#fde99b), `Periwinkle` (#b8caf5)

### Example Component Prompts
1.  **Hero Section:** Create a full-width hero with a textured background using pastel blues like #9ed4ef. Add a centered headline 'Your space for big ideas' using `UntitledSerifFont`, 66px, weight 400, color `Ink` (#030302), and letter-spacing -2.64px. Below it, add a ghost button with 'Try Craft Free' text, transparent background, 1px `Ash` (#e1e1e1) border, 14px radius, and padding 16px 32px.

2.  **Floating UI Card:** Design a product feature card with a `White` (#ffffff) background, 16px border-radius, and the following box-shadow: `rgba(0, 0, 0, 0.01) 0px 50px 40px 0px, rgba(0, 0, 0, 0.02) 0px 50px 40px 0px, rgba(0, 0, 0, 0.05) 0px 20px 40px 0px, rgba(0, 0, 0, 0.08) 0px 3px 10px 0px`. Place a mockup image inside.

3.  **Feature Grid Section:** On the `Canvas` (#fff3e7) background, create a section with the heading 'Craft is for your things' in `UntitledSerifFont` at 46px, color `Ink`. Below it, create a 5-column grid of features. Each item should be a vertical stack with a 24px line-art icon and a label like 'Docs' in `UntitledSansFont` at 16px, color `Ink`.

## Similar Brands

- **Pitch** — Similar use of an elegant serif for headlines contrasted with a clean sans-serif for UI, creating a premium, polished feel.
- **Miro** — Shares a creative, collaborative spirit, using collage-like elements and a wide color palette to feel like a digital workspace.
- **Notion** — Direct competitor in the notes/docs space. While Notion is more minimalist and monochrome, both share a focus on clean typography and a highly functional core UI.
- **Dropbox Paper** — Also focuses on a clean, distraction-free writing experience with a simple, typography-forward interface.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-canvas: #fff3e7;
  --color-ink: #030302;
  --color-white: #ffffff;
  --color-linen: #f7f7f7;
  --color-cloud: #efefef;
  --color-ash: #e1e1e1;
  --color-stone: #bebbba;
  --color-graphite: #41413f;
  --color-mint: #9bd8a9;
  --color-marigold: #fde99b;
  --color-periwinkle: #b8caf5;
  --color-sky: #9ed4ef;
  --gradient-sky: linear-gradient(in oklab, rgb(158, 212, 239) 0px, rgb(209, 238, 249) 100%);
  --color-papaya: #ff4500;
  --color-azure: #0087ff;

  /* Typography — Font Families */
  --font-untitledseriffont: 'UntitledSerifFont', ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  --font-untitledsansfont: 'UntitledSansFont', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.5;
  --tracking-caption: 0.12px;
  --text-body-sm: 14px;
  --leading-body-sm: 1.5;
  --tracking-body-sm: 0.14px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.24px;
  --text-subheading: 24px;
  --leading-subheading: 1.4;
  --tracking-subheading: -0.72px;
  --text-heading-sm: 36px;
  --leading-heading-sm: 1.2;
  --tracking-heading-sm: -0.72px;
  --text-heading: 46px;
  --leading-heading: 1.1;
  --tracking-heading: -1.38px;
  --text-heading-lg: 56px;
  --leading-heading-lg: 1.05;
  --tracking-heading-lg: -2.24px;
  --text-display: 66px;
  --leading-display: 1.1;
  --tracking-display: -2.64px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-60: 60px;
  --spacing-80: 80px;
  --spacing-120: 120px;
  --spacing-180: 180px;
  --spacing-188: 188px;

  /* Layout */
  --page-max-width: 1280px;
  --section-gap: 96-120px;
  --card-padding: 24px;
  --element-gap: 8-16px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 14px;
  --radius-2xl: 20px;
  --radius-3xl: 24px;
  --radius-3xl-2: 32px;

  /* Named Radii */
  --radius-cards: 16-24px;
  --radius-pills: 9999px;
  --radius-inputs: 14px;
  --radius-buttons: 14px;

  /* Shadows */
  --shadow-xl: rgba(0, 0, 0, 0.01) 0px 50px 40px 0px, rgba(0, 0, 0, 0.02) 0px 50px 40px 0px, rgba(0, 0, 0, 0.05) 0px 20px 40px 0px, rgba(0, 0, 0, 0.08) 0px 3px 10px 0px;
  --shadow-sm: rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px;
  --shadow-md: rgba(0, 0, 0, 0.1) 0px 12px 12px 2px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px;
  --shadow-md-2: rgba(0, 0, 0, 0.08) 0px 4px 16px 0px;
  --shadow-subtle: rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px;
  --shadow-md-3: rgba(0, 0, 0, 0.1) 0px 4px 12px 0px;
}
```

> Note: `--section-gap: 96-120px`, `--element-gap: 8-16px` and `--radius-cards: 16-24px` are ranges, not valid CSS values. Pick one number when wiring into code (e.g. 112px / 12px / 20px).

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-canvas: #fff3e7;
  --color-ink: #030302;
  --color-white: #ffffff;
  --color-linen: #f7f7f7;
  --color-cloud: #efefef;
  --color-ash: #e1e1e1;
  --color-stone: #bebbba;
  --color-graphite: #41413f;
  --color-mint: #9bd8a9;
  --color-marigold: #fde99b;
  --color-periwinkle: #b8caf5;
  --color-sky: #9ed4ef;
  --color-papaya: #ff4500;
  --color-azure: #0087ff;

  /* Typography */
  --font-untitledseriffont: 'UntitledSerifFont', ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  --font-untitledsansfont: 'UntitledSansFont', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1.5;
  --tracking-caption: 0.12px;
  --text-body-sm: 14px;
  --leading-body-sm: 1.5;
  --tracking-body-sm: 0.14px;
  --text-body: 16px;
  --leading-body: 1.5;
  --tracking-body: -0.24px;
  --text-subheading: 24px;
  --leading-subheading: 1.4;
  --tracking-subheading: -0.72px;
  --text-heading-sm: 36px;
  --leading-heading-sm: 1.2;
  --tracking-heading-sm: -0.72px;
  --text-heading: 46px;
  --leading-heading: 1.1;
  --tracking-heading: -1.38px;
  --text-heading-lg: 56px;
  --leading-heading-lg: 1.05;
  --tracking-heading-lg: -2.24px;
  --text-display: 66px;
  --leading-display: 1.1;
  --tracking-display: -2.64px;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-60: 60px;
  --spacing-80: 80px;
  --spacing-120: 120px;
  --spacing-180: 180px;
  --spacing-188: 188px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 14px;
  --radius-2xl: 20px;
  --radius-3xl: 24px;
  --radius-3xl-2: 32px;

  /* Shadows */
  --shadow-xl: rgba(0, 0, 0, 0.01) 0px 50px 40px 0px, rgba(0, 0, 0, 0.02) 0px 50px 40px 0px, rgba(0, 0, 0, 0.05) 0px 20px 40px 0px, rgba(0, 0, 0, 0.08) 0px 3px 10px 0px;
  --shadow-sm: rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px;
  --shadow-md: rgba(0, 0, 0, 0.1) 0px 12px 12px 2px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px;
  --shadow-md-2: rgba(0, 0, 0, 0.08) 0px 4px 16px 0px;
  --shadow-subtle: rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px;
  --shadow-md-3: rgba(0, 0, 0, 0.1) 0px 4px 12px 0px;
}
```

> Note: Tailwind v4 `--spacing-*` keys like `--spacing-4: 4px` override the default `p-4 = 16px` scale. Rename (e.g. `--spacing-px4`) or drop before pasting into `globals.css`.

### Design Tokens (W3C DTCG JSON)

```json
{
  "color": {
    "canvas": { "$value": "#fff3e7", "$type": "color", "$description": "Canvas — Main page background, creating a warm, paper-like base." },
    "ink": { "$value": "#030302", "$type": "color", "$description": "Ink — Primary text, headlines, and filled UI elements." },
    "white": { "$value": "#ffffff", "$type": "color", "$description": "White — Card surfaces, contrast text on dark backgrounds." },
    "linen": { "$value": "#f7f7f7", "$type": "color", "$description": "Linen — Secondary light backgrounds, subtle dividers." },
    "cloud": { "$value": "#efefef", "$type": "color", "$description": "Cloud — Subtle container backgrounds, hover states." },
    "ash": { "$value": "#e1e1e1", "$type": "color", "$description": "Ash — Borders and dividers." },
    "stone": { "$value": "#bebbba", "$type": "color", "$description": "Stone — Secondary body text, disabled states." },
    "graphite": { "$value": "#41413f", "$type": "color", "$description": "Graphite — Sub-headings and secondary text with more emphasis." },
    "mint": { "$value": "#9bd8a9", "$type": "color", "$description": "Mint — Decorative background shapes, UI tags — a primary brand pastel." },
    "marigold": { "$value": "#fde99b", "$type": "color", "$description": "Marigold — Decorative background shapes, UI highlights — a warm primary brand pastel." },
    "periwinkle": { "$value": "#b8caf5", "$type": "color", "$description": "Periwinkle — Decorative background shapes, UI highlights — a cool primary brand pastel." },
    "sky": { "$value": "#9ed4ef", "$type": "color", "$description": "Sky — Hero background textures and atmospheric elements." },
    "papaya": { "$value": "#ff4500", "$type": "color", "$description": "Papaya — Accent frames on cards, callouts within illustrations." },
    "azure": { "$value": "#0087ff", "$type": "color", "$description": "Azure — Interactive icons and links within product mockups." }
  },
  "font": {
    "untitledseriffont": { "$value": "UntitledSerifFont", "$type": "fontFamily", "$description": "Used exclusively for large, impactful headlines (H1/H2). Its literary feel provides a signature contrast to the functional sans-serif UI, making statements feel personal and crafted." },
    "untitledsansfont": { "$value": "UntitledSansFont", "$type": "fontFamily", "$description": "The workhorse font for all UI elements, including buttons, navigation, body copy, and captions. Provides clarity and readability." }
  },
  "typography": {
    "xs": { "$value": { "fontFamily": "apple-system", "fontSize": "10px", "fontWeight": 700, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step xs at 10px" },
    "xs-2": { "$value": { "fontFamily": "apple-system", "fontSize": "12px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step xs-2 at 12px" },
    "xs-3": { "$value": { "fontFamily": "apple-system", "fontSize": "12px", "fontWeight": 600, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step xs-3 at 12px" },
    "xs-4": { "$value": { "fontFamily": "apple-system", "fontSize": "12px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step xs-4 at 12px" },
    "xs-5": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "12px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step xs-5 at 12px" },
    "sm": { "$value": { "fontFamily": "apple-system", "fontSize": "13px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0.01em" }, "$type": "typography", "$description": "Typography step sm at 13px" },
    "sm-2": { "$value": { "fontFamily": "apple-system", "fontSize": "13px", "fontWeight": 600, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step sm-2 at 13px" },
    "sm-3": { "$value": { "fontFamily": "apple-system", "fontSize": "13px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step sm-3 at 13px" },
    "sm-4": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "14px", "fontWeight": 500, "lineHeight": 1.43, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step sm-4 at 14px" },
    "sm-5": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "14px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step sm-5 at 14px" },
    "sm-6": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "14px", "fontWeight": 500, "lineHeight": 1.5, "letterSpacing": "0.01em" }, "$type": "typography", "$description": "Typography step sm-6 at 14px" },
    "sm-7": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "14px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step sm-7 at 14px" },
    "base": { "$value": { "fontFamily": "apple-system", "fontSize": "15px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base at 15px" },
    "base-2": { "$value": { "fontFamily": "apple-system", "fontSize": "15px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-2 at 15px" },
    "base-3": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-3 at 16px" },
    "base-4": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step base-4 at 16px" },
    "base-5": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-5 at 16px" },
    "base-6": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-6 at 16px" },
    "base-7": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step base-7 at 16px" },
    "base-8": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step base-8 at 16px" },
    "base-9": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1.5, "letterSpacing": "0.01em" }, "$type": "typography", "$description": "Typography step base-9 at 16px" },
    "base-10": { "$value": { "fontFamily": "apple-system", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-10 at 16px" },
    "base-11": { "$value": { "fontFamily": "apple-system", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step base-11 at 16px" },
    "base-12": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-12 at 16px" },
    "base-13": { "$value": { "fontFamily": "apple-system", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-13 at 16px" },
    "base-14": { "$value": { "fontFamily": "apple-system", "fontSize": "16px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-14 at 16px" },
    "base-15": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 700, "lineHeight": 1.5, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-15 at 16px" },
    "base-16": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "16px", "fontWeight": 500, "lineHeight": 1, "letterSpacing": "0em" }, "$type": "typography", "$description": "Typography step base-16 at 16px" },
    "lg": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "18px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step lg at 18px" },
    "lg-2": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "18px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step lg-2 at 18px" },
    "lg-3": { "$value": { "fontFamily": "apple-system", "fontSize": "19px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step lg-3 at 19px" },
    "xl": { "$value": { "fontFamily": "apple-system", "fontSize": "20px", "fontWeight": 700, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step xl at 20px" },
    "xl-2": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "20px", "fontWeight": 400, "lineHeight": 1.4, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step xl-2 at 20px" },
    "xl-3": { "$value": { "fontFamily": "apple-system", "fontSize": "20px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step xl-3 at 20px" },
    "2xl": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "24px", "fontWeight": 400, "lineHeight": 1.2, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step 2xl at 24px" },
    "2xl-2": { "$value": { "fontFamily": "apple-system", "fontSize": "24px", "fontWeight": 500, "lineHeight": 1.4, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step 2xl-2 at 24px" },
    "2xl-3": { "$value": { "fontFamily": "UntitledSansFont", "fontSize": "24px", "fontWeight": 400, "lineHeight": 1.05, "letterSpacing": "-0.015em" }, "$type": "typography", "$description": "Typography step 2xl-3 at 24px" },
    "2xl-4": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "24px", "fontWeight": 400, "lineHeight": 1.05, "letterSpacing": "-0.015em" }, "$type": "typography", "$description": "Typography step 2xl-4 at 24px" },
    "2xl-5": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "28px", "fontWeight": 400, "lineHeight": 1.2, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step 2xl-5 at 28px" },
    "3xl": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "30px", "fontWeight": 400, "lineHeight": 1, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step 3xl at 30px" },
    "3xl-2": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "32px", "fontWeight": 400, "lineHeight": 1.5, "letterSpacing": "-0.04em" }, "$type": "typography", "$description": "Typography step 3xl-2 at 32px" },
    "4xl": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "36px", "fontWeight": 400, "lineHeight": 1.22, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step 4xl at 36px" },
    "4xl-2": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "36px", "fontWeight": 400, "lineHeight": 1.11, "letterSpacing": "-0.04em" }, "$type": "typography", "$description": "Typography step 4xl-2 at 36px" },
    "4xl-3": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "46px", "fontWeight": 400, "lineHeight": 1.22, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step 4xl-3 at 46px" },
    "5xl": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "54px", "fontWeight": 400, "lineHeight": 1.1, "letterSpacing": "-0.02em" }, "$type": "typography", "$description": "Typography step 5xl at 54px" },
    "5xl-2": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "56px", "fontWeight": 400, "lineHeight": 1.1, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step 5xl-2 at 56px" },
    "5xl-3": { "$value": { "fontFamily": "UntitledSerifFont", "fontSize": "66px", "fontWeight": 400, "lineHeight": 1, "letterSpacing": "-0.03em" }, "$type": "typography", "$description": "Typography step 5xl-3 at 66px" }
  },
  "spacing": {
    "4": { "$value": "4px", "$type": "dimension", "$description": "Spacing 4px" },
    "8": { "$value": "8px", "$type": "dimension", "$description": "Spacing 8px" },
    "12": { "$value": "12px", "$type": "dimension", "$description": "Spacing 12px" },
    "16": { "$value": "16px", "$type": "dimension", "$description": "Spacing 16px" },
    "20": { "$value": "20px", "$type": "dimension", "$description": "Spacing 20px" },
    "24": { "$value": "24px", "$type": "dimension", "$description": "Spacing 24px" },
    "32": { "$value": "32px", "$type": "dimension", "$description": "Spacing 32px" },
    "40": { "$value": "40px", "$type": "dimension", "$description": "Spacing 40px" },
    "48": { "$value": "48px", "$type": "dimension", "$description": "Spacing 48px" },
    "60": { "$value": "60px", "$type": "dimension", "$description": "Spacing 60px" },
    "80": { "$value": "80px", "$type": "dimension", "$description": "Spacing 80px" },
    "120": { "$value": "120px", "$type": "dimension", "$description": "Spacing 120px" },
    "180": { "$value": "180px", "$type": "dimension", "$description": "Spacing 180px" },
    "188": { "$value": "188px", "$type": "dimension", "$description": "Spacing 188px" },
    "unit": { "$value": "4px", "$type": "dimension", "$description": "Base spacing unit" }
  },
  "radius": {
    "md": { "$value": "4px", "$type": "dimension", "$description": "Border radius md" },
    "lg": { "$value": "8px", "$type": "dimension", "$description": "Border radius lg" },
    "xl": { "$value": "14px", "$type": "dimension", "$description": "Border radius xl" },
    "2xl": { "$value": "20px", "$type": "dimension", "$description": "Border radius 2xl" },
    "3xl": { "$value": "24px", "$type": "dimension", "$description": "Border radius 3xl" },
    "3xl-2": { "$value": "32px", "$type": "dimension", "$description": "Border radius 3xl-2" }
  },
  "shadow": {
    "xl": { "$value": "rgba(0, 0, 0, 0.01) 0px 50px 40px 0px, rgba(0, 0, 0, 0.02) 0px 50px 40px 0px, rgba(0, 0, 0, 0.05) 0px 20px 40px 0px, rgba(0, 0, 0, 0.08) 0px 3px 10px 0px", "$type": "shadow", "$description": "Shadow elevation xl" },
    "sm": { "$value": "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px", "$type": "shadow", "$description": "Shadow elevation sm" },
    "md": { "$value": "rgba(0, 0, 0, 0.1) 0px 12px 12px 2px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px", "$type": "shadow", "$description": "Shadow elevation md" },
    "md-2": { "$value": "rgba(0, 0, 0, 0.08) 0px 4px 16px 0px", "$type": "shadow", "$description": "Shadow elevation md-2" },
    "subtle": { "$value": "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px", "$type": "shadow", "$description": "Shadow elevation subtle" },
    "md-3": { "$value": "rgba(0, 0, 0, 0.1) 0px 4px 12px 0px", "$type": "shadow", "$description": "Shadow elevation md-3" }
  },
  "$extensions": {
    "com.refero.extraction": {
      "url": "https://craft.do",
      "siteName": "Craft Docs",
      "extractedAt": "2026-04-11T17:34:08.934Z",
      "variant": "extended"
    }
  }
}
```
