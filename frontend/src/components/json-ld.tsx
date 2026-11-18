// Structured data for search engines. `<` is escaped so text inside the data (an FAQ answer, a page
// title) can never close the <script> tag early.
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
