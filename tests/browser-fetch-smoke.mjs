/**
 * HTTP smoke: manifest + representative lessons (requires server on BASE_URL).
 */
import assert from "node:assert/strict";
import { normalizeLessonToGameInput, validateManifest, validateLesson } from "../js/content/logic.mjs";

const BASE = process.env.SB_BASE_URL || "http://127.0.0.1:8080/data/";

async function fetchJson(path) {
  const url = `${BASE.replace(/\/?$/, "/")}${path.replace(/^\//, "")}`;
  const res = await fetch(url);
  assert.equal(res.status, 200, `${url} -> ${res.status}`);
  return res.json();
}

async function main() {
  const manifestRaw = await fetchJson("manifest.json");
  const manifest = validateManifest(manifestRaw);
  assert.equal(manifest.ok, true);

  const picks = [
    { level: "LSA", lesson: 1, count: 6, file: "LSA/lesson01-pis.json" },
    { level: "LSB", lesson: 1, count: 8, file: "LSB/lesson01-pis.json" },
    { level: "LSC", lesson: 1, count: 8, file: "LSC/lesson01-piw.json" },
    { level: "LSD", lesson: 1, count: 8, file: "LSD/lesson01-piw.json" },
  ];

  for (const pick of picks) {
    const raw = await fetchJson(pick.file);
    const v = validateLesson(raw);
    assert.equal(v.ok, true, pick.file);
    assert.equal(v.lesson.sentences.length, pick.count);
    const game = normalizeLessonToGameInput(raw);
    assert.equal(game.ok, true);
    assert.equal(game.sentences.length, pick.count);
    assert.equal(game.cardSets.length, pick.count);
  }

  const lsa = manifest.levels.find((l) => l.id === "LSA");
  const lessons = lsa.lessons.filter((l) => l.available).map((l) => l.lesson);
  assert.ok(!lessons.includes(11));
  assert.ok(!lessons.includes(12));
  const i10 = lessons.indexOf(10);
  assert.equal(lessons[i10 + 1], 13);

  console.log("browser-fetch-smoke OK");
}

main().catch((err) => {
  console.error("browser-fetch-smoke FAILED:", err.message);
  process.exit(1);
});
