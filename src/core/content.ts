// 정적 콘텐츠 로더 — data/*.json (페르소나, 유닛, 시나리오)

import fs from "fs";
import path from "path";
import type { TutorPersona, Unit, Scenario, Expression } from "./types";

function loadJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", file), "utf8")) as T;
}

let _personas: TutorPersona[] | null = null;
let _units: Unit[] | null = null;
let _scenarios: Scenario[] | null = null;

export function getPersonas(): TutorPersona[] {
  if (!_personas) _personas = loadJson<TutorPersona[]>("personas.json");
  return _personas;
}
export function getPersona(id: string): TutorPersona {
  const p = getPersonas().find((x) => x.id === id);
  if (!p) throw new Error(`unknown tutor: ${id}`);
  return p;
}
export function getUnits(): Unit[] {
  if (!_units) _units = loadJson<Unit[]>("units.json");
  return _units;
}
export function getUnit(id: string): Unit {
  const u = getUnits().find((x) => x.id === id);
  if (!u) throw new Error(`unknown unit: ${id}`);
  return u;
}
export function getScenarios(): Scenario[] {
  if (!_scenarios) _scenarios = loadJson<Scenario[]>("scenarios.json");
  return _scenarios;
}
export function getScenario(id: string): Scenario | undefined {
  return getScenarios().find((x) => x.id === id);
}
export function findExpression(id: string): { expr: Expression; unit: Unit } | undefined {
  for (const unit of getUnits()) {
    const expr = unit.expressions.find((e) => e.id === id);
    if (expr) return { expr, unit };
  }
  return undefined;
}
