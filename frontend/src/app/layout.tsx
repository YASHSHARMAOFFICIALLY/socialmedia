import type { Metadata } from "next";
import { Geist_Mono, Inter, Instrument_Serif } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";
import { siteUrl } from "@/lib/site";

// Fonts (design.md): Instrument Serif for every headline (italic for accent phrases, as Ribbon and TapMac do),
// Inter for body and UI, Geist Mono for code and the hero meta line.
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "PostRally: write once, post to eleven social networks",
  description:
    "Tailor one post for Instagram, X, LinkedIn, YouTube, Threads, Facebook, Pinterest, TikTok, Bluesky, Mastodon and Telegram. Schedule it in any timezone, track how it did, and run it all from Claude, ChatGPT, Cursor or the API.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${code.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
