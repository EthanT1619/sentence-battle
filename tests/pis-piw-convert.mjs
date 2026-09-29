import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  parseAndValidateWorkbookRows,
  roundTripTextValidation,
  sourceRowsRoundTrip,
  compareAcceptanceExpected,
  packToLessonJson,
  ACCEPTANCE_EXPECTED,
} from "../tools/pis-piw-logic.mjs";
import {
  defaultTokenize,
  tokenizeForBattle,
  validateLesson,
  validateManifest,
} from "../js/content/logic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DEFAULT_XLSX = "C:\\Users\\ksh12\\OneDrive\\Desktop\\PiS and PiW base input.xlsx";

function loadXlsxRows(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

function testWorkbookPipeline(xlsxPath) {
  const rows = loadXlsxRows(xlsxPath);
  const result = parseAndValidateWorkbookRows(rows);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.stats.totalRows, 600);
  assert.equal(result.stats.totalPacks, 80);

  const acceptance = compareAcceptanceExpected(result.stats);
  assert.equal(acceptance.ok, true, acceptance.diffs.join("\n"));

  const rt1 = roundTripTextValidation(result.packs);
  const rt2 = sourceRowsRoundTrip(result.rows, result.packs);
  assert.equal(rt1.textChanged, 0);
  assert.equal(rt2.textChanged, 0);

  const reps = [
    ["LSA", 1, "PiS", 6],
    ["LSB", 1, "PiS", 8],
    ["LSC", 1, "PiW", 8],
    ["LSD", 1, "PiW", 8],
  ];
  for (const [level, lesson, type, count] of reps) {
    const pack = result.packs.find((p) => p.level === level && p.lesson === lesson && p.type === type);
    assert.ok(pack, `${level} L${lesson} ${type}`);
    assert.equal(pack.sentences.length, count);
    const v = validateLesson(packToLessonJson(pack));
    assert.equal(v.ok, true, v.errors.join("; "));
  }

  const lsaLessons = result.packs.filter((p) => p.level === "LSA").map((p) => p.lesson);
  assert.deepEqual(lsaLessons, ACCEPTANCE_EXPECTED.lessonSequence);
  assert.ok(!lsaLessons.includes(11));
  assert.ok(!lsaLessons.includes(12));
  const l10Idx = lsaLessons.indexOf(10);
  assert.equal(lsaLessons[l10Idx + 1], 13);

  const mr = result.rows.find((r) => r.sentence.includes("Mr.Cunningham"));
  assert.ok(mr);
  const tokens = defaultTokenize(mr.sentence);
  assert.ok(
    tokens.some((t) => t.startsWith("Mr.Cunningham")),
    `expected single card for Mr.Cunningham, got: ${tokens.join("|")}`,
  );
  assert.ok(!tokens.includes("Mr."), tokens.join("|"));

  const dr = result.rows.find((r) => r.sentence.includes("Dr.Frankenstein"));
  if (dr) {
    const t = defaultTokenize(dr.sentence);
    assert.ok(t.some((x) => x.includes("Dr.Frankenstein")));
  }

  const quote = result.rows.find((r) => r.sentence.includes('"Sleeping by the fire'));
  if (quote) {
    assert.match(quote.sentence, /"Sleeping by the fire, as usual," I say\./);
  }

  const lsc21 = result.packs.find((p) => p.level === "LSC" && p.lesson === 21 && p.type === "PiW");
  assert.ok(lsc21);
  const s7 = lsc21.sentences.find((s) => s.id === "s07");
  assert.equal(s7.sentence, "I think riding roller coaster is really fun.");
}

function testGeneratedManifestOnDisk() {
  const manifestPath = path.join(REPO, "data", "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const v = validateManifest(raw);
  assert.equal(v.ok, true);

  for (const levelId of ["LSA", "LSB", "LSC", "LSD"]) {
    const level = v.levels.find((l) => l.id === levelId);
    assert.ok(level, levelId);
    const available = level.lessons.filter((l) => l.available);
    assert.equal(available.length, 20, levelId);
    const nums = available.map((l) => l.lesson);
    assert.ok(!nums.includes(11));
    assert.ok(!nums.includes(12));
  }
}

function testRepresentativeJsonFiles() {
  const files = [
    "data/LSA/lesson01-pis.json",
    "data/LSB/lesson01-pis.json",
    "data/LSC/lesson01-piw.json",
    "data/LSD/lesson01-piw.json",
  ];
  for (const rel of files) {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) continue;
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const v = validateLesson(json);
    assert.equal(v.ok, true, `${rel}: ${v.errors.join(";")}`);
  }
}

function main() {
  const xlsx = process.env.PIS_PIW_XLSX || DEFAULT_XLSX;
  if (!fs.existsSync(xlsx)) {
    console.log(`skip pis-piw workbook tests (missing ${xlsx})`);
  } else {
    testWorkbookPipeline(xlsx);
    console.log("pis-piw workbook pipeline OK");
  }
  testGeneratedManifestOnDisk();
  testRepresentativeJsonFiles();
  console.log("pis-piw-convert tests OK");
}

main();
