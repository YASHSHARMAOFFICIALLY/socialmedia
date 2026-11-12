import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";

// Fonts: swap these two to change the typeface everywhere. CSS reads --font-body and --font-code.
const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Distora",
  description: "Create once, customize per platform, publish everywhere.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${code.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
