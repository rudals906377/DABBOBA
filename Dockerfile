# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG PNPM_VERSION=11.22.0

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build-toolchain
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
  && pnpm --version

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
COPY packages/config/package.json packages/config/tsconfig.json ./packages/config/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY packages/domain/package.json packages/domain/tsconfig.json ./packages/domain/

RUN --mount=type=cache,id=dabboba-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile \
    --filter @dabboba/api... \
    --filter @dabboba/worker... \
    --filter @dabboba/db...

COPY apps/api/src ./apps/api/src
COPY apps/worker/src ./apps/worker/src
COPY packages/config/src ./packages/config/src
COPY packages/contracts/openapi ./packages/contracts/openapi
COPY packages/contracts/src ./packages/contracts/src
COPY packages/db/migrations ./packages/db/migrations
COPY packages/db/src ./packages/db/src
COPY packages/domain/src ./packages/domain/src

RUN pnpm --filter @dabboba/api... --filter @dabboba/worker... run build

FROM build-toolchain AS production-bundles
RUN pnpm --config.inject-workspace-packages=true --filter @dabboba/api deploy --prod /out/api \
  && pnpm --config.inject-workspace-packages=true --filter @dabboba/worker deploy --prod /out/worker \
  && pnpm --config.inject-workspace-packages=true --filter @dabboba/db deploy --prod /out/migration \
  && rm -rf \
    /out/api/src /out/api/.turbo /out/api/tsconfig.json /out/api/pnpm-lock.yaml /out/api/pnpm-workspace.yaml \
    /out/worker/src /out/worker/.turbo /out/worker/tsconfig.json /out/worker/pnpm-lock.yaml /out/worker/pnpm-workspace.yaml \
    /out/migration/src /out/migration/.turbo /out/migration/tsconfig.json \
    /out/migration/pnpm-lock.yaml /out/migration/pnpm-workspace.yaml \
  && find /out -type d -path '*/node_modules/.pnpm/@dabboba+*/node_modules/@dabboba/*/src' \
    -prune -exec rm -rf '{}' + \
  && find /out -type f -path '*/node_modules/.pnpm/@dabboba+*/node_modules/@dabboba/*/tsconfig.json' \
    -delete \
  && find /out/api /out/worker -type d \
    -path '*/node_modules/.pnpm/@dabboba+db@*/node_modules/@dabboba/db/migrations' \
    -prune -exec rm -rf '{}' + \
  && rm -rf /out/api/dist/cli \
  && find /out/api /out/worker -type f \
    \( -path '*/node_modules/.pnpm/@dabboba+db@*/node_modules/@dabboba/db/dist/migrate.js' \
       -o -path '*/node_modules/.pnpm/@dabboba+db@*/node_modules/@dabboba/db/dist/provision-runtime-role.js' \
       -o -path '*/node_modules/.pnpm/@dabboba+db@*/node_modules/@dabboba/db/dist/provision-worker-role.js' \
       -o -path '*/node_modules/.pnpm/@dabboba+db@*/node_modules/@dabboba/db/dist/seed.js' \) \
    -delete \
  && rm -f \
    /out/migration/dist/provision-runtime-role.js \
    /out/migration/dist/provision-worker-role.js \
    /out/migration/dist/seed.js \
  && find /out -type f \
    \( -name '.env' -o -name '.env.*' -o -name '*.ts' -o -name '*.cts' \
       -o -name '*.mts' -o -name '*.map' -o -name '*.tsbuildinfo' \
       -o -name '*.test.js' -o -name '*.test.cjs' -o -name '*.test.mjs' \
       -o -name '*.integration.test.js' -o -name '*.spec.js' -o -name '*.spec.cjs' \
       -o -name '*.spec.mjs' \) \
    -delete \
  && ! find /out -type f \
    \( -name '.env' -o -name '.env.*' -o -name '*.ts' -o -name '*.cts' \
       -o -name '*.mts' -o -name '*.map' -o -name '*.tsbuildinfo' \
       -o -name '*.test.js' -o -name '*.test.cjs' -o -name '*.test.mjs' \
       -o -name '*.integration.test.js' -o -name '*.spec.js' -o -name '*.spec.cjs' \
       -o -name '*.spec.mjs' \) \
    -print -quit | grep -q .

RUN set -eu; \
  scan_status=0; \
  grep -R -q -E \
    --include='*.js' --include='*.cjs' --include='*.mjs' \
    'ALTER ROLE %I WITH LOGIN PASSWORD|provision(Runtime|Worker)DatabaseRole' \
    /out || scan_status=$?; \
  if [ "$scan_status" -eq 0 ]; then \
    printf '%s\n' 'Operator-only database role provisioning logic entered a runtime bundle' >&2; \
    exit 1; \
  fi; \
  [ "$scan_status" -eq 1 ]

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS api-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-bundles --chown=node:node /out/api/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS worker-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-bundles --chown=node:node /out/worker/ ./
USER node
CMD ["node", "dist/index.js"]

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS migration-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-bundles --chown=node:node /out/migration/ ./
USER node
CMD ["node", "dist/migrate.js"]
