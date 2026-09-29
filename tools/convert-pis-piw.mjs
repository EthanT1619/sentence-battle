#!/usr/bin/env node
/**
 * PiS/PiW XLSX → lesson JSON under data/ + manifest merge
 *
 * Usage:
 *   node tools/convert-pis-piw.mjs "/path/to/PiS and PiW base input.xlsx"        # dry-run
 *   node tools/convert-pis-piw.mjs "/path/to/input.xlsx" --write
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  parseAndValidateWorkbookRows,
  packToLessonJson,
  mergeManifestWithPacks,
  roundTripTextValidation,
  sourceRowsRoundTrip,
  compareAcceptanceExpected,
  PIS_PIW_LEVELS,
} from "./pis-piw-logic.mjs";
import { validateManifest, validateLesson } from "../js/content/logic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function usage() {
  console.log(`Usage: node tools/convert-pis-piw.mjs <input.xlsx> [--write] [--data-dir=data]`);
}

function parseArgs(argv) {
  const args = { input: null, write: false, dataDir: path.join(REPO_ROOT, "data") };
  for (const a of argv) {
    if (a === "--write") args.write = true;
    else if (a.startsWith("--data-dir=")) args.dataDir = path.resolve(a.slice("--data-dir=".length));
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else if (!a.startsWith("-") && !args.input) args.input = path.resolve(a);
    else console.warn(`Unknown arg: ${a}`);
  }
  return args;
}

function readWorkbookRows(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`input_not_found:${inputPath}`);
  }
  const wb = XLSX.readFile(inputPath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("workbook_no_sheets");
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
}

function printReport(inputPath, result, acceptance, roundTrip) {
  console.log("\n=== PiS/PiW XLSX Converter Report ===");
  console.log(`Source: ${inputPath}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Validation: ${result.validation.ok ? "OK" : "FAILED"}`);
  if (!result.validation.ok) {
    result.validation.errors.forEach((e) => console.log(`  ERROR: ${e}`));
  }
  if (result.validation.warnings.length) {
    result.validation.warnings.forEach((w) => console.log(`  WARN: ${w}`));
  }

  if (result.validation.stats) {
    const s = result.validation.stats;
    console.log(`\nTotal sentence rows: ${s.totalRows}`);
    console.log(`Total packs: ${s.totalPacks}`);
    for (const level of PIS_PIW_LEVELS) {
      const L = s.byLevel[level];
      if (!L) continue;
      console.log(
        `  ${level}: ${L.sentences} sentences, ${L.packs} packs, types=[${L.types.join(",")}], lessons=${L.lessons.length}`,
      );
    }
  }

  console.log(`\nAcceptance (expected workbook): ${acceptance.ok ? "MATCH" : "DIFF"}`);
  if (!acceptance.ok) acceptance.diffs.forEach((d) => console.log(`  - ${d}`));

  console.log(`\nRound-trip TEXT_CHANGED: ${roundTrip.textChanged}`);
  if (roundTrip.mismatches.length) {
    roundTrip.mismatches.slice(0, 5).forEach((m) => console.log(`  ${m.pack} ${m.id}`));
  }

  if (result.runtimeLessonErrors?.length) {
    console.log("\nRuntime validateLesson failures:");
    result.runtimeLessonErrors.forEach((e) => console.log(`  ${e}`));
  }

  if (result.plannedWrites?.length) {
    console.log(`\nPlanned files (${result.plannedWrites.length}):`);
    result.plannedWrites.slice(0, 8).forEach((f) => console.log(`  ${f}`));
    if (result.plannedWrites.length > 8) {
      console.log(`  ... +${result.plannedWrites.length - 8} more`);
    }
  }
}

function validateRuntimePacks(packs) {
  const runtimeLessonErrors = [];
  packs.forEach((pack) => {
    const json = packToLessonJson(pack);
    const v = validateLesson(json);
    if (!v.ok) runtimeLessonErrors.push(`${pack.id}: ${v.errors.join(";")}`);
  });
  return runtimeLessonErrors;
}

function writeOutputs({ dataDir, packs, manifestPath, tempDir }) {
  const dataRoot = path.join(tempDir, "data");
  fs.mkdirSync(dataRoot, { recursive: true });

  const planned = [];
  for (const pack of packs) {
    const rel = pack.file.replace(/\\/g, "/");
    const outPath = path.join(dataRoot, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const body = `${JSON.stringify(packToLessonJson(pack), null, 2)}\n`;
    fs.writeFileSync(outPath, body, "utf8");
    planned.push(rel);
  }

  let existingManifest = null;
  if (fs.existsSync(manifestPath)) {
    existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }
  const merged = mergeManifestWithPacks(existingManifest, packs);
  const manifestValid = validateManifest(merged);
  if (!manifestValid.ok) {
    throw new Error(`merged_manifest_invalid:${manifestValid.errors.join(",")}`);
  }
  fs.writeFileSync(path.join(dataRoot, "manifest.json"), `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  copyDirRecursive(dataRoot, dataDir);

  const legacyRemove = [
    "LSA/lesson01.json",
    "LSA/lesson02.json",
    "LSB/lesson01.json",
  ];
  legacyRemove.forEach((rel) => {
    const p = path.join(dataDir, rel);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  return { planned, manifestPath: path.join(dataDir, "manifest.json") };
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    usage();
    process.exit(1);
  }

  const rows = readWorkbookRows(args.input);
  const validation = parseAndValidateWorkbookRows(rows);
  const roundTripJson = validation.packs.length
    ? roundTripTextValidation(validation.packs)
    : { ok: true, textChanged: 0, mismatches: [] };
  const roundTripSource = validation.rows.length
    ? sourceRowsRoundTrip(validation.rows, validation.packs)
    : { ok: true, textChanged: 0, mismatches: [] };
  const roundTrip = {
    ok: roundTripJson.ok && roundTripSource.ok,
    textChanged: roundTripJson.textChanged + roundTripSource.textChanged,
    mismatches: [...roundTripJson.mismatches, ...roundTripSource.mismatches],
  };
  const acceptance = validation.stats
    ? compareAcceptanceExpected(validation.stats)
    : { ok: false, diffs: ["no_stats"] };

  const result = {
    mode: args.write ? "write" : "dry-run",
    validation,
    acceptance,
    roundTrip,
    plannedWrites: validation.packs.map((p) => p.file),
    runtimeLessonErrors: [],
  };

  if (!validation.ok) {
    printReport(args.input, result, acceptance, roundTrip);
    process.exit(1);
  }

  if (!roundTrip.ok) {
    printReport(args.input, result, acceptance, roundTrip);
    process.exit(1);
  }

  result.runtimeLessonErrors = validateRuntimePacks(validation.packs);
  if (result.runtimeLessonErrors.length) {
    printReport(args.input, result, acceptance, roundTrip);
    process.exit(1);
  }

  if (args.write) {
    const tempDir = path.join(REPO_ROOT, ".tmp-pis-piw-output");
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const manifestPath = path.join(args.dataDir, "manifest.json");
    try {
      writeOutputs({
        dataDir: args.dataDir,
        packs: validation.packs,
        manifestPath,
        tempDir,
      });
      console.log(`\nWrote ${validation.packs.length} lesson JSON files and manifest to ${args.dataDir}`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  printReport(args.input, result, acceptance, roundTrip);
  process.exit(acceptance.ok ? 0 : 2);
}

main();
