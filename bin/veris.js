#!/usr/bin/env node
// CLI de Veris: arranca el gateway compilado (dist/index.js).
// El servidor se levanta como efecto de importar el módulo.
import("../dist/index.js").catch((err) => {
  console.error("[veris] No se pudo arrancar. ¿Has ejecutado `npm run build`?");
  console.error(err);
  process.exit(1);
});
