import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VirtualKeyStore } from "../src/virtual-keys.js";

describe("VirtualKeyStore · creación y validación", () => {
  it("create genera una key vk-+32hex y la valida", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "app-1" });
    expect(vk.key).toMatch(/^vk-[0-9a-f]{32}$/);
    expect(vk.label).toBe("app-1");
    expect(vk.spentUsd).toBe(0);
    expect(vk.revoked).toBe(false);
    expect(store.validate(vk.key)).toEqual(vk);
  });

  it("validate devuelve undefined para clave inexistente", () => {
    const store = new VirtualKeyStore();
    expect(store.validate("vk-noexiste")).toBeUndefined();
  });

  it("now() inyectado fija createdAt", () => {
    const store = new VirtualKeyStore(undefined, () => 12345);
    expect(store.create({ label: "x" }).createdAt).toBe(12345);
  });
});

describe("VirtualKeyStore · presupuesto", () => {
  it("checkBudget true sin budget definido", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "ilimitada" });
    expect(store.checkBudget(vk.key)).toBe(true);
    store.recordSpend(vk.key, 9999);
    expect(store.checkBudget(vk.key)).toBe(true);
  });

  it("checkBudget pasa a false al superar el tope tras recordSpend", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "topada", budgetUsd: 1 });
    expect(store.checkBudget(vk.key)).toBe(true);
    store.recordSpend(vk.key, 0.5);
    expect(store.checkBudget(vk.key)).toBe(true);
    store.recordSpend(vk.key, 0.6); // total 1.1 >= 1
    expect(store.checkBudget(vk.key)).toBe(false);
  });
});

describe("VirtualKeyStore · rate limit", () => {
  it("rpm undefined = sin límite", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "sin-limite" });
    for (let i = 0; i < 100; i++) expect(store.checkRateLimit(vk.key, 1000)).toBe(true);
  });

  it("rpm=2 → la 3ª en la misma ventana falla, vuelve tras 60s", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "rl", rpm: 2 });
    expect(store.checkRateLimit(vk.key, 1_000)).toBe(true);
    expect(store.checkRateLimit(vk.key, 2_000)).toBe(true);
    expect(store.checkRateLimit(vk.key, 3_000)).toBe(false); // 3ª en ventana
    // Tras pasar la ventana de 60s respecto a las dos primeras, vuelve a permitir.
    expect(store.checkRateLimit(vk.key, 65_000)).toBe(true);
  });
});

describe("VirtualKeyStore · modelos permitidos", () => {
  it("models undefined = todos permitidos", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "all" });
    expect(store.allowsModel(vk.key, "gpt-4o")).toBe(true);
  });

  it("allowsModel restringe a la lista", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "restr", models: ["gpt-4o-mini"] });
    expect(store.allowsModel(vk.key, "gpt-4o-mini")).toBe(true);
    expect(store.allowsModel(vk.key, "gpt-4o")).toBe(false);
  });
});

describe("VirtualKeyStore · revoke", () => {
  it("revoke invalida la clave", () => {
    const store = new VirtualKeyStore();
    const vk = store.create({ label: "r" });
    expect(store.validate(vk.key)).toBeDefined();
    store.revoke(vk.key);
    expect(store.validate(vk.key)).toBeUndefined();
    // Sigue listada (con revoked=true), pero ya no valida.
    expect(store.list().find((k) => k.key === vk.key)?.revoked).toBe(true);
  });
});

describe("VirtualKeyStore · persistencia a fichero", () => {
  it("persiste y recarga desde JSON (escritura atómica)", () => {
    const dir = mkdtempSync(join(tmpdir(), "vkeys-"));
    const file = join(dir, "vkeys.json");
    try {
      const a = new VirtualKeyStore(file);
      const vk = a.create({ label: "persistida", budgetUsd: 5, rpm: 10 });
      a.recordSpend(vk.key, 2);
      expect(existsSync(file)).toBe(true);

      // Nueva instancia: carga del fichero al construir.
      const b = new VirtualKeyStore(file);
      const loaded = b.validate(vk.key);
      expect(loaded?.label).toBe("persistida");
      expect(loaded?.spentUsd).toBe(2);
      expect(loaded?.budgetUsd).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
