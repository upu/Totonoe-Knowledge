import assert from "node:assert/strict";
import test from "node:test";
import { orderModelsByPreviousSelection } from "./modelSelection";

const models = [
  { id: "model-a", name: "A" },
  { id: "model-b", name: "B" },
  { id: "model-c", name: "C" },
];

test("moves the previously selected model to the front", () => {
  assert.deepEqual(
    orderModelsByPreviousSelection(models, "model-c").map((model) => model.id),
    ["model-c", "model-a", "model-b"],
  );
});

test("preserves provider order without a matching previous model", () => {
  assert.deepEqual(
    orderModelsByPreviousSelection(models, "missing").map((model) => model.id),
    ["model-a", "model-b", "model-c"],
  );
  assert.deepEqual(
    orderModelsByPreviousSelection(models, undefined).map((model) => model.id),
    ["model-a", "model-b", "model-c"],
  );
});

test("does not mutate the provider model list", () => {
  orderModelsByPreviousSelection(models, "model-c");
  assert.deepEqual(models.map((model) => model.id), ["model-a", "model-b", "model-c"]);
});
