# syntax=docker/dockerfile:1

# --- Stage 1: build (compila TypeScript -> dist con tsc) ---
FROM node:20-alpine AS build
WORKDIR /app

# Instala TODAS las dependencias (incluidas devDependencies: typescript, etc.)
COPY package.json package-lock.json ./
RUN npm ci

# Copia el código y compila
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: runtime (imagen mínima con solo dist + deps de producción) ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Solo dependencias de producción
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Artefacto compilado desde el stage de build
COPY --from=build /app/dist ./dist

# Usuario no-root: si hubiera una RCE, el proceso no corre como root en el contenedor.
RUN addgroup -S veris && adduser -S -u 1001 -G veris veris
USER veris

EXPOSE 8787

# Healthcheck contra el endpoint /healthz del gateway
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
