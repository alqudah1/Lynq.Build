/**
 * A live-region status/error message (Step 5B: "status messages use
 * appropriate live regions"). Errors use `role="alert"` (implicit
 * assertive live region — interrupts, since it names a failed action);
 * success/info uses `role="status"` (implicit polite live region).
 */
export function StatusMessage({ message, tone }: { message: string; tone: "success" | "error" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-sm border px-4 py-3 text-sm ${tone === "error" ? "border-danger/30 bg-danger-wash text-danger" : "border-success/30 bg-success-wash text-success"}`}
    >
      {message}
    </p>
  );
}
