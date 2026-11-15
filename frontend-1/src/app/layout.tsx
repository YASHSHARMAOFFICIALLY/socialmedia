import type { Metadata } from "next";
import { Caveat, Geist_Mono, Inter, Lora } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";

// Fonts: frontend-1/design.md pairs a literary serif for big headlines with a plain sans for everything else.
// Lora and Inter are the free substitutes it names. CSS reads --font-display, --font-body and --font-code.
const display = Lora({ variable: "--font-display", subsets: ["latin"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });
// Handwriting for scrapbook annotations and sticky notes only, never for content people must read closely.
const hand = Caveat({ variable: "--font-handwriting", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Distora: write once, post to eleven social networks",
  description:
    "Tailor one post for Instagram, X, LinkedIn, YouTube, Threads, Facebook, Pinterest, TikTok, Bluesky, Mastodon and Telegram. Schedule it in any timezone, track how it did, and run it all from Claude, ChatGPT, Cursor or the API.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${code.variable} ${hand.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
