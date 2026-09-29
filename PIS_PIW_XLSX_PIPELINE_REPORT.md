# PiS / PiW XLSX Content Pipeline 보고서

## 1. 현재 runtime contract 분석

| 구성요소 | 역할 |
|---------|------|
| `data/manifest.json` | `version`, `levels[]` → 각 level에 `lessons[]` (`id`, `lesson`, `title`, `file`, `availability`) |
| `js/curriculum-fetch.mjs` | `fetchManifest` / `fetchLesson` → `validateManifest` / `validateLesson` |
| `js/content/logic.mjs` | 토큰화(`defaultTokenize`: 공백 `\s+` 분리), `normalizeLessonToGameInput` → `sentences[]` + `cardSets[]` |
| `js/main.js` | Pattern Practice: manifest → lesson JSON fetch → Start Battle (엔진 변경 없음) |

**Lesson JSON contract (runtime 검증 기준)**

- 필수: `id`, `title`, `sentences[]` (각 `id`, `sentence` non-empty)
- 선택: `level`, `lesson`, `pattern`, `type`, `sentences[].tokens`
- `pattern`은 source에 없으면 생성하지 않음
- `validateLesson`은 로드 시 `sentence`를 `.trim()`하여 battle에 사용 (converter는 XLSX 원문을 JSON에 그대로 기록)

**토큰 / 카드**

- 공백 없는 `Mr.Cunningham`, `Dr.Frankenstein`, `Dr.Webber` 등은 whitespace tokenizer로 **한 카드** 유지 (구두점이 붙으면 `Mr.Cunningham.`처럼 한 토큰)
- explicit `tokens` 배열은 workbook pack에는 사용하지 않음 (기존 Custom Battle / 샘플 lesson07 tokens 패턴과 동일하게 optional)

## 2. 추가/수정 파일

| 파일 | 설명 |
|------|------|
| `tools/pis-piw-logic.mjs` | 파싱·검증·pack 생성·manifest merge·round-trip·acceptance 집계 (pure) |
| `tools/convert-pis-piw.mjs` | CLI: 기본 dry-run, `--write` 시 temp → `data/` 반영 |
| `tests/pis-piw-convert.mjs` | 600/80 acceptance, round-trip, 대표 pack, Mr.Cunningham 토큰 smoke |
| `tests/browser-fetch-smoke.mjs` | HTTP manifest + LSA–LSD lesson01 fetch / normalize smoke |
| `package.json` | `convert-pis-piw`, `test` 스크립트 |
| `data/**` | `--write`로 생성된 80개 lesson JSON + 갱신된 `manifest.json` |
| (삭제) `data/LSA/lesson01.json`, `lesson02.json`, `data/LSB/lesson01.json` | 구 샘플 curriculum (manifest에서 더 이상 참조하지 않음) |

**변경 없음 (의도)**

- `js/main.js`, Battle Engine, Custom Battle 흐름
- 브라우저 XLSX 파싱 / SheetJS runtime dependency

## 3. XLSX validation 결과

소스: `C:\Users\ksh12\OneDrive\Desktop\PiS and PiW base input.xlsx` (Sheet1)

- 필수 header: Level, Lesson, Type, Number, Sentence — **OK**
- validation errors: **0**
- duplicate Level+Lesson+Type+Number: **0**
- pack 내부 Number 중복 / 비연속: **0**
- duplicate pack id / output path: **0**
- leading/trailing whitespace on Sentence: **0** (해당 시 ERROR, auto-trim 없음)

## 4. 600 rows / 80 packs 집계

| 항목 | 값 |
|------|-----|
| Total sentence rows | **600** |
| Total packs | **80** |

## 5. Level별 집계

| Level | Sentences | Packs | Type (XLSX source) |
|-------|-----------|-------|---------------------|
| LSA | 120 | 20 | PiS |
| LSB | 160 | 20 | PiS |
| LSC | 160 | 20 | PiW |
| LSD | 160 | 20 | PiW |

각 level lesson 수: **20**  
lesson sequence: **1–10, 13–22** (11/12 없음 — 정상)

## 6. 생성된 JSON 경로

命名 convention:

- `data/{LEVEL}/lesson{NN}-{pis|piw}.json`
- pack id: `{level}-NN-{type}` (예: `lsa-01-pis`)
- sentence id: `s01` … `sNN` (XLSX Number 기준)

예:

- `data/LSA/lesson01-pis.json` — 6 sentences
- `data/LSB/lesson01-pis.json` — 8 sentences
- `data/LSC/lesson01-piw.json` — 8 sentences
- `data/LSD/lesson01-piw.json` — 8 sentences

총 **80** files.

## 7. manifest 변경 방식

- 기존 `version` 및 구조 유지
- **LSA, LSB, LSC, LSD** level의 `lessons` 배열만 XLSX에 존재하는 pack으로 **전면 교체**
- 각 entry: `id`, `lesson`, `type`, `title`, `file`, `availability: "available"`
- lesson 정렬: lesson 번호 오름차순 (10 다음 13)
- lesson 11/12 entry **미생성** (manifest grep `"lesson": 11` → **0건**)

## 8. Text round-trip 결과

- XLSX row → pack → `JSON.stringify` → `JSON.parse` → sentence 비교: **TEXT_CHANGED = 0**
- 600/600 character-for-character 일치 (apostrophe, quotation, comma, capitalization, `Mr.Cunningham` 등 유지)

## 9. Mr.Cunningham card-boundary 확인

문장: `We have to be patient with Mr.Cunningham.`

`defaultTokenize` 결과 (한 카드):

`We | have | to | be | patient | with | Mr.Cunningham.`

- `Mr.` / `Cunningham`으로 **분리되지 않음**
- honorific 뒤 공백 자동 삽입 **없음** (converter / tokenizer 모두)

동일 방식 smoke: `Dr.Frankenstein`, `Dr.Webber` — 공백 없이 한 토큰(또는 구두점 포함 한 토큰)

## 10. Lesson 11/12 미생성 확인

- converter output packs: lesson 11/12 **0**
- manifest available lessons: 11/12 **없음**
- LSA lesson 10 다음 manifest lesson: **13** (`tests/pis-piw-convert.mjs`, `browser-fetch-smoke.mjs`)

## 11. Representative browser smoke 결과

로컬 `http-server` `:8080` 기준:

- `tests/browser-fetch-smoke.mjs`: **OK**
  - manifest 200, validate OK
  - LSA/LSB/LSC/LSD lesson01 JSON 200, sentence count 6/8/8/8
  - `normalizeLessonToGameInput` → battle 입력 shape OK
- UI 수동 클릭(Start Battle 애니메이션)은 본 automation에서 미실행; fetch·validation·normalize 경로는 production과 동일

**LSC Lesson 21 PiW #7** (원문 유지):

`I think riding roller coaster is really fun.`

## 12. Custom Battle regression

- `tests/p1-curriculum.mjs`: **19/19 OK** (`normalizeTeacherLines`, bracket parser, pattern adapter 등)
- `js/main.js` / Custom Battle 코드 **미변경**

## 13. 남은 위험 / 수동 확인 사항

1. **Runtime trim**: `validateLesson`이 sentence를 trim하여 battle에 전달 — 현재 source에 leading/trailing whitespace row 없음. 향후 XLSX에 공백-only padding row가 있으면 converter는 ERROR로 거부.
2. **Token count warnings**: 일부 긴 문장에서 `getTokenCountWarnings` warning 가능 (기존 behavior, 게임 시작은 가능).
3. **Teacher typo in source**: 예) LSD L17 `creat` — converter는 수정하지 않음; curriculum QA는 XLSX에서만.
4. **GitHub Pages**: 로컬 `--write` 반영 후 deploy 시 `data/` 80 JSON + manifest 업로드 필요 (본 작업에서 commit/push/deploy 하지 않음).

---

## 사용법

```text
# dry-run (기본, 파일 미작성)
node tools/convert-pis-piw.mjs "C:\path\PiS and PiW base input.xlsx"

# 실제 반영
node tools/convert-pis-piw.mjs "C:\path\PiS and PiW base input.xlsx" --write

npm test
node tests/browser-fetch-smoke.mjs
```

---

## 최종 판정

**GO**
