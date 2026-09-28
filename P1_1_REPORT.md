# Sentence Battle P1.1 보고

## 1. 재현된 증상

Pattern Practice에서 Lesson JSON 로드까지는 정상(미리보기·Start Battle 버튼 활성)이나, **Start Battle 클릭 시 아무 반응 없음** (게임 화면 전환 없음).

## 2. 실제 root cause

`selectPatternLesson()` 성공 후 `renderPatternList()`를 호출하는데, 이 함수 **맨 앞에서 `hidePatternMeta()`를 항상 실행**했다.

`hidePatternMeta()`는 UI뿐 아니라 **`patternUI.selectedLesson = null`** 까지 초기화한다.

그 직후 `startPatternBattle()`은:

```javascript
if (!patternUI.selectedLesson) return;
```

으로 **조용히 종료** → 클릭해도 반응 없음.

## 3. Start 경로에서 끊긴 위치

| 단계 | 수정 전 |
|------|---------|
| A. button click handler | ✅ 실행 |
| B. selected lesson 존재 | ❌ **null (B에서 차단)** |
| C~H | 미실행 |

## 4. 수정 내용

- `hidePatternMetaPanel()` (UI만 숨김) vs `clearPatternSelection()` (state 초기화) 분리
- `renderPatternList()`에서 **lesson load 완료 후 selection을 지우지 않음**
- lesson 목록 렌더 후 `selectedLesson`이 있으면 **meta 패널 재표시**
- `startPatternBattle()`에 runtime input 검증 + 실패 시 학생용 메시지
- `applyPatternRuntimeState()` / `hasValidBattleInput()`로 Custom과 동일 precondition

## 5. Pattern runtime state

- sentences count: **7** (LSA sample lesson01)
- cardSets count: **7**
- 동일 길이: **yes**
- shuffle: entry pair 단위 (`shufflePairs`) — sentences/cardSets 대응 유지

## 6. 실제 Chrome Pattern Battle 시작 결과

`http://127.0.0.1:8080/?mode=pattern` → LSA → Can you ~? → Start Battle

→ **게임 화면 진입**, 라운드 1 / 8 (일반), 카드 타일 표시 확인

## 7. 첫 문장 진행 결과

첫 카드(`Can`) 클릭 → 정답 처리(카드 UI 반응) 확인

## 8. Custom Battle regression

코드 경로: Custom은 `state.sentences`/`cardSets` push 후 `startGame()` — Pattern 전용 engine branch 없음.  
(동일 `startGame` → `startRound` → `beginSentence`)

## 9. 자동 테스트

`tests/p1-curriculum.mjs`: **19/19 OK** (Pattern start precondition + shuffle pair 테스트 추가)

## 10. 수정 파일

- `js/main.js`
- `tests/p1-curriculum.mjs`
- `P1_1_REPORT.md` (본 문서)

## 11. P1 release verdict

**GO** — Pattern Start Battle + Custom regression 경로 정상 (HTTP 로컬 서버 기준).
