import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { dirname } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
//  VIRTUAL KEYS  ·  multi-tenant para Veris
// ─────────────────────────────────────────────────────────────────────────
//  El dueño de Veris emite "claves virtuales" (vk-...) para terceros sin
//  compartir las API keys reales del upstream. Cada clave lleva su propio
//  presupuesto (USD), rate-limit (req/min) y, opcionalmente, una lista de
//  modelos permitidos. El gasto se atribuye por clave.
//
//  Persistencia opcional a fichero JSON con el MISMO patrón atómico que
//  credentials/store.ts (escribe a tmp + rename). Aquí NO se cifra: una clave
//  virtual no es un secreto del upstream, es un token emitido por nosotros y
//  revocable; el valor está en poder revocarlo, no en ocultarlo en disco.

export interface VirtualKey {
  key: string;
  label: string;
  budgetUsd?: number;
  rpm?: number;
  models?: string[];
  spentUsd: number;
  createdAt: number;
  revoked: boolean;
}

export interface CreateKeyInput {
  label: string;
  budgetUsd?: number;
  rpm?: number;
  models?: string[];
}

export class VirtualKeyStore {
  private keys = new Map<string, VirtualKey>();
  // Marcas de tiempo (ms) de las requests recientes por clave, para el
  // rate-limit por ventana deslizante de 60s. No se persiste (es efímero).
  private hits = new Map<string, number[]>();

  constructor(
    private path?: string,
    private now: () => number = Date.now,
  ) {
    if (this.path && existsSync(this.path)) this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const arr = JSON.parse(readFileSync(this.path!, "utf8")) as VirtualKey[];
      for (const k of arr) this.keys.set(k.key, k);
    } catch (e: any) {
      console.warn(`  ⚠️  no se pudo leer VKEYS_FILE (${this.path}): ${e.message}`);
    }
  }

  private persist(): void {
    if (!this.path) return;
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = JSON.stringify([...this.keys.values()], null, 2);
    // Escritura atómica: tmp en el mismo directorio + rename (rename es atómico
    // dentro del mismo volumen, así un crash a media escritura no corrompe).
    const tmp = `${this.path}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, data, "utf8");
    try {
      chmodSync(tmp, 0o600); // no-op en Windows
    } catch {
      /* Windows ignora chmod */
    }
    renameSync(tmp, this.path);
  }

  // Genera "vk-" + 32 hex aleatorios (16 bytes).
  private generateKey(): string {
    return `vk-${randomBytes(16).toString("hex")}`;
  }

  create(input: CreateKeyInput): VirtualKey {
    const vk: VirtualKey = {
      key: this.generateKey(),
      label: input.label,
      budgetUsd: input.budgetUsd,
      rpm: input.rpm,
      models: input.models,
      spentUsd: 0,
      createdAt: this.now(),
      revoked: false,
    };
    this.keys.set(vk.key, vk);
    this.persist();
    return vk;
  }

  // Existe y no revocada → la devuelve; si no, undefined.
  validate(key: string): VirtualKey | undefined {
    const vk = this.keys.get(key);
    if (!vk || vk.revoked) return undefined;
    return vk;
  }

  // true si no hay presupuesto definido o aún queda margen.
  checkBudget(key: string): boolean {
    const vk = this.keys.get(key);
    if (!vk) return false;
    if (vk.budgetUsd === undefined) return true;
    return vk.spentUsd < vk.budgetUsd;
  }

  recordSpend(key: string, usd: number): void {
    const vk = this.keys.get(key);
    if (!vk) return;
    vk.spentUsd += usd;
    this.persist();
  }

  // Ventana deslizante de 60s contra rpm. rpm undefined = sin límite.
  // Registra el hit si lo permite (de modo que la N+1ª en la ventana falla).
  checkRateLimit(key: string, nowMs: number = this.now()): boolean {
    const vk = this.keys.get(key);
    if (!vk) return false;
    if (vk.rpm === undefined) return true;
    const windowStart = nowMs - 60_000;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (recent.length >= vk.rpm) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return true;
  }

  // models undefined = todos los modelos permitidos.
  allowsModel(key: string, modelId: string): boolean {
    const vk = this.keys.get(key);
    if (!vk) return false;
    if (vk.models === undefined) return true;
    return vk.models.includes(modelId);
  }

  // Lista las claves (incluye la key entera: el dueño/admin ya la conoce; no
  // hay secreto extra que ocultar más allá de los propios campos).
  list(): VirtualKey[] {
    return [...this.keys.values()];
  }

  revoke(key: string): void {
    const vk = this.keys.get(key);
    if (!vk) return;
    vk.revoked = true;
    this.persist();
  }
}
