/**
 * PiS/PiW XLSX → lesson JSON (pure logic, no I/O).
 */

export const REQUIRED_HEADERS = ["Level", "Lesson", "Type", "Number", "Sentence"];

export const PIS_PIW_LEVELS = ["LSA", "LSB", "LSC", "LSD"];

export const ACCEPTANCE_EXPECTED = {
  totalRows: 600,
  totalPacks: 80,
  byLevel: {
    LSA: { sentences: 120, packs: 20, type: "PiS" },
    LSB: { sentences: 160, packs: 20, type: "PiS" },
    LSC: { sentences: 160, packs: 20, type: "PiW" },
    LSD: { sentences: 160, packs: 20, type: "PiW" },
  },
  lessonsPerLevel: 20,
  lessonSequence: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  forbiddenLessons: [11, 12],
};

export function cellStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function isBlank(s) {
  return cellStr(s).trim() === "";
}

export function rowIsFullyEmpty(row) {
  return REQUIRED_HEADERS.every((h) => isBlank(row[h]));
}

function parsePositiveInt(field, raw, rowIndex) {
  const s = cellStr(raw);
  if (isBlank(s)) return { ok: false, error: `row_${rowIndex}_${field}_empty` };
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: `row_${rowIndex}_${field}_invalid:${s}` };
  }
  return { ok: true, value: n };
}

export function packKey(level, lesson, type) {
  return `${level}|${lesson}|${type}`;
}

export function packId(level, lesson, type) {
  const typeSlug = cellStr(type).toLowerCase();
  return `${cellStr(level).toLowerCase()}-${String(lesson).padStart(2, "0")}-${typeSlug}`;
}

export function packRelativeFile(level, lesson, type) {
  const typeSlug = cellStr(type).toLowerCase();
  return `${level}/lesson${String(lesson).padStart(2, "0")}-${typeSlug}.json`;
}

export function sentenceId(number) {
  return `s${String(number).padStart(2, "0")}`;
}

export function packTitle(type, lesson) {
  return `${cellStr(type)} ${lesson}`;
}

/**
 * @param {Record<string, unknown>[]} rows from sheet_to_json
 */
export function parseAndValidateWorkbookRows(rows, { headerRow = REQUIRED_HEADERS } = {}) {
  const errors = [];
  const warnings = [];
  const normalizedRows = [];

  if (!rows.length) {
    errors.push("workbook_empty");
    return { ok: false, errors, warnings, rows: [], packs: [], stats: null };
  }

  const first = rows[0];
  for (const h of REQUIRED_HEADERS) {
    if (!(h in first)) errors.push(`missing_header:${h}`);
  }
  if (errors.length) {
    return { ok: false, errors, warnings, rows: [], packs: [], stats: null };
  }

  rows.forEach((row, idx) => {
    const rowIndex = idx + 2;
    if (rowIsFullyEmpty(row)) return;

    const level = cellStr(row.Level);
    const type = cellStr(row.Type);
    const sentence = cellStr(row.Sentence);

    const partialFields = [
      isBlank(level),
      isBlank(row.Lesson),
      isBlank(row.Type),
      isBlank(row.Number),
      isBlank(sentence),
    ];
    const filled = partialFields.filter((b) => !b).length;
    if (filled > 0 && filled < 5) {
      errors.push(`row_${rowIndex}_partial_row`);
      return;
    }

    if (isBlank(level)) errors.push(`row_${rowIndex}_level_empty`);
    const lessonParsed = parsePositiveInt("Lesson", row.Lesson, rowIndex);
    if (!lessonParsed.ok) errors.push(lessonParsed.error);
    if (isBlank(type)) errors.push(`row_${rowIndex}_type_empty`);
    const numberParsed = parsePositiveInt("Number", row.Number, rowIndex);
    if (!numberParsed.ok) errors.push(numberParsed.error);
    if (isBlank(sentence)) errors.push(`row_${rowIndex}_sentence_empty`);

    if (sentence !== sentence.trim()) {
      errors.push(`row_${rowIndex}_sentence_leading_trailing_whitespace`);
    }

    if (
      !isBlank(level) &&
      lessonParsed.ok &&
      !isBlank(type) &&
      numberParsed.ok &&
      !isBlank(sentence)
    ) {
      normalizedRows.push({
        rowIndex,
        level: level,
        lesson: lessonParsed.value,
        type: type,
        number: numberParsed.value,
        sentence: sentence,
      });
    }
  });

  const rowKeySeen = new Set();
  normalizedRows.forEach((r) => {
    const key = `${r.level}|${r.lesson}|${r.type}|${r.number}`;
    if (rowKeySeen.has(key)) errors.push(`duplicate_row_key:${key}`);
    else rowKeySeen.add(key);
  });

  const byPack = new Map();
  normalizedRows.forEach((r) => {
    const pk = packKey(r.level, r.lesson, r.type);
    if (!byPack.has(pk)) byPack.set(pk, []);
    byPack.get(pk).push(r);
  });

  const packs = [];
  const packIds = new Set();
  const outputPaths = new Set();

  for (const [, items] of byPack) {
    items.sort((a, b) => a.number - b.number);

    const { level, lesson, type } = items[0];
    const id = packId(level, lesson, type);
    const file = packRelativeFile(level, lesson, type);

    if (packIds.has(id)) errors.push(`duplicate_pack_id:${id}`);
    packIds.add(id);

    if (outputPaths.has(file)) errors.push(`duplicate_output_path:${file}`);
    outputPaths.add(file);

    const numbers = items.map((i) => i.number);
    const numberSet = new Set(numbers);
    if (numberSet.size !== numbers.length) {
      errors.push(`pack_${id}_duplicate_number`);
    }

    const expectedSeq = items.map((_, i) => i + 1);
    const actualSeq = [...numbers].sort((a, b) => a - b);
    if (
      actualSeq.length !== expectedSeq.length ||
      actualSeq.some((n, i) => n !== expectedSeq[i])
    ) {
      errors.push(`pack_${id}_number_sequence_error:got_${actualSeq.join(",")}`);
    }

    packs.push({
      level,
      lesson,
      type,
      id,
      title: packTitle(type, lesson),
      file,
      sentences: items.map((i) => ({
        id: sentenceId(i.number),
        sentence: i.sentence,
        sourceNumber: i.number,
        sourceRowIndex: i.rowIndex,
      })),
    });
  }

  packs.sort((a, b) => {
    if (a.level !== b.level) return a.level.localeCompare(b.level);
    if (a.lesson !== b.lesson) return a.lesson - b.lesson;
    return a.type.localeCompare(b.type);
  });

  const stats = computeStats(normalizedRows, packs);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rows: normalizedRows,
    packs,
    stats,
  };
}

export function computeStats(normalizedRows, packs) {
  const byLevel = {};
  for (const level of PIS_PIW_LEVELS) {
    byLevel[level] = { sentences: 0, packs: 0, types: new Set(), lessons: new Set() };
  }
  normalizedRows.forEach((r) => {
    if (!byLevel[r.level]) byLevel[r.level] = { sentences: 0, packs: 0, types: new Set(), lessons: new Set() };
    byLevel[r.level].sentences += 1;
    byLevel[r.level].types.add(r.type);
    byLevel[r.level].lessons.add(r.lesson);
  });
  packs.forEach((p) => {
    if (!byLevel[p.level]) byLevel[p.level] = { sentences: 0, packs: 0, types: new Set(), lessons: new Set() };
    byLevel[p.level].packs += 1;
  });

  const levelSummary = {};
  for (const [level, data] of Object.entries(byLevel)) {
    levelSummary[level] = {
      sentences: data.sentences,
      packs: data.packs,
      types: [...data.types].sort(),
      lessons: [...data.lessons].sort((a, b) => a - b),
    };
  }

  return {
    totalRows: normalizedRows.length,
    totalPacks: packs.length,
    byLevel: levelSummary,
  };
}

export function packToLessonJson(pack) {
  return {
    id: pack.id,
    level: pack.level,
    lesson: pack.lesson,
    type: pack.type,
    title: pack.title,
    sentences: pack.sentences.map((s) => ({
      id: s.id,
      sentence: s.sentence,
    })),
  };
}

export function packToManifestLessonEntry(pack) {
  return {
    id: pack.id,
    lesson: pack.lesson,
    type: pack.type,
    title: pack.title,
    file: pack.file,
    availability: "available",
  };
}

/**
 * Merge generated PiS/PiW lessons into existing manifest (does not remove unrelated levels).
 */
export function mergeManifestWithPacks(existingManifest, packs) {
  const base =
    existingManifest && typeof existingManifest === "object"
      ? structuredClone(existingManifest)
      : { version: 1, levels: [] };

  if (!Array.isArray(base.levels)) base.levels = [];

  const lessonsByLevel = new Map();
  for (const level of PIS_PIW_LEVELS) {
    lessonsByLevel.set(level, []);
  }
  packs.forEach((p) => {
    if (!lessonsByLevel.has(p.level)) lessonsByLevel.set(p.level, []);
    lessonsByLevel.get(p.level).push(packToManifestLessonEntry(p));
  });

  for (const [levelId, lessons] of lessonsByLevel) {
    lessons.sort((a, b) => a.lesson - b.lesson);
    const idx = base.levels.findIndex((l) => l?.id === levelId);
    if (idx >= 0) {
      base.levels[idx] = {
        ...base.levels[idx],
        id: levelId,
        label: base.levels[idx].label || levelId,
        lessons,
      };
    } else {
      base.levels.push({ id: levelId, label: levelId, lessons });
    }
  }

  const order = [...PIS_PIW_LEVELS];
  base.levels.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return String(a.id).localeCompare(String(b.id));
  });

  return base;
}

/** Character-for-character: source row text vs JSON after serialize/parse. */
export function roundTripTextValidation(packs) {
  const mismatches = [];
  packs.forEach((pack) => {
    const json = packToLessonJson(pack);
    const roundTripped = JSON.parse(JSON.stringify(json));
    pack.sentences.forEach((s) => {
      const fromJson = roundTripped.sentences.find((x) => x.id === s.id)?.sentence;
      if (fromJson !== s.sentence) {
        mismatches.push({ pack: pack.id, id: s.id, expected: s.sentence, got: fromJson });
      }
    });
  });
  return { ok: mismatches.length === 0, textChanged: mismatches.length, mismatches };
}

export function sourceRowsRoundTrip(normalizedRows, packs) {
  const byKey = new Map();
  packs.forEach((pack) => {
    pack.sentences.forEach((s) => {
      byKey.set(`${pack.level}|${pack.lesson}|${pack.type}|${s.sourceNumber}`, s.sentence);
    });
  });
  const mismatches = [];
  normalizedRows.forEach((r) => {
    const key = `${r.level}|${r.lesson}|${r.type}|${r.number}`;
    const fromPack = byKey.get(key);
    if (fromPack !== r.sentence) {
      mismatches.push({ key, expected: r.sentence, got: fromPack });
    }
  });
  return { ok: mismatches.length === 0, textChanged: mismatches.length, mismatches };
}

export function compareAcceptanceExpected(stats) {
  const diffs = [];
  if (stats.totalRows !== ACCEPTANCE_EXPECTED.totalRows) {
    diffs.push(`totalRows: expected ${ACCEPTANCE_EXPECTED.totalRows}, got ${stats.totalRows}`);
  }
  if (stats.totalPacks !== ACCEPTANCE_EXPECTED.totalPacks) {
    diffs.push(`totalPacks: expected ${ACCEPTANCE_EXPECTED.totalPacks}, got ${stats.totalPacks}`);
  }
  for (const level of PIS_PIW_LEVELS) {
    const exp = ACCEPTANCE_EXPECTED.byLevel[level];
    const got = stats.byLevel[level] || { sentences: 0, packs: 0, types: [] };
    if (got.sentences !== exp.sentences) {
      diffs.push(`${level} sentences: expected ${exp.sentences}, got ${got.sentences}`);
    }
    if (got.packs !== exp.packs) {
      diffs.push(`${level} packs: expected ${exp.packs}, got ${got.packs}`);
    }
    if (got.types.length !== 1 || got.types[0] !== exp.type) {
      diffs.push(`${level} type: expected [${exp.type}], got [${got.types.join(",")}]`);
    }
    if (got.lessons.length !== ACCEPTANCE_EXPECTED.lessonsPerLevel) {
      diffs.push(`${level} lesson count: expected ${ACCEPTANCE_EXPECTED.lessonsPerLevel}, got ${got.lessons.length}`);
    }
    for (const forbidden of ACCEPTANCE_EXPECTED.forbiddenLessons) {
      if (got.lessons.includes(forbidden)) {
        diffs.push(`${level} forbidden lesson ${forbidden} present`);
      }
    }
    const seqStr = got.lessons.join(",");
    const expStr = ACCEPTANCE_EXPECTED.lessonSequence.join(",");
    if (seqStr !== expStr) {
      diffs.push(`${level} lesson sequence: expected ${expStr}, got ${seqStr}`);
    }
  }
  return { ok: diffs.length === 0, diffs };
}
