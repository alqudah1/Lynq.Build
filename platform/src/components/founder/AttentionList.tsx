import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { AttentionItem } from "@/lib/founder-os/attention-engine";

const SEVERITY_TONE: Record<string, BadgeTone> = { urgent: "danger", attention: "warning", info: "info" };

/** Deterministic attention items — severity is always shown as TEXT (the badge label itself), never color alone. */
export function AttentionList({ items, emptyLabel = "Nothing needs attention right now." }: { items: AttentionItem[]; emptyLabel?: string }) {
  if (items.length === 0) return <Card className="text-sm text-subtle">{emptyLabel}</Card>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <Card padding="sm" className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">{item.title}</span>
              <Badge tone={SEVERITY_TONE[item.severity] ?? "neutral"}>{item.severity}</Badge>
            </div>
            <p className="text-xs text-subtle">{item.explanation}</p>
            <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-subtle">
              <span>{item.domain}</span>
              <span aria-hidden="true">·</span>
              <span>{item.reasonCode}</span>
              {item.dueAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>due {item.dueAt.slice(0, 10)}</span>
                </>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
