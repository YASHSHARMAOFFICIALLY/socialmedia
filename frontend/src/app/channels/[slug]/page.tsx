import type { Metadata } from "next";
import { mdAlt } from "@/lib/ai-pages";
import { notFound } from "next/navigation";
import { channels } from "@/landing/seo-pages";
import { SeoPageView } from "@/landing/seo-page";

// Static: one page per entry in seo-pages.ts; any other slug is a 404 (notFound below).
export function generateStaticParams() {
  return channels.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/channels/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = channels.find((p) => p.slug === slug);
  if (!page) return {};
  return { title: `${page.title} | PostRally`, description: page.description, alternates: { canonical: `/channels/${page.slug}`, types: mdAlt(`/channels/${page.slug}`) } };
}

export default async function Page({ params }: PageProps<"/channels/[slug]">) {
  const { slug } = await params;
  const page = channels.find((p) => p.slug === slug);
  if (!page) notFound();
  return <SeoPageView page={page} kind="Network" />;
}
