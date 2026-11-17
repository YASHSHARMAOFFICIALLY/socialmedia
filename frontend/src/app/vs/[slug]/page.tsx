import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { comparisons } from "@/landing/seo-pages";
import { ComparePageView } from "@/landing/compare-page";

// Static: one page per entry in seo-pages.ts; any other slug is a 404 (notFound below).
export function generateStaticParams() {
  return comparisons.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/vs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = comparisons.find((p) => p.slug === slug);
  if (!page) return {};
  return { title: `${page.title}: pricing model, networks and AI assistants`, description: page.description, alternates: { canonical: `/vs/${page.slug}` } };
}

export default async function Page({ params }: PageProps<"/vs/[slug]">) {
  const { slug } = await params;
  const page = comparisons.find((p) => p.slug === slug);
  if (!page) notFound();
  return <ComparePageView page={page} />;
}
