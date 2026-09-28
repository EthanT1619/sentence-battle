/**
 * Sentence Battle curriculum / tokenization (pure logic, Node + browser import).
 */

export const CONTENT_BASE = "data/";

const AVAILABILITY_AVAILABLE = "available";

/** Teacher custom: [in common] → single card */
export function parseTeacherSentence(sentence) {
  const cards = [];
  const regex = /\[([^\]]+)\]|(\S+)/g;
  let match;
  const text = String(sentence || "").trim();
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      const phrase = match[1].trim();
      if (phrase) cards.push(phrase);
    } else if (match[2]) {
      cards.push(match[2]);
    }
  }
  return cards;
}

export function displaySentenceText(sentence) {
  return String(sentence || "").replace(/\[([^\]]+)\]/g, "$1");
}

/**
 * Default tokenizer: whitespace chunks (keeps I'm, don't, school? as one token).
 */
export function defaultTokenize(sentence) {
  return String(sentence || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenizeForBattle(sentence, explicitTokens) {
  if (Array.isArray(explicitTokens) && explicitTokens.length > 0) {
    return explicitTokens.map((t) => String(t).trim()).filter(Boolean);
  }
  const text = String(sentence || "").trim();
  if (/\[[^\]]+\]/.test(text)) {
    return parseTeacherSentence(text);
  }
  return defaultTokenize(text);
}

export function countLexicalWords(sentence) {
  const cleaned = displaySentenceText(sentence)
    .replace(/[?.!,;:]/g, " ")
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function getTokenCountWarnings(sentence, tokens) {
  const warnings = [];
  const n = tokens.length;
  if (n < 4) warnings.push("token_count_short");
  if (n > 12) warnings.push("token_count_long");
  const lexical = countLexicalWords(sentence);
  if (lexical >= 6 && lexical <= 8 && (n < 6 || n > 10)) {
    warnings.push("token_lexical_mismatch");
  }
  return warnings;
}

function assertUniqueIds(items, key = "id") {
  const seen = new Set();
  const dupes = [];
  for (const item of items) {
    const id = item?.[key];
    if (!id) continue;
    if (seen.has(id)) dupes.push(id);
    else seen.add(id);
  }
  return dupes;
}

export function validateManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["manifest_not_object"], levels: [] };
  }
  const levels = Array.isArray(raw.levels) ? raw.levels : [];
  if (levels.length === 0) errors.push("levels_empty");

  const levelIds = new Set();
  const normalizedLevels = [];

  levels.forEach((level, li) => {
    const id = level?.id;
    if (!id || typeof id !== "string") {
      errors.push(`level_${li}_missing_id`);
      return;
    }
    if (levelIds.has(id)) errors.push(`duplicate_level_id:${id}`);
    levelIds.add(id);

    const lessons = Array.isArray(level.lessons) ? level.lessons : [];
    const lessonIds = new Set();
    const normalizedLessons = [];

    lessons.forEach((lesson, lj) => {
      const lessonId = lesson?.id;
      if (!lessonId) {
        errors.push(`level_${id}_lesson_${lj}_missing_id`);
        return;
      }
      if (lessonIds.has(lessonId)) errors.push(`duplicate_lesson_id:${lessonId}`);
      lessonIds.add(lessonId);

      const file = lesson?.file;
      if (!file || typeof file !== "string") {
        errors.push(`lesson_${lessonId}_missing_file`);
      }

      const availability = lesson?.availability ?? AVAILABILITY_AVAILABLE;
      const available = availability === AVAILABILITY_AVAILABLE;

      normalizedLessons.push({
        id: lessonId,
        lesson: lesson.lesson,
        title: lesson.title || `Lesson ${lesson.lesson ?? ""}`.trim(),
        subtitle: lesson.subtitle,
        pattern: lesson.pattern,
        file: file || "",
        availability,
        available,
        order: lesson.order,
      });
    });

    normalizedLevels.push({
      id,
      label: level.label || level.name || id,
      lessons: normalizedLessons,
    });
  });

  return {
    ok: errors.length === 0,
    errors,
    levels: normalizedLevels,
  };
}

export function validateLesson(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["lesson_not_object"], lesson: null, warnings };
  }
  if (!raw.id) errors.push("missing_id");
  if (!raw.title) errors.push("missing_title");
  if (!Array.isArray(raw.sentences) || raw.sentences.length === 0) {
    errors.push("sentences_missing_or_empty");
  }

  const sentences = Array.isArray(raw.sentences) ? raw.sentences : [];
  const sentenceIds = assertUniqueIds(sentences, "id");
  if (sentenceIds.length) errors.push(`duplicate_sentence_id:${sentenceIds.join(",")}`);

  const normalizedText = new Set();
  const normalizedSentences = [];

  sentences.forEach((item, idx) => {
    const sid = item?.id;
    if (!sid) errors.push(`sentence_${idx}_missing_id`);
    const text = String(item?.sentence ?? "").trim();
    if (!text) errors.push(`sentence_${sid || idx}_empty`);

    const normKey = text.toLowerCase();
    if (normalizedText.has(normKey)) errors.push(`duplicate_sentence:${text}`);
    normalizedText.add(normKey);

    let tokens = null;
    if (item?.tokens !== undefined) {
      if (!Array.isArray(item.tokens)) {
        errors.push(`sentence_${sid || idx}_tokens_not_array`);
      } else {
        tokens = item.tokens.map((t) => String(t).trim()).filter(Boolean);
        if (tokens.length !== item.tokens.length) {
          errors.push(`sentence_${sid || idx}_empty_token`);
        }
        if (tokens.length === 0) errors.push(`sentence_${sid || idx}_tokens_empty`);
      }
    }

    const battleTokens = tokenizeForBattle(text, tokens);
    warnings.push(...getTokenCountWarnings(text, battleTokens));

    normalizedSentences.push({
      id: sid,
      sentence: text,
      tokens: item?.tokens,
      battleTokens,
    });
  });

  const lesson = {
    id: raw.id,
    level: raw.level,
    lesson: raw.lesson,
    title: raw.title,
    pattern: raw.pattern,
    sentences: normalizedSentences,
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    lesson,
  };
}

export function shufflePairs(items) {
  const arr = items.map((item, index) => ({ item, index }));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.map((x) => x.item);
}

/** Pattern Practice → game engine input */
export function normalizeLessonToGameInput(lessonRaw, { shuffle = false } = {}) {
  const validated = validateLesson(lessonRaw);
  if (!validated.ok || !validated.lesson) {
    return { ok: false, errors: validated.errors, warnings: validated.warnings };
  }

  let entries = validated.lesson.sentences.map((s) => ({
    text: s.sentence,
    tokens: s.battleTokens,
    id: s.id,
  }));

  if (shuffle && entries.length > 1) {
    entries = shufflePairs(entries);
  }

  return {
    ok: true,
    errors: [],
    warnings: validated.warnings,
    sentences: entries.map((e) => e.text),
    cardSets: entries.map((e) => e.tokens),
    meta: {
      id: validated.lesson.id,
      title: validated.lesson.title,
      pattern: validated.lesson.pattern,
      level: validated.lesson.level,
      lesson: validated.lesson.lesson,
    },
  };
}

/** Custom teacher lines → game engine input */
export function normalizeTeacherLines(lines) {
  const sentences = [];
  const cardSets = [];
  lines.forEach((line) => {
    const text = String(line || "").trim();
    if (!text) return;
    sentences.push(text);
    cardSets.push(tokenizeForBattle(text, null));
  });
  return { sentences, cardSets };
}

export function resolveContentUrl(relativePath, baseUrl = CONTENT_BASE) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = String(relativePath || "").replace(/^\//, "");
  return `${base}${path}`;
}
