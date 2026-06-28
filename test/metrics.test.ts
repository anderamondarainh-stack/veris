import { describe, it, expect } from "vitest";
import { Metrics } from "../src/metrics.js";

describe("Metrics render", () => {
  it("refleja requests, usage, latencia y errores tras registrarlos", () => {
    const m = new Metrics();
    m.recordRequest("openai/gpt-4o");
    m.recordRequest("openai/gpt-4o");
    m.recordUsage(100, 50, 0.0012);
    m.recordLatency(80); // cae en el bucket le="100"
    m.recordError();

    const out = m.render();

    // Contadores básicos.
    expect(out).toContain("veris_requests_total 2");
    expect(out).toContain("veris_errors_total 1");
    expect(out).toContain('veris_requests_by_model_total{model="openai/gpt-4o"} 2');

    // Tokens.
    expect(out).toContain('veris_tokens_total{direction="input"} 100');
    expect(out).toContain('veris_tokens_total{direction="output"} 50');

    // Coste con 6 decimales.
    expect(out).toContain("veris_cost_usd_total 0.001200");

    // Histograma de latencia: 80ms entra en el bucket le="100" y acumula.
    expect(out).toContain('veris_request_latency_ms_bucket{le="100"} 1');
    expect(out).toContain('veris_request_latency_ms_bucket{le="+Inf"} 1');
    expect(out).toContain("veris_request_latency_ms_count 1");
    expect(out).toContain("veris_request_latency_ms_sum 80.0");
  });

  it("latencia alta cae en el bucket +Inf (le finito permanece en 0)", () => {
    const m = new Metrics();
    m.recordLatency(99999);
    const out = m.render();
    expect(out).toContain('veris_request_latency_ms_bucket{le="50"} 0');
    expect(out).toContain('veris_request_latency_ms_bucket{le="+Inf"} 1');
  });
});
