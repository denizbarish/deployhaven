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

interface RunIdRow {
  runId: string;
  createdAt: Date;
  id?: string;
}

export function isTerminalRun(rows: RunRow[]): boolean {
  if (rows.some((r) => r.status === "failed")) return true;
  return rows.some(
    (r) => r.step === FINAL_MODULE_ID && (r.status === "done" || r.status === "skipped"),
  );
}

/**
 * Important #1: bir sunucunun satırları arasından EN SON çalışmanın runId'sini seçer
 * (en büyük createdAt'a sahip satırın runId'si). Satır yoksa null döner.
 * Saf ve test edilebilir; ilerleme/SSE gruplaması bunun üstüne kurulur.
 */
export function latestRunId(rows: RunIdRow[]): string | null {
  let latest: RunIdRow | null = null;
  for (const row of rows) {
    if (!latest || isNewer(row, latest)) latest = row;
  }
  return latest?.runId ?? null;
}

/**
 * Deterministik "daha yeni" kıyası: önce createdAt, eşitlikte id (ikincil tie-break).
 * Aynı milisaniyede iki farklı çalışmanın satırı gelirse sonuç kararlı olur.
 */
function isNewer(a: RunIdRow, b: RunIdRow): boolean {
  const ta = a.createdAt.getTime();
  const tb = b.createdAt.getTime();
  if (ta !== tb) return ta > tb;
  return (a.id ?? "") > (b.id ?? "");
}
