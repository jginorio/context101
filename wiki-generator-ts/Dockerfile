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

# The codex subscription provider (MODEL_PROVIDER=codex) shells out to the
# `codex` binary, which downloads a platform binary on install. It's only needed
# for that provider, so it's gated behind a build arg to keep the default
# (Bedrock / BYO-API-key) image lean. The claude-code provider needs no extra
# install — the `claude` CLI ships bundled inside @anthropic-ai/claude-agent-sdk.
# Build codex-enabled images with:
#   docker build --build-arg WIKI_CODEX_CLI=1 .
ARG WIKI_CODEX_CLI=0
RUN if [ "$WIKI_CODEX_CLI" = "1" ]; then npm install -g @openai/codex; fi

COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
