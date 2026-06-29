import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostname, userInfo } from "node:os";

// ─────────────────────────────────────────────────────────────────────────
//  STORE DE CREDENCIALES CIFRADO  ·  local-first, nunca sale de la máquina
// ─────────────────────────────────────────────────────────────────────────
//  Cifra secretos (cookies de sesión, tokens del account-provider, API keys)
//  con AES-256-GCM. La clave se deriva por scrypt de la clave maestra del
//  usuario (VERIS_MASTER_KEY). Sin esa clave, el fichero en disco es inútil.
//
//  Principio: el dueño del proyecto NUNCA ve estos datos. Viven cifrados en
//  ./.byoa/ en la máquina del usuario. Si no hay clave maestra, se deriva una
//  de la máquina (cómodo pero más débil: vale para tokens de bajo valor, no
//  para credenciales críticas — por eso se avisa).

const ALGO = "aes-256-gcm";
// N=2^15 (recomendación interactiva actual de OWASP). r=8, p=1.
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

interface EncryptedBlob {
  v: 1;
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex
  data: string; // hex (ciphertext)
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, 32, SCRYPT_PARAMS);
}

export function encrypt(plaintext: string, masterKey: string): EncryptedBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(12); // GCM: 96 bits recomendado
  const key = deriveKey(masterKey, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: data.toString("hex"),
  };
}

export function decrypt(blob: EncryptedBlob, masterKey: string): string {
  const salt = Buffer.from(blob.salt, "hex");
  const key = deriveKey(masterKey, salt);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "hex"));
  decipher.setAuthTag(Buffer.from(blob.tag, "hex"));
  // Si la clave es incorrecta o el fichero fue manipulado, final() lanza:
  // GCM autentica el ciphertext (integridad + confidencialidad).
  return Buffer.concat([decipher.update(Buffer.from(blob.data, "hex")), decipher.final()]).toString("utf8");
}

// Store persistente de un mapa secreto bajo una ruta de fichero. Cada `set`
// reescribe el fichero cifrado completo (los secretos son pocos y pequeños).
export class CredentialStore {
  private cache: Record<string, string> | null = null;

  constructor(
    private path: string,
    private masterKey: string,
  ) {}

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.path)) return (this.cache = {});
    const blob = JSON.parse(readFileSync(this.path, "utf8")) as EncryptedBlob;
    this.cache = JSON.parse(decrypt(blob, this.masterKey));
    return this.cache!;
  }

  private persist(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const blob = encrypt(JSON.stringify(this.cache ?? {}), this.masterKey);
    // Escritura atómica: escribe a un temporal en el mismo directorio y renombra.
    // Si el proceso muere a media escritura, el fichero original queda intacto
    // en vez de corromperse (rename es atómico dentro del mismo volumen).
    const tmp = `${this.path}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(blob), "utf8");
    try {
      chmodSync(tmp, 0o600); // permisos restrictivos antes de publicar (no-op en Windows)
    } catch {
      /* Windows ignora chmod */
    }
    renameSync(tmp, this.path);
  }

  get(key: string): string | undefined {
    return this.load()[key];
  }

  set(key: string, value: string): void {
    this.load()[key] = value;
    this.persist();
  }

  delete(key: string): void {
    const data = this.load();
    delete data[key];
    this.persist();
  }

  keys(): string[] {
    return Object.keys(this.load());
  }
}

// Clave maestra derivada de la máquina cuando el usuario no fijó VERIS_MASTER_KEY.
// NO se basa solo en hostname/usuario (públicos): genera y persiste un token
// aleatorio de 32 bytes en `tokenPath` (permisos 0600) y lo mezcla con el
// contexto de la máquina. Sigue siendo más débil que una clave maestra que el
// usuario recuerde (quien lea el fichero del token puede derivarla), pero ya no
// es trivialmente recomputable. Apta para secretos de valor medio-bajo.
export function machineDerivedKey(tokenPath = join(".byoa", "machine.key")): string {
  let token: string;
  if (existsSync(tokenPath)) {
    token = readFileSync(tokenPath, "utf8").trim();
  } else {
    token = randomBytes(32).toString("hex");
    const dir = dirname(tokenPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tokenPath, token, "utf8");
    try {
      chmodSync(tokenPath, 0o600);
    } catch {
      /* Windows ignora chmod */
    }
  }
  return `${hostname()}::${userInfo().username}::${token}`;
}
