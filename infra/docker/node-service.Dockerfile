# syntax=docker/dockerfile:1.7
# Image for the Node services (api, mcp-server, worker). One image, selected by SERVICE.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Optional extra CA bundle for TLS-intercepting corporate proxies:
#   docker build --secret id=ca_bundle,src=/path/to/ca.pem ...
RUN --mount=type=secret,id=ca_bundle,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/ca_bundle ] && echo /run/secrets/ca_bundle) \
    sh -c 'corepack enable && corepack prepare pnpm@10.28.0 --activate'
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=secret,id=ca_bundle,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/ca_bundle ] && echo /run/secrets/ca_bundle) \
    sh -c 'pnpm install --frozen-lockfile && pnpm --filter @atx/mcp-server build:views'

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
ARG SERVICE=api
ENV SERVICE=${SERVICE}
EXPOSE 4000 4100
CMD ["sh", "-c", "exec node --import tsx apps/${SERVICE}/src/main.ts"]
