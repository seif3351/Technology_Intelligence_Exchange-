# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
# COREPACK_HOME is shared so the non-root runtime user can run operator commands
# (`pnpm db:migrate`, `pnpm admin:create`) without downloading pnpm at runtime.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_HOME=/corepack NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=ca_bundle,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/ca_bundle ] && echo /run/secrets/ca_bundle) \
    sh -c 'corepack enable && corepack prepare pnpm@10.28.0 --activate && chmod -R a+rX /corepack'
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
# Start Next directly: no package manager in the request path.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000"]
