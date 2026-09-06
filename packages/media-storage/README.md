# Server-only Supabase media storage

This package is used only by API/Worker code. It does not load environment files,
access a cloud account, change buckets, or migrate data. The existing GCS adapter
is outside this package and unchanged.

## Protocol and trust boundaries

- `createUpload` returns a raw S3-compatible `PUT`, valid for at most 120 seconds
  (rounded down to the signing second). `maxBytes` is the exact declared size.
  The signature includes `host` and exactly these five returned headers:
  `content-type`, `content-length`, `x-amz-content-sha256: UNSIGNED-PAYLOAD`,
  `x-amz-meta-sha256`, and `x-amz-meta-media-id`.
  Browser/native consumers validate the declared length, omit that header from
  fetch options, and let their transport supply it. Metadata SHA is an assertion,
  not evidence of the actual payload's digest.
- `stat` uses native REST object info. `read` pins the native object UUID on both
  info and authenticated bytes. `signedRead` sends `{ expiresIn, versionId }` to
  the native signing route. Neither S3 versioning nor S3 `If-Match` is used.
- The caller supplies a unique final key for **each claim**:
  `media/<media UUID>/<actual SHA256>-<claim UUID>.webp`. `writeFinal` performs a
  native upload with `x-upsert:false`, but does not assume atomic create-only
  semantics. It requires `no-store` object metadata, exact metadata identity,
  and bounded actual-byte SHA/size/type/version verification before returning.
  An ambiguous upload response is recoverable only through that exact readback.
- Keys, endpoints, headers, sizes, metadata, and UUIDs are validated. Hosted
  endpoints must belong to the same Supabase project; HTTP is allowed only for
  explicit same-origin loopback fixtures. Each request, including its streamed
  body, has a 15-second deadline. JSON is bounded to 64 KiB and object reads to
  10 MiB. Redirects are errors, and errors never retain provider URLs, credentials,
  response bodies, or raw causes. Deletion accepts a missing object only when a
  400/404 response has the exact `NoSuchKey` code.

### Cache limitation verified in Storage v1.73.0

The final object's stored cache policy is `no-store`. However, the native signed
download route supplies an `Expires` header equal to the token expiry and skips
the normal `Cache-Control` handler. Its response therefore has **no
`Cache-Control: no-store` header** in the tested implementation. Do not describe
this adapter as proving signed-response no-store, immediate revocation of a
previously downloaded response, or hosted CDN behavior. Consumers/API responses
must keep their own private-data cache policy. No proxy or CDN policy is changed
by this package.

## Verification

```sh
corepack pnpm --filter @dabboba/media-storage build
corepack pnpm --filter @dabboba/media-storage test
```

The tests use disposable fake HTTP servers and an independent HMAC SigV4 oracle
to exercise **our** protocol and failure boundaries. They are not hosted-provider
conformance tests. For the separately provisioned, disposable v1.73.0 loopback
gateway only:

```sh
node packages/media-storage/scripts/local-conformance.mjs http://127.0.0.1:<fixture-port>
```

That script imports only public local-fixture credentials, creates a unique
private bucket, verifies the built adapter against the real local Storage
implementation, and removes only its own keys/bucket. Output is sanitized; it
never reads project `.env` files. The file backend is not hosted/CDN evidence.

## Primary implementation references

- [Supabase v1.73.0 raw S3 PUT](https://github.com/supabase/storage/blob/v1.73.0/src/http/routes/s3/commands/put-object.ts)
- [Native object info](https://github.com/supabase/storage/blob/v1.73.0/src/http/routes/object/getObjectInfo.ts)
  and [info response](https://github.com/supabase/storage/blob/v1.73.0/src/storage/renderer/info.ts)
- [Authenticated versioned read](https://github.com/supabase/storage/blob/v1.73.0/src/http/routes/object/getObject.ts)
  and [native signing](https://github.com/supabase/storage/blob/v1.73.0/src/http/routes/object/getSignedURL.ts)
- [Signed UUID download and expiry](https://github.com/supabase/storage/blob/v1.73.0/src/http/routes/object/getSignedObject.ts)
  and [renderer cache-header branch](https://github.com/supabase/storage/blob/v1.73.0/src/storage/renderer/renderer.ts#L121-L125)
- [Native upload](https://github.com/supabase/storage/blob/v1.73.0/src/http/routes/object/createObject.ts)
  and [uploader semantics](https://github.com/supabase/storage/blob/v1.73.0/src/storage/uploader.ts)
- [AWS SDK presigner](https://github.com/aws/aws-sdk-js-v3/blob/v3.1125.0/packages/s3-request-presigner/src/presigner.ts)
  and [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)

Runtime dependency versions are exact in `package.json`; the workspace lockfile
is maintained at the repository root.
