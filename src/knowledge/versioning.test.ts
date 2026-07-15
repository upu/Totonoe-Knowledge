import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersionStrings,
  describeVersionRange,
  isVersionInRange,
  parseComparableVersion,
} from "./versioning";

test("parses numeric versions with normalized optional prefixes", () => {
  assert.deepEqual(parseComparableVersion("v17.1.02"), { prefix: "", segments: [17, 1, 2] });
  assert.deepEqual(parseComparableVersion("ＲＨＥＬ9.2"), { prefix: "rhel", segments: [9, 2] });
  assert.deepEqual(parseComparableVersion("release-v3"), { prefix: "release", segments: [3] });
  assert.equal(parseComparableVersion("rolling"), undefined);
  assert.equal(parseComparableVersion("1.2-beta"), undefined);
});

test("compares segments numerically and requires matching product prefixes", () => {
  assert.equal(compareVersionStrings("v17.2", "17.10"), -1);
  assert.equal(compareVersionStrings("1", "1.0.0"), 0);
  assert.equal(compareVersionStrings("RHEL10", "RHEL9.4"), 1);
  assert.equal(compareVersionStrings("RHEL9", "Ubuntu9"), undefined);
});

test("uses inclusive open-ended applicability ranges", () => {
  assert.equal(isVersionInRange("17.0", "17", "17.0"), true);
  assert.equal(isVersionInRange("17.1", "17", "17.0"), false);
  assert.equal(isVersionInRange("RHEL9.2", "RHEL9"), true);
  assert.equal(isVersionInRange("Ubuntu9.2", "RHEL9"), false);
  assert.equal(isVersionInRange("2026.1"), true);
  assert.equal(isVersionInRange("rolling"), false);
});

test("describes bounded and unbounded ranges", () => {
  assert.equal(describeVersionRange("17.1", "17.9"), "17.1〜17.9");
  assert.equal(describeVersionRange("17.1", ""), "17.1以降");
  assert.equal(describeVersionRange(undefined, "17.9"), "17.9まで");
  assert.equal(describeVersionRange(), "全バージョン");
});
