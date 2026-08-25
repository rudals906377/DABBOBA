import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginRequestHeaders } from "../lib/request-origin.ts";

function requestHeaders({ host, origin, fetchSite } = {}) {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (origin) headers.set("origin", origin);
  if (fetchSite) headers.set("sec-fetch-site", fetchSite);
  return headers;
}

test("accepts a same-origin loopback request using the externally visible Host", () => {
  assert.equal(isSameOriginRequestHeaders(requestHeaders({
    host: "127.0.0.1:4180",
    origin: "http://127.0.0.1:4180",
    fetchSite: "same-origin",
  })), true);
});

test("accepts localhost and normalizes a default origin port", () => {
  assert.equal(isSameOriginRequestHeaders(requestHeaders({
    host: "localhost:80",
    origin: "http://localhost",
    fetchSite: "same-origin",
  })), true);
});

test("rejects browser cross-site and same-site requests", () => {
  for (const fetchSite of ["cross-site", "same-site"]) {
    assert.equal(isSameOriginRequestHeaders(requestHeaders({
      host: "127.0.0.1:4180",
      origin: "https://attacker.example",
      fetchSite,
    })), false);
  }
});

test("rejects a mismatched or malformed Origin even when Fetch Metadata claims same-origin", () => {
  for (const origin of ["https://attacker.example", "null", "not a url", "http://127.0.0.1:4180/path"]) {
    assert.equal(isSameOriginRequestHeaders(requestHeaders({
      host: "127.0.0.1:4180",
      origin,
      fetchSite: "same-origin",
    })), false);
  }
});

test("keeps non-browser same-origin fallback while requiring Host when Origin is present", () => {
  assert.equal(isSameOriginRequestHeaders(requestHeaders()), true);
  assert.equal(isSameOriginRequestHeaders(requestHeaders({ origin: "http://127.0.0.1:4180" })), false);
});
