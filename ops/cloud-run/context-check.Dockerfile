# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
WORKDIR /context
COPY . .

RUN test -f package.json \
  && test -f pnpm-lock.yaml \
  && test -f apps/api/src/index.ts \
  && test -f apps/worker/src/index.ts \
  && test -f packages/db/src/migrate.ts \
  && test -f packages/media-storage/src/index.ts \
  && test -d packages/db/migrations \
  && test ! -e .git \
  && test ! -e .github \
  && test ! -e docs \
  && test ! -e ops \
  && test ! -e work \
  && test ! -e packages/db/src/provision-runtime-role.ts \
  && test ! -e packages/db/src/provision-worker-role.ts \
  && test ! -e packages/db/src/role-credentials.ts \
  && test ! -e packages/db/src/role-provisioning.ts \
  && test ! -e packages/db/src/seed.ts \
  && ! find . -type f \
    \( -name '.env' -o -name '.env.*' -o -name '.DS_Store' \
       -o -name '*.test.ts' -o -name '*.integration.test.ts' -o -name '*.conformance.ts' \
       -o -name '*.test-d.ts' -o -name '*.tsbuildinfo' \) \
    -print -quit | grep -q .
