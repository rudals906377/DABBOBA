# Local Supabase Storage conformance

This is a disposable **local-only** test environment. It never reads the app's
environment files or connects to hosted Supabase. Credentials in
`local-fixture.mjs` are deliberately public fixture values, not deployment values.

The Storage image is the official v1.73.0 release (2026-09-03), pinned to digest
`sha256:0f41ebe206d817fa9c1664f747789cbfb3653f111cd0d7a363f314039c4c1ddf`.
The database follows the released Storage compose's `pgvector/pgvector:pg15`,
resolved to digest
`sha256:a947c45cdc5906a1bc951f20a8709e321256343ee0f251e4ae00b5e7def4e6da`.

Sources:

- https://github.com/supabase/storage/releases/tag/v1.73.0
- https://github.com/supabase/storage/blob/v1.73.0/docker-compose.yml
- https://github.com/supabase/storage/blob/v1.73.0/.docker/docker-compose-infra.yml

The two main containers share only a dedicated new bridge network. No existing
Docker database, service, volume, or network is reused. PostgreSQL and object
bytes use private container tmpfs; stopping them discards this fixture data.
Only the API is published, bound to an automatically chosen loopback port.
`DB_INSTALL_ROLES=true` lets the released server install its own isolated schema;
no application migrations or shared database fixtures run.

## Commands

Pull the two pinned images first. `docker-client/config.json` is an empty local
client configuration for anonymous public-image pulls if a host credential helper
is unavailable. Pass the host's existing Docker socket explicitly when using it;
do not change the global Docker configuration.

```sh
node scripts/storage-conformance/start.mjs pgvector/pgvector@sha256:a947c45cdc5906a1bc951f20a8709e321256343ee0f251e4ae00b5e7def4e6da
node scripts/storage-conformance/conformance.mjs
```

For project-shaped paths, keep this local gateway process running:

```sh
node scripts/storage-conformance/gateway.mjs
node scripts/storage-conformance/conformance.mjs http://127.0.0.1:PORT/storage/v1
```

Use the printed port, not a production URL. The gateway starts a third, separately
named API on the same isolated test database, with its own empty file store.
Always create a **fresh bucket** for gateway tests. It strips `/storage/v1` while
preserving signed headers/query; the real server verifies that prefix through
`S3_PROTOCOL_PREFIX`. It does not resign requests or mock responses.

## Evidence boundaries

The checks exercise the actual released Storage REST/SigV4 server, real
PostgreSQL metadata, and its file backend. They do **not** prove hosted feature
availability, cloud S3 backend behavior, CDN cache/expiry, TLS, native upload
transport, provider credentials, or production readiness.

The SigV4 signer uses only Node built-ins and explicitly signs Content-Length,
Content-Type, payload mode and media/hash metadata. It is independent of the app
adapter; adapter integration must be checked separately with the same fixture.
The 120-second expiry negative uses a correctly signed timestamp 121 seconds in
the past; a separate one-second REST URL tests actual elapsed-time expiry.

Conformance deliberately records unsupported behavior: same-length wrong bytes
are accepted until application hash verification; S3 If-Match is ignored; S3 POST
content-length-range is ignored. Passing the script confirms these observations,
not that those unsupported features are safe to rely upon.

Fixtures remain running for the parent task's adapter integration. No automated
cleanup deletes containers or data. Resource names all start with
`dabboba-storage-conformance-20260906`; inspect their exact conformance labels
before later teardown. Never prune Docker or remove unrelated resources.

## Executed evidence: 2026-09-06

Final command exited 0 with 26 observations:

```sh
node scripts/storage-conformance/conformance.mjs http://127.0.0.1:52269/storage/v1
```

- Valid 120-second constrained PUT: 200; UUID version info and pinned read: 200.
- MIME, hash metadata, media identity, payload mode, key and declared short/long
  length tampering: 403 `SignatureDoesNotMatch`.
- Correctly signed URL aged 121 seconds with a 120-second lifetime: 400
  `ExpiredToken`; real-time expired one-second REST read: 400 `InvalidJWT`.
- Missing version and old authenticated/signed version after overwrite: 400
  `NoSuchKey`, never new-version content.
- Fixed-length short body: client deadline, no object observed. Extra trailing
  HTTP byte: 400, but the exact signed 33-byte prefix can already be stored.
  Therefore an upload transport error is not proof that no object exists.
- Same-length wrong bytes: accepted; full application SHA verification remains
  mandatory. Wrong S3 `If-Match`: 200. POST signed range 33..33 accepted 34 bytes.
- Native upload signing ignored `{expiresIn:1}` and used the local configured
  120-second lifetime. This does not change the documented hosted two-hour TTL.
- First and repeated S3 DeleteObject: 204.

Resources left running for adapter verification:

| Resource | Handle / endpoint |
| --- | --- |
| Dedicated PostgreSQL | `dabboba-storage-conformance-20260906-db` (no host port) |
| Direct API | `dabboba-storage-conformance-20260906-api`, `127.0.0.1:52016` |
| Gateway API upstream | `dabboba-storage-conformance-20260906-gateway-api`, `127.0.0.1:52256` |
| Loopback gateway | Node PID `34481`, `127.0.0.1:52269` |
| Dedicated network | `dabboba-storage-conformance-20260906-net` |

All three containers have a 768 MiB memory cap and 2-CPU cap. Their data mounts
are tmpfs, with no persistent host bind or named volume. Two initially empty
fixture containers were recreated to correct host-port publication on Docker's
internal network; no pre-existing user database or service was changed.
