# Sentence Battle P1 보고

## 1. 기존 Vocab Study fetch 구조에서 참고한 부분

- **`presets/manifest.json` + 상대 경로 fetch** 패턴 (`PRESETS_BASE` + `fetch(manifest.json)`)
- **manifest는 가벼운 인덱스**, 실제 콘텐츠 JSON은 **선택 시 on-demand fetch**
- **in-memory cache** (`Map` / 단일 manifest cache) — 같은 세션 반복 fetch 방지
- **학생용 메시지**와 **console.error 개발자 로그** 분리
- **브라우저 preset 목록 UI**: Level → Lesson/목록 → Load

Vocab Study의 word list semantics(`words`, weekly 30 merge 등)는 **가져오지 않음**.

## 2. Sentence Battle 기존 input 구조

- Custom Battle: `state.sentences[]` (교사 입력 문자열)
- 카드 생성: `[in common]` 대괄호 구 + 공백 토큰 (`parseTeacherSentence`)
- 게임 엔진: `sentences.length` 기준 라운드/보스, `cardSets`와 병렬 배열로 카드 순서 유지

## 3. manifest 구조

- 경로: `data/manifest.json`
- 필드: `version`, `levels[].id`, `levels[].label`, `lessons[].id`, `lesson`, `title`, `file`, `availability`
- `availability !== "available"` → Pattern Practice 목록에서 **숨김**
- LSA/LSB **hard-code 없음** — manifest JSON만 확장하면 레벨 추가 가능

## 4. lesson JSON schema

- `id`, `level`, `lesson`, `title`, `pattern`, `sentences[]`
- sentence item: `id`, `sentence` (필수), `tokens` (선택)

## 5. sentence / tokens 정책

- **canonical 표시**: `sentence` 문자열
- **`tokens` 있음** → 그대로 battle cards
- **없음 + `[...]`** (Custom) → teacher bracket parser
- **없음 + 일반 문장** → whitespace tokenizer (`I'm`, `don't`, `school?` 한 덩어리 유지)
- QA warning만 (4 미만 / 12 초과 등), **hard limit 없음**

## 6. 6~8단어 문장 UI 결과

- 샘플 LSA pack 6문장 + tokens 예시 1문장 포함
- CSS: `.cards` flex-wrap, 390px 미디어쿼리로 카드 padding/간격 조정
- **실제 1280/690/390 브라우저 smoke는 Live Server 환경에서 수동 확인 권장** (file://는 fetch 제한)

## 7. Pattern Practice selector

- 홈 → **Pattern Practice** / **Custom Battle**
- Pattern: manifest fetch → Level → Lesson card → lesson JSON fetch → Start Battle
- 로딩/실패/empty 학생용 문구 적용

## 8. Custom Battle regression

- Custom 화면·문장 추가/삭제·`[구]` 묶기·HP 설정·게임 루프 **기존과 동일 엔진** (`js/main.js`)
- `cardSets` 병렬 배열로 teacher/parser 동작 유지
- 자동 테스트: `parseTeacherSentence` ↔ `tokenizeForBattle` legacy 일치 검증

## 9. fetch / cache / loading / error

| 항목 | 구현 |
|------|------|
| manifest fetch | Pattern Practice 진입 시 |
| lesson fetch | 패턴 선택 시 |
| cache | `manifestCache`, `lessonCache` (session memory) |
| loading | "연습 문제를 불러오고 있어요..." |
| failure | "연습 문제를 불러오지 못했어요. 선생님께 알려 주세요." |
| empty | "아직 준비된 연습 문제가 없어요." |

## 10. adapter 구조

```
Custom:  textarea lines → tokenizeForBattle → sentences[] + cardSets[]
Pattern: lesson JSON → normalizeLessonToGameInput → sentences[] + cardSets[]
Engine:  동일 startGame() / startRound() / onCardClick()
```

## 11. query parameter entry

- `?mode=pattern` → Pattern Practice 바로 진입
- `?mode=custom` → Custom Battle
- `?entry=student` → Pattern Practice (Student Playground용 통일 후보)
- 기본: 홈 (두 모드 선택)

## 12. responsive 결과

- `style.css`에 390px 카드/레이아웃 조정 추가
- horizontal scroll 방지를 위해 battle column stack (narrow)

## 13. 자동 테스트

```powershell
powershell -File tests/run-p1-tests.ps1
```

17개 케이스: manifest/lesson validation, tokenization, adapter, teacher regression.

## 14. 생성/수정 파일

**추가**

- `data/manifest.json`
- `data/LSA/lesson01.json`
- `data/LSB/lesson01.json`
- `js/content/logic.mjs`
- `js/curriculum-fetch.mjs`
- `js/main.js`
- `tests/p1-curriculum.mjs`
- `tests/run-p1-tests.ps1`
- `P1_REPORT.md`

**수정**

- `index.html` (홈/Pattern/Custom 화면, module entry)
- `style.css` (selector/responsive)

**삭제**

- `script.js` (→ `js/main.js` ES module로 이전)

## 15. 향후 curriculum import 방식

- `js/content/logic.mjs`의 `CONTENT_BASE = "data/"` 한 곳만 변경하면 static path 교체 가능
- private repo / CDN / Teacher Toolkit 배포 시 manifest + lesson JSON만 교체
- 대량 CHESS import는 converter pipeline(Vocab Study `tools/convert-presets`와 유사)을 **별도 P2**에서 추가 권장

---

**테스트 실행 결과 (로컬):** `tests/p1-curriculum.mjs` — 17/17 OK

**브라우저 확인:** `index.html`을 **Live Server** 등으로 연 뒤 Pattern Practice 1회 + Custom Battle 1회 regression 권장.
