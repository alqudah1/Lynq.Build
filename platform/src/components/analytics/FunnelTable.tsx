import { Card } from "@/components/ui/Card";
import type { FunnelResult } from "@/lib/analytics-os/funnels";

/** A deterministic stage-count funnel as an accessible table — counts and conversion rates only, text-first (no chart dependency), matching every stage's own real canonical source. */
export function FunnelTable({ funnel }: { funnel: FunnelResult }) {
  return (
    <Card padding="sm" className="overflow-x-auto">
      <div className="mb-2 flex flex-col gap-0.5">
        <p className="text-xs uppercase tracking-[0.15em] text-subtle">{funnel.name}</p>
        <p className="text-xs text-subtle">{funnel.description}</p>
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-[0.1em] text-subtle">
            <th scope="col" className="py-2 pr-4">Stage</th>
            <th scope="col" className="py-2 pr-4">Count</th>
            <th scope="col" className="py-2">Conversion from previous stage</th>
          </tr>
        </thead>
        <tbody>
          {funnel.stages.map((stage, idx) => {
            const step = funnel.steps.find((s) => s.toStageKey === stage.key);
            return (
              <tr key={stage.key} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4 text-foreground">{stage.label}</td>
                <td className="py-2 pr-4 text-muted">{stage.count}</td>
                <td className="py-2 text-subtle">{idx === 0 ? "—" : step?.conversionRatePercent !== null && step?.conversionRatePercent !== undefined ? `${step.conversionRatePercent.toFixed(1)}%` : "no prior-stage records"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
