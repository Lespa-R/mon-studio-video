import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGuard } from "../lib/guard.mjs";

const refused = makeGuard(3002);

test("the studio's own page is allowed", () => {
  assert.equal(refused({ host: "localhost:3002", origin: "http://localhost:3002" }), null);
  assert.equal(refused({ host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002" }), null);
  assert.equal(refused({ host: "[::1]:3002" }), null);
});

test("a local process without an Origin (curl, the CLI) is allowed", () => {
  assert.equal(refused({ host: "localhost:3002" }), null);
});

test("a cross-site request is refused, including the simple POSTs CORS lets through", () => {
  assert.match(
    refused({ host: "localhost:3002", origin: "https://evil.example" }),
    /origine/);
});

test("a sandboxed or file:// page (Origin: null) is refused", () => {
  assert.match(refused({ host: "localhost:3002", origin: "null" }), /origine/);
});

test("DNS rebinding — our socket, someone else's hostname — is refused", () => {
  assert.match(refused({ host: "attacker.example:3002" }), /hôte/);
});

test("the port is part of the identity", () => {
  assert.match(refused({ host: "localhost:3003" }), /hôte/);
  assert.match(
    refused({ host: "localhost:3002", origin: "http://localhost:3003" }),
    /origine/);
});

test("a missing Host is refused", () => {
  assert.match(refused({}), /hôte/);
});
