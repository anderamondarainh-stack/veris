// Carga .env sin dependencias. Node no lee .env por sí solo, y el README pide
// `cp .env.example .env` + arrancar; sin esto el usuario vería "ningún provider".
//
// Reglas: una línea KEY=VALUE por entrada. Se ignoran líneas vacías y las que
// empiezan por `#`. Se admite `export KEY=...`. Las comillas envolventes
// (simples o dobles) se eliminan. Las variables ya presentes en el entorno real
// tienen prioridad (no se sobreescriben) — el entorno manda sobre el fichero.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(path = ".env"): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return; // sin .env: perfectamente válido, las vars vienen del entorno real.
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed;

    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    // El entorno real tiene prioridad: no pisamos lo ya definido.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
