import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const tempRoot = path.resolve(os.tmpdir());
  const storeDir = fs.mkdtempSync(path.join(tempRoot, "avatar-tutor-curriculum-regression-"));
  try {
    process.env.STORE_DIR = storeDir;

    const { getUnits } = await import("../src/core/content");
    const { recommendUnit } = await import("../src/core/curriculum");
    const { DEFAULT_USER, saveUser } = await import("../src/core/gamification");
    const stateRoute = await import("../src/app/api/state/route");
    const units = getUnits();

    assert.deepEqual(
      units.map((unit) => [unit.id, unit.level]),
      [
        ["unit-01", 1], ["unit-02", 1],
        ["unit-03", 2], ["unit-04", 2],
        ["unit-05", 3], ["unit-06", 3], ["unit-07", 3],
        ["unit-08", 4], ["unit-09", 4], ["unit-10", 4],
        ["unit-11", 5],
      ],
      "unit difficulty map changed unexpectedly",
    );

    assert.deepEqual(recommendUnit(units, [], 1), { unit: units[0], reason: "matched" });
    assert.equal(recommendUnit(units, ["unit-01", "unit-02"], 1)?.unit.id, "unit-03");
    assert.equal(recommendUnit(units, [], 3)?.unit.id, "unit-05");
    assert.equal(recommendUnit(units, [], 4)?.unit.id, "unit-08");
    assert.equal(recommendUnit(units, [], 5)?.unit.id, "unit-11");
    assert.equal(
      recommendUnit(units, ["unit-05", "unit-06", "unit-07"], 3)?.unit.id,
      "unit-08",
      "completed matched units did not advance to the next challenge",
    );
    assert.deepEqual(
      recommendUnit(units, ["unit-11"], 5),
      { unit: units.find((unit) => unit.id === "unit-08"), reason: "review" },
    );
    assert.equal(recommendUnit(units, units.map((unit) => unit.id), 3), null);
    assert.equal(recommendUnit([...units].reverse(), [], 3)?.unit.id, "unit-05", "recommendation depends on JSON order");
    assert.equal(recommendUnit(units, [], -10)?.unit.id, "unit-01");
    assert.equal(recommendUnit(units, [], 99)?.unit.id, "unit-11");

    saveUser({ ...structuredClone(DEFAULT_USER), onboarded: true, level: 3 });
    let response = await stateRoute.GET();
    let payload = await response.json() as { recommendedUnitId: string; recommendationReason: string };
    assert.equal(payload.recommendedUnitId, "unit-05");
    assert.equal(payload.recommendationReason, "matched");

    saveUser({ ...structuredClone(DEFAULT_USER), onboarded: true, level: 5 });
    response = await stateRoute.GET();
    payload = await response.json() as { recommendedUnitId: string; recommendationReason: string };
    assert.equal(payload.recommendedUnitId, "unit-11");
    assert.equal(payload.recommendationReason, "matched");

    console.log("curriculum regressions: levels, stable recommendation, progression, review, and API passed");
  } finally {
    delete process.env.STORE_DIR;
    const resolvedStoreDir = path.resolve(storeDir);
    const expectedPrefix = `${tempRoot}${path.sep}avatar-tutor-curriculum-regression-`;
    if (resolvedStoreDir.startsWith(expectedPrefix)) fs.rmSync(resolvedStoreDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
