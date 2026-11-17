import type { Metadata } from "next";
import { mdAlt } from "@/lib/ai-pages";
import { notFound } from "next/navigation";
import { integrations } from "@/landing/seo-pages";
import { SeoPageView } from "@/landing/seo-page";

// Static: one page per entry in seo-pages.ts; any other slug is a 404 (notFound below).
export function generateStaticParams() {
  return integrations.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/integrations/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = integrations.find((p) => p.slug === slug);
  if (!page) return {};
  return { title: `${page.title} | PostRally`, description: page.description, alternates: { canonical: `/integrations/${page.slug}`, types: mdAlt(`/integrations/${page.slug}`) } };
}

export default async function Page({ params }: PageProps<"/integrations/[slug]">) {
  const { slug } = await params;
  const page = integrations.find((p) => p.slug === slug);
  if (!page) notFound();
  return <SeoPageView page={page} kind="Integration" />;
}
