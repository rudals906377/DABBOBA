import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Exercise the copy actually used by the API limiter, not a separate test dependency.
const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const limiterRequire = createRequire(apiRequire.resolve("@fastify/rate-limit"));
const { Address4, Address6, AddressError } = limiterRequire("ip-address");

test("the limiter's address parser never treats IPv4 and IPv6 as the same subnet", () => {
  // GHSA-j6r3-76f7-8jcv: different address families cannot share a subnet.
  const pairs = [
    [new Address6("a00::1"), new Address4("10.0.0.0/8")],
    [new Address4("32.0.0.1"), new Address6("2000::/3")],
  ];
  for (const [host, network] of pairs) {
    assert.equal(host.isInSubnet(network), false);
    assert.equal(host.isHostInSubnet(network), false);
  }
});

test("the limiter's address parser retains ordinary same-family subnet checks", () => {
  assert.equal(new Address4("10.1.2.3").isInSubnet(new Address4("10.0.0.0/8")), true);
  assert.equal(new Address4("8.8.8.8").isInSubnet(new Address4("10.0.0.0/8")), false);
  assert.equal(new Address6("2001:db8::1").isInSubnet(new Address6("2001:db8::/32")), true);
  assert.equal(new Address6("2001:db9::1").isInSubnet(new Address6("2001:db8::/32")), false);
});

test("oversized invalid IPv6 input is rejected without building a proportional diagnostic", () => {
  // GHSA-h3mg-xc3c-68pw: a small bounded fixture proves the early rejection;
  // do not run an actual resource-exhaustion payload in the shared workspace.
  assert.throws(
    () => new Address6("!".repeat(512)),
    (error) => error instanceof AddressError && error.parseMessage === undefined,
  );
  assert.equal(Address6.isValid("!".repeat(512)), false);
});
