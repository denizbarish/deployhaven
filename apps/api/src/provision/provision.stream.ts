/**
 * SSE stream sonlanma mantığı (saf, test edilebilir) - FIND-004 kalanı.
 * Pipeline sırasındaki son modül `traefik`. Bir çalışma şu durumlarda terminaldir:
 *  - herhangi bir adım `failed` (pipeline durur), ya da
 *  - son modül (`traefik`) `done` veya `skipped` (pipeline tamamlandı).
 */
export const FINAL_MODULE_ID = "traefik";

/** interval(2000) için üst sınır: ~10 dakika (300 tick). Sonsuz polling'e karşı güvenlik ağı. */
export const SSE_MAX_TICKS = 300;

interface RunRow {
  step: string;
  status: string;
}

export function isTerminalRun(rows: RunRow[]): boolean {
  if (rows.some((r) => r.status === "failed")) return true;
  return rows.some(
    (r) => r.step === FINAL_MODULE_ID && (r.status === "done" || r.status === "skipped"),
  );
}
