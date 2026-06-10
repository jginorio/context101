# TypeScript port of the wiki generator. Multi-stage: compile with dev deps,
# ship only runtime deps + dist. Drop-in replacement for the Python image's
# task contract (same env vars, runs to completion and exits).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
