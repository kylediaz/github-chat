export const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ONE_SECOND_MS = 1000;
export const STATUS_UPDATE_THRESHOLD_MS = 2000;

export function isTerminalStatus(status: string | null): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
