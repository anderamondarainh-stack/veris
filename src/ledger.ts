// Contabilidad de coste en memoria. Cada request resuelto anota tokens y coste
// estimado por modelo. Expuesto en /v1/usage para que veas en qué se va el
// dinero y qué tanto te ahorra el router. No persiste (reinicio = reset);
// para producción, volcar a SQLite/Postgres detrás de la misma interfaz.

export interface UsageEntry {
  model: string;
  provider: string;
  task: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface UsageRollup {
  totalRequests: number;
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byModel: Record<string, { requests: number; costUsd: number; tokens: number }>;
}

export class Ledger {
  private entries: UsageEntry[] = [];
  private cap: number;

  constructor(cap = 10_000) {
    this.cap = cap;
  }

  record(e: UsageEntry): void {
    this.entries.push(e);
    if (this.entries.length > this.cap) this.entries.shift(); // ventana deslizante
  }

  rollup(): UsageRollup {
    const r: UsageRollup = {
      totalRequests: this.entries.length,
      totalCostUsd: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      byModel: {},
    };
    for (const e of this.entries) {
      r.totalCostUsd += e.costUsd;
      r.totalPromptTokens += e.promptTokens;
      r.totalCompletionTokens += e.completionTokens;
      const m = (r.byModel[e.model] ??= { requests: 0, costUsd: 0, tokens: 0 });
      m.requests++;
      m.costUsd += e.costUsd;
      m.tokens += e.promptTokens + e.completionTokens;
    }
    // Redondeo amable para la API.
    r.totalCostUsd = Number(r.totalCostUsd.toFixed(6));
    for (const m of Object.values(r.byModel)) m.costUsd = Number(m.costUsd.toFixed(6));
    return r;
  }
}
