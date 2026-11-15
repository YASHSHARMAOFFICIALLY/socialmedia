import { product } from "../content";
import { Window } from "../components/window";
import { BrandGlyph, brandColor } from "../components/brand-glyph";

// Per-network metrics as bars without figures: the point is which columns get a total.
// Likes and comments are summed across networks; views are not, and the total row says so.
export function AnalyticsScreen() {
  const a = product.analytics;
  return (
    <Window
      title="Analytics"
      label="Distora analytics comparing Instagram, LinkedIn and X: likes and comments have a total across networks, views show 'Not added up' because each network counts them differently."
    >
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="text-muted">
            <th className="px-4 py-3 font-medium sm:px-6">Network</th>
            {a.columns.map((col) => (
              <th key={col.key} className="px-3 py-3 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.rows.map((row) => (
            <tr key={row.network} className="border-t border-line">
              <td className="px-4 py-4 font-medium text-ink sm:px-6">
                <span className="flex items-center gap-2">
                  <BrandGlyph name={row.network} />
                  {row.network}
                </span>
              </td>
              {a.columns.map((col) => (
                <td key={col.key} className="px-3 py-4">
                  <span className="block h-2 rounded-full bg-ink/[0.06]">
                    <span className="block h-2 rounded-full" style={{ width: `${row[col.key] * 100}%`, backgroundColor: brandColor(row.network) }} />
                  </span>
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="px-4 py-4 font-medium text-ink sm:px-6">{a.totalLabel}</td>
            {a.columns.map((col) => (
              <td key={col.key} className="px-3 py-4">
                {col.summed ? (
                  <span className="block h-2 rounded-full bg-ink" />
                ) : (
                  <span className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-800">{a.notSummed}</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Window>
  );
}
