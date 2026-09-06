import "server-only";

// Arcubed Label — minimal server-side logging for catalog/order failures.
// No log aggregation service wired up yet (Phase 1 scope) — this writes
// structured lines to stdout/stderr, which Vercel already captures and makes
// searchable in the project's Logs tab. That's enough to diagnose a failure
// without standing up new infrastructure.
//
// HARD RULE: never pass secrets, service-role keys, full customer records, or
// payment details to these functions. Every call site in this codebase logs
// only identifiers (product id/slug, order id) and a short error message —
// never `input`/`req.body` wholesale. If a future call site is tempted to log
// a whole object "just in case", that's the signal to add a specific field
// here instead, not to widen what's accepted.

type LogContext = Record<string, string | number | boolean | null | undefined>;

function write(level: "error" | "warn", area: string, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    area,
    message,
    ...context,
  };
   
  console[level](JSON.stringify(entry));
}

export function logCatalogError(message: string, context: LogContext & { operation: string }) {
  write("error", "catalog", message, context);
}

export function logCatalogWarning(message: string, context?: LogContext) {
  write("warn", "catalog", message, context);
}

export function logOrderError(message: string, context: { orderId?: string; operation: string }) {
  write("error", "order", message, context);
}
