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
  totalRequests: number; // total histórico (no se trunca con la ventana)
  totalCostUsd: number; // coste histórico acumulado (no se trunca)
  totalPromptTokens: number;
  totalCompletionTokens: number;
  // Desglose por modelo limitado a la ventana reciente de entradas.
  recentWindow: number;
  byModel: Record<string, { requests: number; costUsd: number; tokens: number }>;
}

export class Ledger {
  private entries: UsageEntry[] = [];
  private cap: number;
  // Totales históricos: nunca se truncan, para que el tope de gasto y /v1/usage
  // sean correctos aunque la ventana de detalle (`entries`) descarte antiguas.
  private totalSeen = 0;
  private totalCostEver = 0;
  private totalPromptEver = 0;
  private totalCompletionEver = 0;

  constructor(cap = 10_000) {
    this.cap = cap;
  }

  record(e: UsageEntry): void {
    this.totalSeen++;
    this.totalCostEver += e.costUsd;
    this.totalPromptEver += e.promptTokens;
    this.totalCompletionEver += e.completionTokens;
    this.entries.push(e);
    if (this.entries.length > this.cap) this.entries.shift(); // ventana deslizante (solo detalle byModel)
  }

  // Coste total histórico (lo usa el tope de gasto). Nunca decrece.
  totalCost(): number {
    return this.totalCostEver;
  }

  rollup(): UsageRollup {
    const r: UsageRollup = {
      totalRequests: this.totalSeen,
      totalCostUsd: Number(this.totalCostEver.toFixed(6)),
      totalPromptTokens: this.totalPromptEver,
      totalCompletionTokens: this.totalCompletionEver,
      recentWindow: this.entries.length,
      byModel: {},
    };
    for (const e of this.entries) {
      const m = (r.byModel[e.model] ??= { requests: 0, costUsd: 0, tokens: 0 });
      m.requests++;
      m.costUsd += e.costUsd;
      m.tokens += e.promptTokens + e.completionTokens;
    }
    for (const m of Object.values(r.byModel)) m.costUsd = Number(m.costUsd.toFixed(6));
    return r;
  }
}
