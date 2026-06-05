import assert from "node:assert/strict"
import test from "node:test"
import activeTokenManagement from "../extensions/pi-atm.js"
import { EXT } from "../src/types.js"
import {
  fingerprintMessage,
  indexFromAlias,
  injectMessageAliases,
  stripAliasesFromMessages,
  textOf,
} from "../src/utils.js"

test("extension exports a function", () => {
  assert.equal(typeof activeTokenManagement, "function")
})

test("message aliases are model-visible without mutating visible message text", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "world" }] },
  ]

  const withAliases = injectMessageAliases(messages)

  assert.equal(withAliases.length, 3)
  assert.equal(textOf(withAliases[0]).includes("atm-message"), false)
  assert.equal(textOf(withAliases[1]).includes("atm-message"), false)

  const catalog = withAliases[2]
  assert.equal(catalog?.role, "custom")
  assert.equal(catalog?.customType, EXT)
  assert.equal(catalog?.display, false)
  assert.match(String(catalog?.content), /<atm-aliases\b/)
  assert.match(String(catalog?.content), /id="m0001"/)
  assert.match(String(catalog?.content), /id="m0002"/)
  assert.match(String(catalog?.content), /hello/)
  assert.match(String(catalog?.content), /world/)
})

test("stripping aliases removes the hidden catalog and preserves compression indices", () => {
  const messages = [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "toolResult", content: [{ type: "text", text: "third" }] },
  ]

  const stripped = stripAliasesFromMessages(injectMessageAliases(messages))

  assert.deepEqual(stripped, messages)
  assert.equal(indexFromAlias("m0001"), 0)
  assert.equal(indexFromAlias("m0003"), 2)
})

test("hidden alias catalog can be fingerprinted safely", () => {
  const withAliases = injectMessageAliases([{ role: "user", content: "hello" }])
  const catalog = withAliases.at(-1)

  assert.doesNotThrow(() => fingerprintMessage(catalog ?? {}))
})
