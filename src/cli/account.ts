// ─────────────────────────────────────────────────────────────────────────
//  CLI del account-provider  ·  `veris account <login|test>`
// ─────────────────────────────────────────────────────────────────────────
//  Subcomandos para preparar y probar la "zona gris" sin levantar el gateway:
//    veris account login [openai]            → login manual (perfil persistente)
//    veris account test  [openai] [prompt…]  → un ida-y-vuelta real de prueba
import { loadEnvFile } from "../env.js";
import { runLogin } from "../providers/account-login.js";
import { AccountProvider } from "../providers/account.js";

loadEnvFile();

const profileBase =
  process.env.VERIS_PROFILE_DIR ?? process.env.BYOA_PROFILE_DIR ?? ".browser-profiles";

function parseArgs() {
  const args = process.argv.slice(2); // p. ej. ["account","login","openai"]
  const idx = args[0] === "account" ? 1 : 0;
  return { sub: args[idx], rest: args.slice(idx + 1) };
}

function accountOpts(upstream: string) {
  return {
    enabled: true,
    profileDir: `${profileBase}/${upstream}`,
    headless: process.env.ACCOUNT_HEADLESS === "true",
    humanize: process.env.ACCOUNT_HUMANIZE !== "false",
    stealth: process.env.ACCOUNT_STEALTH === "true",
  };
}

async function main() {
  const { sub, rest } = parseArgs();

  if (sub === "login") {
    const upstream = rest[0] ?? "openai";
    const ok = await runLogin(upstream, { profileBaseDir: profileBase });
    process.exit(ok ? 0 : 1);
  }

  if (sub === "test") {
    const upstream = rest[0] ?? "openai";
    const prompt = rest.slice(1).join(" ") || "Responde EXACTAMENTE con la palabra: PONG";
    const provider = new AccountProvider(upstream as "openai" | "anthropic" | "gemini", accountOpts(upstream));
    if (!provider.isReady()) {
      console.error(`account:${upstream} no está listo (¿hay driver para '${upstream}'?).`);
      process.exit(1);
    }
    console.log(`\n  Enviando prompt de prueba a account:${upstream}…\n  > ${prompt}\n`);
    const res = await provider.complete(upstream, {
      model: upstream,
      messages: [{ role: "user", content: prompt }],
    } as any);
    console.log("  ─── respuesta de la cuenta ───");
    console.log("  " + (res.choices[0]?.message.content ?? "(vacía)").replace(/\n/g, "\n  "));
    console.log("  ──────────────────────────────\n");
    await provider.dispose();
    process.exit(0);
  }

  console.log("Uso:");
  console.log("  veris account login [openai]            login manual (perfil persistente local)");
  console.log("  veris account test  [openai] [prompt…]  ida-y-vuelta real de prueba");
  process.exit(2);
}

main().catch((e) => {
  console.error("[account] error:", e?.message ?? e);
  process.exit(1);
});
