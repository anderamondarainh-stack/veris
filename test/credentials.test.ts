import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encrypt, decrypt, CredentialStore, machineDerivedKey } from "../src/credentials/store.js";

describe("encrypt/decrypt", () => {
  it("ida y vuelta con la clave correcta", () => {
    const blob = encrypt("secreto-de-sesión", "master-123");
    expect(decrypt(blob, "master-123")).toBe("secreto-de-sesión");
  });
  it("falla con clave incorrecta (GCM autentica)", () => {
    const blob = encrypt("x", "clave-buena");
    expect(() => decrypt(blob, "clave-mala")).toThrow();
  });
  it("falla si el ciphertext fue manipulado", () => {
    const blob = encrypt("x", "k");
    blob.data = blob.data.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(() => decrypt(blob, "k")).toThrow();
  });
  it("cada cifrado usa IV/salt distintos (no determinista)", () => {
    const a = encrypt("mismo", "k");
    const b = encrypt("mismo", "k");
    expect(a.data).not.toBe(b.data);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe("CredentialStore", () => {
  it("persiste y recupera cifrado en disco", () => {
    const dir = mkdtempSync(join(tmpdir(), "byoa-cred-"));
    try {
      const path = join(dir, "creds.enc");
      const s1 = new CredentialStore(path, "master");
      s1.set("openai.cookie", "abc123");
      s1.set("openai.token", "tok");

      // Nueva instancia (lee de disco) con la misma clave.
      const s2 = new CredentialStore(path, "master");
      expect(s2.get("openai.cookie")).toBe("abc123");
      expect(s2.keys().sort()).toEqual(["openai.cookie", "openai.token"]);

      s2.delete("openai.token");
      const s3 = new CredentialStore(path, "master");
      expect(s3.get("openai.token")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("machineDerivedKey persiste un token aleatorio y es estable entre llamadas", () => {
    const dir = mkdtempSync(join(tmpdir(), "byoa-mk-"));
    try {
      const tokenPath = join(dir, "machine.key");
      const k1 = machineDerivedKey(tokenPath);
      const k2 = machineDerivedKey(tokenPath);
      expect(k1).toBe(k2); // mismo token persistido → misma clave
      // No es trivialmente recomputable: contiene 64 hex de token aleatorio.
      expect(k1).toMatch(/[0-9a-f]{64}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("otra clave maestra no puede leer el store", () => {
    const dir = mkdtempSync(join(tmpdir(), "byoa-cred-"));
    try {
      const path = join(dir, "creds.enc");
      new CredentialStore(path, "clave-A").set("k", "v");
      const intruso = new CredentialStore(path, "clave-B");
      expect(() => intruso.get("k")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
