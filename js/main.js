import {
  displaySentenceText,
  normalizeLessonToGameInput,
  tokenizeForBattle,
} from "./content/logic.mjs";
import { fetchLesson, fetchManifest } from "./curriculum-fetch.mjs";

const $ = (id) => document.getElementById(id);

const SOUND_BASE = "asset/sounds/";
const VOLUME = { bgm: 0.2, sfx: 0.8, stinger: 0.5 };

const audio = { unlocked: false, currentBgm: null, sfx: {}, bgm: {} };

function createAudio(name, { loop = false, volume = 1 } = {}) {
  const el = new Audio();
  el.loop = loop;
  el.volume = volume;
  const exts = [".mp3", ".wav", ".ogg"];
  let extIndex = 0;
  const tryNext = () => {
    if (extIndex < exts.length) el.src = SOUND_BASE + name + exts[extIndex++];
  };
  el.addEventListener("error", tryNext);
  tryNext();
  return el;
}

function initAudio() {
  ["player_attack", "player_damage", "pick_card"].forEach((name) => {
    audio.sfx[name] = createAudio(name, { volume: VOLUME.sfx });
  });
  audio.sfx.boss_fail = createAudio("boss_fail", { volume: VOLUME.stinger });
  audio.sfx.victory = createAudio("victory", { volume: VOLUME.stinger });
  audio.bgm.regular = createAudio("regular_fight", { loop: true, volume: VOLUME.bgm });
  audio.bgm.boss = createAudio("boss_fight", { loop: true, volume: VOLUME.bgm });
}

function unlockAudio() {
  if (audio.unlocked) return;
  audio.unlocked = true;
  Object.values(audio.sfx).forEach((s) => s.load());
  Object.values(audio.bgm).forEach((b) => b.load());
}

function playSfx(name) {
  if (!audio.unlocked) return;
  const sound = audio.sfx[name];
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function stopBgm() {
  Object.values(audio.bgm).forEach((bgm) => {
    bgm.pause();
    bgm.currentTime = 0;
  });
  audio.currentBgm = null;
}

function playBgm(type) {
  if (!audio.unlocked) return;
  if (audio.currentBgm === type) return;
  stopBgm();
  const bgm = audio.bgm[type];
  if (!bgm) return;
  bgm.volume = VOLUME.bgm;
  bgm.play().catch(() => {});
  audio.currentBgm = type;
}

initAudio();

const MONSTER_SPRITES = ["🐸", "🦇", "👻", "🕷️", "🐺", "🦴", "🐙"];
const MONSTER_NAMES = ["슬라임", "박쥐", "유령", "거미", "늑대", "해골", "문어"];
const BOSS_SPRITE = "🐲";
const BOSS_NAME = "문법 보스";

const ITEMS = {
  shield: { icon: "🛡️", name: "실드", desc: "다음 실수 HP 피해 방어" },
  hint: { icon: "💡", name: "힌트", desc: "다음 카드 1개 표시" },
  heal: { icon: "❤️", name: "회복", desc: "HP +2" },
};

const state = {
  contentMode: "custom",
  patternMeta: null,
  sentences: [],
  cardSets: [],
  sentenceTargets: [],
  round: 0,
  bossPhase: 0,
  sentenceIndex: 0,
  correctWords: [],
  currentIndex: 0,
  built: "",
  gauge: 0,
  enemyHp: 50,
  enemyMaxHp: 50,
  playerHp: 30,
  playerMaxHp: 30,
  inventory: [],
  shieldActive: false,
  bossInitialized: false,
};

const patternUI = {
  levels: [],
  browseLevel: null,
  selectedLesson: null,
  selectedLessonEntry: null,
  loading: false,
};

function isBossRound() {
  return state.round >= state.sentences.length;
}

function displaySentence(sentence) {
  return displaySentenceText(sentence);
}

function computeSentenceTargets(enemyHp, sentenceCount) {
  const base = Math.floor(enemyHp / sentenceCount);
  const remainder = enemyHp % sentenceCount;
  return Array.from({ length: sentenceCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

function calcDamage(gauge, sentenceIndex) {
  const target = state.sentenceTargets[sentenceIndex] ?? 0;
  const base = Math.round(target * 0.6);
  const bonus = Math.round(target * 0.4 * (gauge / 100));
  return { base, bonus, total: base + bonus, target };
}

function updateDamagePreview() {
  const preview = $("damage-preview");
  if (!preview) return;
  const bossHp = parseInt($("enemy-hp").value, 10) || 50;
  const count = state.sentences.length;
  if (count === 0) {
    preview.textContent = "";
    return;
  }
  const targets = computeSentenceTargets(bossHp, count);
  const perRound = targets.map((t, i) => `R${i + 1}:${t}`).join(", ");
  preview.innerHTML =
    `<strong>라운드 구성</strong><br>` +
    `일반 ${count}라운드 (몬스터 HP: ${perRound}) + 보스 1라운드 (HP ${bossHp})<br>` +
    `보스전: 이전 문장 ${count}개를 순서대로 복습 공격 · 라운드마다 아이템 1개 획득 (보스전에 사용)`;
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`${name}-screen`).classList.add("active");
}

function getExitScreen() {
  return state.contentMode === "pattern" ? "pattern" : "custom";
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function updateHpBars() {
  const enemyPct = (state.enemyHp / state.enemyMaxHp) * 100;
  const playerPct = (state.playerHp / state.playerMaxHp) * 100;
  $("enemy-fill").style.width = `${Math.max(0, enemyPct)}%`;
  $("player-fill").style.width = `${Math.max(0, playerPct)}%`;
  $("enemy-hp-text").textContent = `${Math.max(0, state.enemyHp)} / ${state.enemyMaxHp}`;
  $("player-hp-text").textContent = `${Math.max(0, state.playerHp)} / ${state.playerMaxHp}`;
}

function updateGauge() {
  const pct = Math.max(0, Math.min(100, state.gauge));
  $("gauge-fill").style.width = `${pct}%`;
  $("gauge-text").textContent = `${pct}%`;
}

function renderSentenceList() {
  const list = $("sentence-list");
  list.innerHTML = "";
  state.sentences.forEach((s, i) => {
    const cards = state.cardSets[i] || tokenizeForBattle(s, null);
    const li = document.createElement("li");
    li.innerHTML =
      `<span>${displaySentence(s)} <small class="card-count">(${cards.length}장: ${cards.join(" · ")})</small></span>` +
      `<button data-i="${i}" title="삭제">✕</button>`;
    list.appendChild(li);
  });
  $("hint").style.display = state.sentences.length ? "none" : "block";
  $("start-btn").disabled = state.sentences.length === 0;
  updateDamagePreview();
}

function setMessage(text, type = "") {
  const el = $("message");
  el.textContent = text;
  el.className = "message" + (type ? ` ${type}` : "");
}

function setupMonster(roundIndex) {
  const sprite = MONSTER_SPRITES[roundIndex % MONSTER_SPRITES.length];
  const name = MONSTER_NAMES[roundIndex % MONSTER_NAMES.length];
  state.enemyMaxHp = state.sentenceTargets[roundIndex];
  state.enemyHp = state.enemyMaxHp;
  $("enemy-panel").classList.remove("boss-panel");
  $("enemy-sprite").classList.remove("defeated");
  $("enemy-sprite").textContent = sprite;
  $("monster-name").textContent = `라운드 ${roundIndex + 1} — ${name}`;
  $("enemy-hp-label").textContent = "몬스터 HP";
  updateHpBars();
}

function setupBoss() {
  state.enemyMaxHp =
    state.contentMode === "pattern"
      ? parseInt($("pattern-enemy-hp").value, 10) || 50
      : parseInt($("enemy-hp").value, 10) || 50;
  state.enemyHp = state.enemyMaxHp;
  state.bossPhase = 0;
  $("enemy-panel").classList.add("boss-panel");
  $("enemy-sprite").classList.remove("defeated");
  $("enemy-sprite").textContent = BOSS_SPRITE;
  $("monster-name").textContent = `보스 라운드 — ${BOSS_NAME}`;
  $("enemy-hp-label").textContent = "보스 HP";
  updateHpBars();
}

function grantRoundItem() {
  const types = Object.keys(ITEMS);
  const type = types[Math.floor(Math.random() * types.length)];
  state.inventory.push(type);
  updateInventoryUI();
  return ITEMS[type];
}

function updateInventoryUI() {
  const list = $("inventory-list");
  const hint = $("inventory-hint");
  const canUse = isBossRound();
  list.innerHTML = "";
  if (state.inventory.length === 0) {
    hint.textContent = "아이템 없음 — 일반 라운드 클리어 시 획득";
    return;
  }
  hint.textContent = canUse
    ? "보스전 — 아이템을 클릭해 사용하세요"
    : `보유 ${state.inventory.length}개 — 보스전까지 보관 중`;
  state.inventory.forEach((type, index) => {
    const item = ITEMS[type];
    const btn = document.createElement("button");
    btn.className = "inventory-slot";
    btn.textContent = item.icon;
    btn.title = `${item.name}: ${item.desc}`;
    btn.disabled = !canUse;
    btn.addEventListener("click", () => useInventoryItem(index));
    list.appendChild(btn);
  });
}

function useInventoryItem(index) {
  if (!isBossRound()) return;
  const type = state.inventory[index];
  if (!type) return;
  switch (type) {
    case "shield":
      state.shieldActive = true;
      setMessage("🛡️ 실드 활성화! 다음 실수 피해를 막습니다.", "success");
      break;
    case "hint":
      showHint();
      break;
    case "heal":
      state.playerHp = Math.min(state.playerMaxHp, state.playerHp + 2);
      updateHpBars();
      setMessage("❤️ HP +2 회복!", "success");
      break;
  }
  state.inventory.splice(index, 1);
  updateInventoryUI();
}

function showHint() {
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("hinted"));
  const nextWord = state.correctWords[state.currentIndex];
  let shown = false;
  document.querySelectorAll(".card").forEach((card) => {
    if (!card.disabled && card.textContent === nextWord && !shown) {
      card.classList.add("hinted");
      shown = true;
    }
  });
  setMessage(shown ? "💡 다음에 눌러야 할 카드를 표시했습니다!" : "💡 표시할 카드가 없습니다.", "success");
}

function spawnCards(words) {
  const area = $("cards");
  area.innerHTML = "";
  shuffle(words).forEach((word) => {
    const card = document.createElement("button");
    card.className = "card";
    card.textContent = word;
    card.addEventListener("click", () => onCardClick(card, word));
    area.appendChild(card);
  });
}

function beginSentence(sentenceIndex) {
  state.sentenceIndex = sentenceIndex;
  const sentence = state.sentences[sentenceIndex];
  state.correctWords = state.cardSets[sentenceIndex] || tokenizeForBattle(sentence, null);
  state.currentIndex = 0;
  state.built = "";
  state.gauge = 0;

  const target = state.sentenceTargets[sentenceIndex];
  const minDmg = Math.round(target * 0.6);

  if (isBossRound()) {
    $("round-info").textContent =
      `보스 라운드 — 복습 ${state.bossPhase + 1} / ${state.sentences.length}`;
    $("damage-info").textContent =
      `복습 문장: "${displaySentence(sentence)}" · 데미지 ${minDmg} ~ ${target}`;
  } else {
    $("round-info").textContent =
      `라운드 ${state.round + 1} / ${state.sentences.length + 1} (일반)`;
    $("damage-info").textContent =
      `이 문장 데미지: ${minDmg} ~ ${target} (게이지 100% → ${target})`;
  }

  $("built").textContent = "";
  setMessage("카드를 올바른 순서로 클릭하세요");
  updateGauge();
  updateInventoryUI();
  spawnCards(state.correctWords);
}

function startRound() {
  if (isBossRound()) {
    if (!state.bossInitialized) {
      state.bossInitialized = true;
      setupBoss();
      playBgm("boss");
      updateInventoryUI();
      setMessage(
        `👹 보스 등장! 모은 아이템 ${state.inventory.length}개를 사용할 수 있습니다!`,
        "success"
      );
    }
    beginSentence(state.bossPhase);
    return;
  }
  playBgm("regular");
  setupMonster(state.round);
  beginSentence(state.round);
}

function retrySentence() {
  beginSentence(isBossRound() ? state.bossPhase : state.round);
}

function onCardClick(card, word) {
  if (card.disabled) return;
  playSfx("pick_card");

  if (word === state.correctWords[state.currentIndex]) {
    card.classList.add("correct");
    card.disabled = true;
    setTimeout(() => card.remove(), 280);
    state.built += (state.built ? " " : "") + word;
    $("built").textContent = state.built;
    state.currentIndex++;
    state.gauge = Math.min(
      100,
      Math.round((state.currentIndex / state.correctWords.length) * 100)
    );
    updateGauge();
    setMessage("정답!", "success");
    if (state.currentIndex >= state.correctWords.length) {
      setTimeout(attackEnemy, 400);
    }
  } else {
    card.classList.add("wrong");
    state.gauge = Math.max(0, state.gauge - 15);
    updateGauge();
    enemyCounterAttack();
    setTimeout(() => card.classList.remove("wrong"), 400);
  }
}

function attackEnemy() {
  const { base, bonus, total: damage, target } = calcDamage(state.gauge, state.sentenceIndex);
  state.enemyHp = Math.max(0, state.enemyHp - damage);
  updateHpBars();
  const sprite = $("enemy-sprite");
  sprite.classList.add("hit");
  setTimeout(() => sprite.classList.remove("hit"), 400);
  if (isBossRound()) playSfx("player_attack");
  setMessage(
    `⚔️ 공격! -${damage} (기본 ${base} + 게이지 ${bonus}, 목표 ${target})`,
    "success"
  );
  if (isBossRound()) handleBossAfterAttack();
  else handleNormalAfterAttack();
}

function handleNormalAfterAttack() {
  if (state.enemyHp <= 0) {
    playSfx("player_attack");
    const item = grantRoundItem();
    setMessage(
      `🎉 라운드 ${state.round + 1} 클리어! ${item.icon} ${item.name} 획득 (보스전에 사용)`,
      "success"
    );
    state.round++;
    setTimeout(() => startRound(), 1400);
    return;
  }
  setTimeout(() => {
    setMessage(`몬스터 HP ${state.enemyHp} 남음! 같은 문장으로 다시 공격하세요.`, "fail");
    retrySentence();
  }, 1000);
}

function handleBossAfterAttack() {
  if (state.enemyHp <= 0) {
    setTimeout(finishVictory, 600);
    return;
  }
  state.bossPhase++;
  if (state.bossPhase >= state.sentences.length) {
    setTimeout(finishVictory, 600);
    return;
  }
  setTimeout(() => {
    setMessage(`보스 HP ${state.enemyHp} 남음 — 다음 복습 문장!`, "success");
    beginSentence(state.bossPhase);
  }, 1200);
}

function finishVictory() {
  stopBgm();
  playSfx("victory");
  state.enemyHp = 0;
  updateHpBars();
  const sprite = $("enemy-sprite");
  sprite.classList.add("defeated");
  sprite.textContent = "💀";
  setMessage("🎯 보스 처치! 모든 문장 복습 완료!", "success");
  setTimeout(() => endGame(true), 1200);
}

function enemyCounterAttack() {
  if (state.shieldActive) {
    state.shieldActive = false;
    setMessage("🛡️ 실드가 피해를 막았습니다!", "success");
    return;
  }
  const dmg = 5;
  state.playerHp -= dmg;
  updateHpBars();
  playSfx("player_damage");
  setMessage(`순서가 틀렸어요! 플레이어 HP -${dmg}`, "fail");
  const sprite = $("enemy-sprite");
  sprite.classList.add("attack-player");
  setTimeout(() => sprite.classList.remove("attack-player"), 400);
  if (state.playerHp <= 0) setTimeout(() => endGame(false), 600);
}

function endGame(victory) {
  stopBgm();
  if (!victory) playSfx("boss_fail");
  showScreen("result");
  if (victory) {
    $("result-icon").textContent = "🎉";
    $("result-title").textContent = "승리!";
    $("result-desc").textContent =
      "모든 라운드를 클리어하고 보스를 처치했습니다! 문장 복습도 완료!";
  } else {
    $("result-icon").textContent = "💀";
    $("result-title").textContent = "패배...";
    $("result-desc").textContent = "플레이어 HP가 0이 되었습니다. 다시 도전해보세요!";
  }
}

function startGame() {
  unlockAudio();
  const bossHp =
    state.contentMode === "pattern"
      ? parseInt($("pattern-enemy-hp").value, 10) || 50
      : parseInt($("enemy-hp").value, 10) || 50;
  state.playerMaxHp =
    state.contentMode === "pattern"
      ? parseInt($("pattern-player-hp").value, 10) || 30
      : parseInt($("player-hp").value, 10) || 30;
  state.sentenceTargets = computeSentenceTargets(bossHp, state.sentences.length);
  state.playerHp = state.playerMaxHp;
  state.round = 0;
  state.bossPhase = 0;
  state.inventory = [];
  state.shieldActive = false;
  state.bossInitialized = false;
  $("enemy-panel").classList.remove("boss-panel");
  updateInventoryUI();
  showScreen("game");
  startRound();
}

function setPatternStatus(text, isError = false) {
  const el = $("pattern-status");
  el.textContent = text;
  el.className = isError ? "hint error-hint" : "hint";
}

function hidePatternMetaPanel() {
  $("pattern-meta").classList.add("hidden");
  $("pattern-start-btn").disabled = true;
}

function clearPatternSelection() {
  patternUI.selectedLesson = null;
  patternUI.selectedLessonEntry = null;
  hidePatternMetaPanel();
}

function hidePatternMeta() {
  clearPatternSelection();
}

function showPatternMeta(entry, lessonData) {
  $("pattern-meta").classList.remove("hidden");
  $("pattern-meta-title").textContent = entry.title;
  $("pattern-meta-pattern").textContent = lessonData.pattern
    ? `Pattern: ${lessonData.pattern}`
    : "";
  $("pattern-start-btn").disabled = !patternUI.selectedLesson;
}

function renderPatternList() {
  const list = $("pattern-list");
  list.innerHTML = "";

  if (patternUI.loading) {
    hidePatternMetaPanel();
    setPatternStatus("연습 문제를 불러오고 있어요...");
    return;
  }

  if (!patternUI.browseLevel) {
    clearPatternSelection();
    setPatternStatus("레벨을 선택하세요.");
    $("pattern-breadcrumb").textContent = "";
    if (patternUI.levels.length === 0) {
      list.innerHTML = '<p class="empty-hint">아직 준비된 연습 문제가 없어요.</p>';
      return;
    }
    patternUI.levels.forEach((level) => {
      const btn = document.createElement("button");
      btn.className = "select-card";
      btn.innerHTML = `<strong>${level.label}</strong><span>${level.lessons.filter((l) => l.available).length}개 패턴</span>`;
      btn.addEventListener("click", () => {
        patternUI.browseLevel = level;
        renderPatternList();
      });
      list.appendChild(btn);
    });
    return;
  }

  $("pattern-breadcrumb").textContent = `${patternUI.browseLevel.label} · Lesson 선택`;
  setPatternStatus("패턴을 선택하세요.");

  const lessons = patternUI.browseLevel.lessons.filter((l) => l.available);
  if (lessons.length === 0) {
    list.innerHTML = '<p class="empty-hint">아직 준비된 연습 문제가 없어요.</p>';
    return;
  }

  lessons.forEach((lesson) => {
    const btn = document.createElement("button");
    btn.className = "select-card";
    btn.innerHTML = `<strong>${lesson.title}</strong><span>Lesson ${lesson.lesson ?? ""}</span>`;
    btn.addEventListener("click", () => selectPatternLesson(lesson));
    list.appendChild(btn);
  });

  if (patternUI.selectedLesson && patternUI.selectedLessonEntry) {
    showPatternMeta(patternUI.selectedLessonEntry, patternUI.selectedLesson);
  }
}

async function selectPatternLesson(entry) {
  patternUI.selectedLessonEntry = entry;
  patternUI.selectedLesson = null;
  patternUI.loading = true;
  hidePatternMetaPanel();
  renderPatternList();
  try {
    const validated = await fetchLesson(entry.file);
    patternUI.selectedLesson = validated.lesson;
    patternUI.loading = false;
    renderPatternList();
    showPatternMeta(entry, validated.lesson);
    setPatternStatus("Start Battle를 눌러 시작하세요.");
  } catch (err) {
    console.error("[pattern] lesson load failed", err);
    patternUI.loading = false;
    patternUI.selectedLessonEntry = null;
    renderPatternList();
    setPatternStatus("연습 문제를 불러오지 못했어요. 선생님께 알려 주세요.", true);
  }
}

async function enterPatternPractice() {
  state.contentMode = "pattern";
  patternUI.browseLevel = null;
  patternUI.selectedLesson = null;
  patternUI.selectedLessonEntry = null;
  patternUI.loading = true;
  showScreen("pattern");
  renderPatternList();
  try {
    const manifest = await fetchManifest();
    patternUI.levels = manifest.levels;
    patternUI.loading = false;
    renderPatternList();
  } catch (err) {
    console.error("[pattern] manifest load failed", err);
    patternUI.levels = [];
    patternUI.loading = false;
    renderPatternList();
    setPatternStatus("연습 문제를 불러오지 못했어요. 선생님께 알려 주세요.", true);
  }
}

function applyPatternRuntimeState(normalized) {
  state.sentences = normalized.sentences;
  state.cardSets = normalized.cardSets;
  state.patternMeta = normalized.meta;
}

function hasValidBattleInput() {
  return (
    state.sentences.length > 0 &&
    state.cardSets.length > 0 &&
    state.sentences.length === state.cardSets.length &&
    state.cardSets.every((set) => Array.isArray(set) && set.length > 0)
  );
}

function startPatternBattle() {
  if (!patternUI.selectedLesson) {
    console.error("[pattern] Start Battle blocked: no selected lesson");
    setPatternStatus("연습 문제를 불러오지 못했어요. 선생님께 알려 주세요.", true);
    return;
  }

  const normalized = normalizeLessonToGameInput(patternUI.selectedLesson, { shuffle: true });
  if (!normalized.ok) {
    setPatternStatus("연습 문제를 불러오지 못했어요. 선생님께 알려 주세요.", true);
    console.error("[pattern] normalize failed", normalized.errors);
    return;
  }
  if (normalized.warnings?.length) {
    console.warn("[pattern] QA warnings", normalized.warnings);
  }

  applyPatternRuntimeState(normalized);
  if (!hasValidBattleInput()) {
    console.error("[pattern] invalid runtime input", {
      sentences: state.sentences.length,
      cardSets: state.cardSets.length,
    });
    setPatternStatus("연습 문제를 불러오지 못했어요. 선생님께 알려 주세요.", true);
    return;
  }

  state.contentMode = "pattern";
  startGame();
}

function applyEntryFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const entry = params.get("entry");
  if (mode === "pattern" || entry === "student") {
    enterPatternPractice();
    return;
  }
  if (mode === "custom") {
    state.contentMode = "custom";
    showScreen("custom");
    return;
  }
  showScreen("home");
}

$("go-pattern-btn").addEventListener("click", enterPatternPractice);
$("go-custom-btn").addEventListener("click", () => {
  state.contentMode = "custom";
  showScreen("custom");
});
$("custom-back-btn").addEventListener("click", () => showScreen("home"));
$("pattern-back-btn").addEventListener("click", () => {
  if (patternUI.browseLevel) {
    patternUI.browseLevel = null;
    hidePatternMeta();
    renderPatternList();
    return;
  }
  showScreen("home");
});
$("pattern-start-btn").addEventListener("click", startPatternBattle);

$("add-btn").addEventListener("click", () => {
  const text = $("sentence-input").value.trim();
  if (!text) return;
  state.sentences.push(text);
  state.cardSets.push(tokenizeForBattle(text, null));
  $("sentence-input").value = "";
  renderSentenceList();
});

$("sentence-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("add-btn").click();
});

$("sentence-list").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") {
    const i = parseInt(e.target.dataset.i, 10);
    state.sentences.splice(i, 1);
    state.cardSets.splice(i, 1);
    renderSentenceList();
  }
});

$("enemy-hp").addEventListener("input", updateDamagePreview);
$("start-btn").addEventListener("click", () => {
  state.contentMode = "custom";
  startGame();
});
$("retry-btn").addEventListener("click", retrySentence);

function exitToMenu() {
  stopBgm();
  showScreen(getExitScreen());
}

$("back-btn").addEventListener("click", exitToMenu);
$("back-btn-2").addEventListener("click", exitToMenu);
$("again-btn").addEventListener("click", startGame);

applyEntryFromQuery();
renderSentenceList();
