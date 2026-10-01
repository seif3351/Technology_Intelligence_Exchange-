# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=ca_bundle,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/ca_bundle ] && echo /run/secrets/ca_bundle) \
    sh -c 'corepack enable && corepack prepare pnpm@10.28.0 --activate'
WORKDIR /app

FROM base AS build
COPY . .
RUN --mount=type=secret,id=ca_bundle,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/ca_bundle ] && echo /run/secrets/ca_bundle) \
    sh -c 'pnpm install --frozen-lockfile && pnpm --filter @atx/web build'

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
