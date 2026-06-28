# Aviso legal (Disclaimer)

byoa-gateway es una herramienta de software ofrecida bajo licencia
[MIT](LICENSE), **sin garantía de ningún tipo**.

## Sobre el account-provider

El gateway incluye un componente opcional llamado **account-provider** que
automatiza la interfaz web de chat de proveedores (OpenAI, Anthropic, Google)
para usar una **suscripción de cuenta** (tipo Plus/Pro) como si fuera una API.

Debes entender lo siguiente antes de activarlo:

1. **Viola los Términos de Servicio** de OpenAI, Anthropic y Google. Estos
   prohíben el acceso automatizado a sus interfaces de chat con cuentas de
   suscripción.
2. **Puede provocar la suspensión o el baneo** permanente de tu cuenta en esos
   servicios.
3. Está **desactivado por defecto** (`ACCOUNT_PROVIDER_ENABLED=false`). El uso
   recomendado del proyecto es **BYOK** (tu propia API key oficial), que es
   limpio y está dentro de los ToS.
4. Si decides activarlo, lo haces **bajo tu entera y exclusiva
   responsabilidad**. Eres el único responsable de cómo uses esta herramienta y
   de cualquier consecuencia derivada.

## Local-first y privacidad

El proyecto es **local-first**: corre íntegramente en tu máquina. Las API keys,
credenciales y sesiones de navegador se quedan en tu disco (cifradas con
AES-256-GCM cuando aplica). **No existe ningún servidor central**; el autor del
proyecto nunca ve, recibe ni almacena tus datos.

## Limitación de responsabilidad

El software se proporciona "tal cual", sin garantías expresas ni implícitas. En
ningún caso los autores o titulares del copyright serán responsables de
reclamaciones, daños u otras responsabilidades derivadas del uso del software,
incluida cualquier infracción de los Términos de Servicio de terceros cometida
por el usuario. Ver el texto completo en [`LICENSE`](LICENSE).
