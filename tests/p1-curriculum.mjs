import assert from "node:assert/strict";
import {
  defaultTokenize,
  normalizeLessonToGameInput,
  normalizeTeacherLines,
  parseTeacherSentence,
  tokenizeForBattle,
  validateLesson,
  validateManifest,
} from "../js/content/logic.mjs";

function testManifestValid() {
  const raw = {
    version: 1,
    levels: [
      {
        id: "LSA",
        label: "LSA",
        lessons: [{ id: "a1", lesson: 1, title: "T", file: "LSA/lesson01.json", availability: "available" }],
      },
    ],
  };
  const res = validateManifest(raw);
  assert.equal(res.ok, true);
  assert.equal(res.levels[0].lessons[0].available, true);
}

function testManifestDuplicateLevel() {
  const raw = {
    levels: [
      { id: "LSA", lessons: [] },
      { id: "LSA", lessons: [] },
    ],
  };
  const res = validateManifest(raw);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.startsWith("duplicate_level_id")));
}

function testManifestDuplicateLesson() {
  const raw = {
    levels: [
      {
        id: "LSA",
        lessons: [
          { id: "x", file: "a.json" },
          { id: "x", file: "b.json" },
        ],
      },
    ],
  };
  const res = validateManifest(raw);
  assert.ok(res.errors.some((e) => e.startsWith("duplicate_lesson_id")));
}

function testManifestMissingFile() {
  const raw = { levels: [{ id: "LSA", lessons: [{ id: "x" }] }] };
  const res = validateManifest(raw);
  assert.ok(res.errors.some((e) => e.includes("missing_file")));
}

function testManifestUnavailableFlag() {
  const raw = {
    levels: [
      {
        id: "LSA",
        lessons: [{ id: "x", file: "a.json", availability: "unavailable" }],
      },
    ],
  };
  const res = validateManifest(raw);
  assert.equal(res.levels[0].lessons[0].available, false);
}

function testLessonValid() {
  const raw = {
    id: "lsa-01",
    title: "Can you",
    sentences: [
      { id: "s1", sentence: "Can you play soccer?" },
      { id: "s2", sentence: "Can you swim well?" },
    ],
  };
  const res = validateLesson(raw);
  assert.equal(res.ok, true);
}

function testLessonDuplicateSentenceId() {
  const raw = {
    id: "x",
    title: "t",
    sentences: [
      { id: "s1", sentence: "A" },
      { id: "s1", sentence: "B" },
    ],
  };
  const res = validateLesson(raw);
  assert.ok(res.errors.some((e) => e.startsWith("duplicate_sentence_id")));
}

function testLessonDuplicateSentenceText() {
  const raw = {
    id: "x",
    title: "t",
    sentences: [
      { id: "s1", sentence: "Hello world" },
      { id: "s2", sentence: "Hello world" },
    ],
  };
  const res = validateLesson(raw);
  assert.ok(res.errors.some((e) => e.startsWith("duplicate_sentence")));
}

function testLessonEmptySentence() {
  const raw = { id: "x", title: "t", sentences: [{ id: "s1", sentence: "  " }] };
  const res = validateLesson(raw);
  assert.ok(res.errors.some((e) => e.includes("empty")));
}

function testLessonOptionalTokens() {
  const raw = {
    id: "x",
    title: "t",
    sentences: [{ id: "s1", sentence: "Hi?", tokens: ["Hi", "?"] }],
  };
  const res = validateLesson(raw);
  assert.equal(res.ok, true);
  assert.deepEqual(res.lesson.sentences[0].battleTokens, ["Hi", "?"]);
}

function testLessonInvalidTokens() {
  const raw = {
    id: "x",
    title: "t",
    sentences: [{ id: "s1", sentence: "Hi", tokens: ["", "ok"] }],
  };
  const res = validateLesson(raw);
  assert.ok(res.errors.some((e) => e.includes("empty_token")));
}

function testTokenizeContraction() {
  assert.deepEqual(defaultTokenize("I'm fine today"), ["I'm", "fine", "today"]);
  assert.deepEqual(defaultTokenize("Don't worry about it"), ["Don't", "worry", "about", "it"]);
}

function testTokenizeQuestionAttached() {
  assert.deepEqual(defaultTokenize("Can you play soccer after school?"), [
    "Can",
    "you",
    "play",
    "soccer",
    "after",
    "school?",
  ]);
}

function testExplicitTokensOverride() {
  const tokens = tokenizeForBattle("Can you play?", ["Can", "you", "play", "?"]);
  assert.deepEqual(tokens, ["Can", "you", "play", "?"]);
}

function testTeacherBracketAdapter() {
  const custom = normalizeTeacherLines(["I am [in common] with him"]);
  assert.equal(custom.sentences.length, 1);
  assert.deepEqual(custom.cardSets[0], ["I", "am", "in common", "with", "him"]);
}

function testJsonAdapterShape() {
  const lesson = {
    id: "lsa-01",
    title: "Sample",
    sentences: [{ id: "s1", sentence: "Can you play soccer?" }],
  };
  const norm = normalizeLessonToGameInput(lesson);
  assert.equal(norm.ok, true);
  assert.equal(norm.sentences.length, 1);
  assert.equal(norm.cardSets.length, 1);
  assert.ok(Array.isArray(norm.cardSets[0]));
}

function testTeacherParseMatchesLegacy() {
  const line = "I am [in common] with him";
  assert.deepEqual(parseTeacherSentence(line), tokenizeForBattle(line, null));
}

function testPatternStartPreconditions() {
  const lesson = {
    id: "lsa-01",
    title: "Can you",
    sentences: [
      { id: "s1", sentence: "Can you play soccer?" },
      { id: "s2", sentence: "Can you swim well?" },
    ],
  };
  const norm = normalizeLessonToGameInput(lesson, { shuffle: true });
  assert.equal(norm.ok, true);
  assert.ok(norm.sentences.length > 0);
  assert.equal(norm.sentences.length, norm.cardSets.length);
  assert.ok(norm.cardSets.every((set) => set.length > 0));
}

function testPatternShuffleKeepsPairs() {
  const lesson = {
    id: "x",
    title: "t",
    sentences: [
      { id: "a", sentence: "Alpha one here" },
      { id: "b", sentence: "Beta two there" },
      { id: "c", sentence: "Gamma three now" },
    ],
  };
  const norm = normalizeLessonToGameInput(lesson, { shuffle: true });
  norm.sentences.forEach((text, i) => {
    const tokens = norm.cardSets[i];
    assert.ok(tokens.includes(text.split(/\s+/)[0]));
  });
}

const tests = [
  testManifestValid,
  testManifestDuplicateLevel,
  testManifestDuplicateLesson,
  testManifestMissingFile,
  testManifestUnavailableFlag,
  testLessonValid,
  testLessonDuplicateSentenceId,
  testLessonDuplicateSentenceText,
  testLessonEmptySentence,
  testLessonOptionalTokens,
  testLessonInvalidTokens,
  testTokenizeContraction,
  testTokenizeQuestionAttached,
  testExplicitTokensOverride,
  testTeacherBracketAdapter,
  testJsonAdapterShape,
  testTeacherParseMatchesLegacy,
  testPatternStartPreconditions,
  testPatternShuffleKeepsPairs,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`OK ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${t.name}`, err);
  }
}
process.exit(failed ? 1 : 0);
