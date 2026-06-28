import { describe, it, expect } from "vitest";
import { applyCatalogOverride, findModel } from "../src/router/catalog.js";

describe("applyCatalogOverride (MODELS_FILE)", () => {
  it("aplica specs válidos (añade nuevos y reemplaza existentes)", () => {
    const r = applyCatalogOverride([
      {
        id: "test/nuevo-modelo",
        provider: "test",
        upstreamId: "nuevo-1",
        good_at: ["chat"],
        input_per_mtok: 1,
        output_per_mtok: 2,
        context: 8000,
        vision: false,
      },
    ]);
    expect(r.applied).toBe(1);
    expect(findModel("test/nuevo-modelo")?.upstreamId).toBe("nuevo-1");
  });

  it("ignora specs inválidos (faltan campos o id peligroso)", () => {
    const r = applyCatalogOverride([
      { id: "sin-numeros", provider: "x", upstreamId: "y" }, // faltan precios/context
      { id: 'mal"id\n', provider: "x", upstreamId: "y", input_per_mtok: 1, output_per_mtok: 1, context: 1 }, // id con comillas/saltos
      { provider: "x", upstreamId: "y", input_per_mtok: 1, output_per_mtok: 1, context: 1 }, // sin id
    ]);
    expect(r.applied).toBe(0);
    expect(r.skipped).toBe(3);
  });

  it("lanza si no es un array", () => {
    expect(() => applyCatalogOverride({ id: "x" } as any)).toThrow();
  });
});
