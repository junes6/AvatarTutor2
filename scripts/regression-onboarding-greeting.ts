import assert from "node:assert/strict";
import { getPersonas } from "../src/core/content";
import { onboardingGreeting } from "../src/core/onboardingGreeting";

for (const persona of getPersonas()) {
  const greetings = [1, 2, 3, 4, 5].map((level) => onboardingGreeting(persona, "Sewon", level));
  for (const [index, greeting] of greetings.entries()) {
    const level = index + 1;
    const questions = (greeting.en.match(/\?/g) ?? []).length;
    const sentences = greeting.en.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
    const words = greeting.en.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    assert.equal(questions, 1, `${persona.id} level ${level} onboarding greeting does not yield exactly one question`);
    assert.ok(greeting.ko.length > 0, `${persona.id} level ${level} greeting is missing Korean translation`);
    if (level <= 2) {
      assert.ok(sentences <= 2, `${persona.id} beginner greeting is longer than two sentences`);
      assert.ok(words <= 18, `${persona.id} beginner greeting is longer than 18 words`);
    } else {
      assert.ok(sentences <= 3, `${persona.id} level ${level} greeting is longer than three sentences`);
    }
  }
  assert.notEqual(greetings[0].en, greetings[2].en, `${persona.id} beginner and intermediate greetings are identical`);
  assert.notEqual(greetings[2].en, greetings[4].en, `${persona.id} intermediate and advanced greetings are identical`);
}

console.log("onboarding greeting regressions: persona variety, level length, translation, and one-question handoff passed");
