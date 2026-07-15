import assert from "node:assert/strict";
import test from "node:test";
import { requiresMetadataInput, type GenerationOrigin } from "./generationOrigin";

test("requires metadata input only for an ordinary template", () => {
  const expectations: Array<[GenerationOrigin, boolean]> = [
    ["prepared", false],
    ["template", true],
    ["languageModel", false],
  ];
  for (const [origin, expected] of expectations) {
    assert.equal(requiresMetadataInput(origin), expected, origin);
  }
});
