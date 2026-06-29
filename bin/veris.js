#!/usr/bin/env node
// CLI de Veris.
//   veris                     → arranca el gateway (dist/index.js)
//   veris account <login|test> → utilidades del account-provider (zona gris ToS)
const argv = process.argv.slice(2);
const target = argv[0] === "account" ? "../dist/cli/account.js" : "../dist/index.js";

import(target).catch((err) => {
  console.error("[veris] No se pudo arrancar. ¿Has ejecutado `npm run build`?");
  console.error(err);
  process.exit(1);
});
