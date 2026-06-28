// Métricas en proceso, expuestas en /metrics en formato Prometheus. Sin
// dependencias: contadores y un histograma de latencia simples. Suficiente para
// observabilidad básica (requests, errores, tokens, coste, latencia) y para
// enganchar Grafana/alertas sin montar nada pesado.

const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

export class Metrics {
  private requests = 0;
  private errors = 0;
  private byModel = new Map<string, number>();
  private tokensIn = 0;
  private tokensOut = 0;
  private costUsd = 0;
  private latencyBuckets = new Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
  private latencySum = 0;
  private latencyCount = 0;

  recordRequest(model: string): void {
    this.requests++;
    this.byModel.set(model, (this.byModel.get(model) ?? 0) + 1);
  }
  recordError(): void {
    this.errors++;
  }
  recordUsage(tokensIn: number, tokensOut: number, costUsd: number): void {
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    this.costUsd += costUsd;
  }
  recordLatency(ms: number): void {
    this.latencySum += ms;
    this.latencyCount++;
    let i = LATENCY_BUCKETS_MS.findIndex((b) => ms <= b);
    if (i < 0) i = LATENCY_BUCKETS_MS.length;
    this.latencyBuckets[i]++;
  }

  // Render en exposición Prometheus.
  render(): string {
    const lines: string[] = [];
    lines.push("# HELP veris_requests_total Total de requests de chat.");
    lines.push("# TYPE veris_requests_total counter");
    lines.push(`veris_requests_total ${this.requests}`);

    lines.push("# HELP veris_errors_total Total de requests con error.");
    lines.push("# TYPE veris_errors_total counter");
    lines.push(`veris_errors_total ${this.errors}`);

    lines.push("# HELP veris_requests_by_model_total Requests por modelo.");
    lines.push("# TYPE veris_requests_by_model_total counter");
    for (const [model, n] of this.byModel) {
      lines.push(`veris_requests_by_model_total{model="${model}"} ${n}`);
    }

    lines.push("# HELP veris_tokens_total Tokens procesados.");
    lines.push("# TYPE veris_tokens_total counter");
    lines.push(`veris_tokens_total{direction="input"} ${this.tokensIn}`);
    lines.push(`veris_tokens_total{direction="output"} ${this.tokensOut}`);

    lines.push("# HELP veris_cost_usd_total Coste estimado acumulado en USD.");
    lines.push("# TYPE veris_cost_usd_total counter");
    lines.push(`veris_cost_usd_total ${this.costUsd.toFixed(6)}`);

    lines.push("# HELP veris_request_latency_ms Latencia de request (histograma).");
    lines.push("# TYPE veris_request_latency_ms histogram");
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      cumulative += this.latencyBuckets[i];
      lines.push(`veris_request_latency_ms_bucket{le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`);
    }
    cumulative += this.latencyBuckets[LATENCY_BUCKETS_MS.length];
    lines.push(`veris_request_latency_ms_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`veris_request_latency_ms_sum ${this.latencySum.toFixed(1)}`);
    lines.push(`veris_request_latency_ms_count ${this.latencyCount}`);

    return lines.join("\n") + "\n";
  }
}
