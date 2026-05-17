const APP_VERSION = "v0.4.0";
const DATA_VERSION = "2026-05-17 battle-dungeons-levels";
const SAVE_KEY = "job-rpg-pwa-sample-v4";

const STAT_LABELS = {
  str: "力",
  agi: "素早さ",
  vit: "身守り",
  int: "賢さ",
  style: "かっこよさ",
  mhp: "MHP",
  mmp: "MMP"
};

const MONSTER_STAT_LABELS = {
  attack: "攻撃力",
  defense: "守備力",
  speed: "素早さ",
  maxHp: "最大HP",
  maxMp: "最大MP",
  exp: "経験値",
  gold: "ゴールド"
};

const RARE_ITEMS = {
  dragon_satori: {
    name: "ドラゴンの悟り",
    targetJobId: "dragon",
    description: "使用すると、上級職「ドラゴン」への転職が解放されます。"
  },
  hagure_satori: {
    name: "はぐれの悟り",
    targetJobId: "metal_sprite",
    description: "使用すると、上級職「はぐれメタル」への転職が解放されます。"
  }
};

const DEFAULT_STATE = {
  playerName: "主人公",
  exp: 0,
  gold: 0,
  currentHp: 28,
  currentMp: 0,
  currentJobId: "unemployed",
  selectedJobId: "unemployed",
  currentDungeonId: "dungeon_01",
  totalBattles: 0,
  jobProgress: {},
  items: {
    dragon_satori: 1,
    hagure_satori: 1
  },
  unlockedJobIds: [],
  acknowledgedUnlocks: [],
  recruitedMonsterIds: [],
  battle: null,
  log: ["RPGサンプルを開始しました。ダンジョンに潜るとターン制バトルが始まります。"]
};

let jobs = [];
let monsters = [];
let dungeons = [];
let heroLevels = [];
let state = clone(DEFAULT_STATE);
let currentFilter = "all";
let monsterFilter = "all";
let monsterSearch = "";
let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path} を読み込めませんでした。GitHub Pages またはローカルサーバー上で実行してください。`);
  return response.json();
}

async function loadData() {
  [jobs, monsters, dungeons, heroLevels] = await Promise.all([
    loadJson("data/jobs.json"),
    loadJson("data/monsters.json"),
    loadJson("data/dungeons.json"),
    loadJson("data/hero-levels.json")
  ]);
}

function loadState() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) {
    state = clone(DEFAULT_STATE);
    clampHpMp(true);
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    state = {
      ...clone(DEFAULT_STATE),
      ...parsed,
      jobProgress: parsed.jobProgress || {},
      items: { ...DEFAULT_STATE.items, ...(parsed.items || {}) },
      unlockedJobIds: Array.isArray(parsed.unlockedJobIds) ? parsed.unlockedJobIds : [],
      acknowledgedUnlocks: Array.isArray(parsed.acknowledgedUnlocks) ? parsed.acknowledgedUnlocks : [],
      recruitedMonsterIds: Array.isArray(parsed.recruitedMonsterIds) ? parsed.recruitedMonsterIds : [],
      log: Array.isArray(parsed.log) ? parsed.log.slice(0, 120) : []
    };
  } catch {
    state = clone(DEFAULT_STATE);
  }

  if (!getDungeon(state.currentDungeonId)) state.currentDungeonId = dungeons[0]?.id || "dungeon_01";
  if (!isJobUnlocked(state.currentJobId)) {
    const lockedName = getJob(state.currentJobId).name;
    state.currentJobId = "unemployed";
    state.selectedJobId = "unemployed";
    addLog(`${lockedName}は現在の条件では未解放のため、無職に戻しました。`, "normal");
  }
  clampHpMp(false);
}

function saveState(showMessage = true) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  if (showMessage) setSaveStatus("保存済み");
}

function resetState() {
  if (!confirm("セーブデータをリセットします。よろしいですか？")) return;
  state = clone(DEFAULT_STATE);
  clampHpMp(true);
  localStorage.removeItem(SAVE_KEY);
  render();
  setSaveStatus("リセット済み");
}

function setSaveStatus(text) {
  const el = $("#saveStatus");
  if (!el) return;
  el.textContent = text;
  window.clearTimeout(setSaveStatus.timer);
  setSaveStatus.timer = window.setTimeout(() => {
    el.textContent = "自動保存ON";
  }, 1400);
}

function normalizeOldLogEntries() {
  state.log = state.log.map((entry) => {
    if (typeof entry === "string") return { text: entry, kind: "normal", at: "" };
    return entry;
  });
}

function addLog(message, kind = "normal") {
  normalizeOldLogEntries();
  state.log.unshift({
    text: message,
    kind,
    at: new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  });
  state.log = state.log.slice(0, 120);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(rate) {
  return Math.random() < rate;
}

function getJob(jobId) {
  return jobs.find((job) => job.id === jobId) || jobs[0];
}

function getDungeon(dungeonId) {
  return dungeons.find((dungeon) => dungeon.id === dungeonId) || dungeons[0];
}

function getMonster(monsterId) {
  return monsters.find((monster) => monster.id === monsterId) || monsters[0];
}

function getMonsterNumber(monster) {
  const match = String(monster?.id || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function getProgress(jobId) {
  if (!state.jobProgress[jobId]) {
    state.jobProgress[jobId] = { rank: 1, battlesInRank: 0, totalBattles: 0, mastered: false };
  }
  return state.jobProgress[jobId];
}

function isMastered(jobId) {
  return Boolean(getProgress(jobId).mastered);
}

function getTypeLabel(type) {
  if (type === "basic") return "基本職";
  if (type === "advanced") return "上級職";
  return "標準";
}

function getItemName(itemId) {
  return RARE_ITEMS[itemId]?.name || itemId;
}

function isJobUnlocked(jobId) {
  const job = getJob(jobId);
  if (!job || job.type === "none" || job.type === "basic") return true;
  if (!job.unlock) return true;

  if (job.unlock.type === "masteries") {
    return job.unlock.required.every((requiredJobId) => isMastered(requiredJobId));
  }

  if (job.unlock.type === "item") {
    return state.unlockedJobIds.includes(job.id);
  }

  return true;
}

function getUnlockDetail(job) {
  if (isJobUnlocked(job.id)) return { unlocked: true, text: "転職可能", missing: [] };
  if (!job.unlock) return { unlocked: true, text: "転職可能", missing: [] };

  if (job.unlock.type === "masteries") {
    const required = job.unlock.required.map((requiredJobId) => {
      const requiredJob = getJob(requiredJobId);
      return { id: requiredJobId, name: requiredJob.name, mastered: isMastered(requiredJobId) };
    });
    const missing = required.filter((item) => !item.mastered);
    return {
      unlocked: false,
      text: `必要職業：${required.map((item) => `${item.name}${item.mastered ? "★" : ""}`).join(" ＋ ")}`,
      missing
    };
  }

  if (job.unlock.type === "item") {
    const itemName = getItemName(job.unlock.itemId);
    const count = state.items[job.unlock.itemId] || 0;
    return {
      unlocked: false,
      text: `${itemName}を使用すると解放されます。所持数：${count}`,
      missing: count > 0 ? [] : [{ name: itemName, mastered: false }]
    };
  }

  return { unlocked: false, text: "解放条件を満たしていません。", missing: [] };
}

function getNextInfo(job) {
  const progress = getProgress(job.id);
  if (!job.thresholds.length) return { label: "対象外", needed: 0, current: 0, rate: 0 };
  if (progress.rank >= 8 || progress.mastered) return { label: "マスター", needed: 0, current: 0, rate: 100 };
  const needed = job.thresholds[progress.rank - 1];
  const current = progress.battlesInRank;
  return { label: `${Math.max(needed - current, 0)}戦`, needed, current, rate: Math.min(100, Math.round((current / needed) * 100)) };
}

function getLevelEntry(level = getHeroLevel()) {
  return heroLevels.find((entry) => entry.level === level) || heroLevels[0];
}

function getHeroLevel() {
  let current = heroLevels[0]?.level || 1;
  for (const entry of heroLevels) {
    if (state.exp >= entry.exp) current = entry.level;
    else break;
  }
  return current;
}

function getNextLevelInfo() {
  const level = getHeroLevel();
  const next = heroLevels.find((entry) => entry.level === level + 1);
  if (!next) return { max: true, nextExp: null, remain: 0 };
  return { max: false, nextExp: next.exp, remain: Math.max(0, next.exp - state.exp) };
}

function getMasterBonuses() {
  const flat = Object.fromEntries(Object.keys(STAT_LABELS).map((key) => [key, 0]));
  const passives = [];
  const sourceJobs = [];

  for (const job of jobs) {
    if (job.type !== "advanced" || !job.masterBonus || !isMastered(job.id)) continue;
    sourceJobs.push(job);
    for (const [stat, value] of Object.entries(job.masterBonus.flat || {})) flat[stat] += value;
    for (const passive of job.masterBonus.passives || []) passives.push({ jobName: job.name, passive });
  }
  return { flat, passives, sourceJobs };
}

function computeStats(jobId = state.currentJobId) {
  const job = getJob(jobId);
  const base = getLevelEntry();
  const bonuses = getMasterBonuses().flat;
  const result = {};

  for (const stat of Object.keys(STAT_LABELS)) {
    const baseValue = Number(base[stat] || 0);
    const multiplier = Number(job.multipliers[stat] || 100);
    const afterJob = Math.floor(baseValue * multiplier / 100);
    result[stat] = { base: baseValue, multiplier, jobValue: afterJob, bonus: bonuses[stat] || 0, final: Math.max(0, afterJob + (bonuses[stat] || 0)) };
  }
  return result;
}

function getFinalStatValues(jobId = state.currentJobId) {
  const stats = computeStats(jobId);
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value.final]));
}

function clampHpMp(fullRecover = false) {
  const stats = getFinalStatValues();
  if (fullRecover) {
    state.currentHp = stats.mhp;
    state.currentMp = stats.mmp;
    return;
  }
  state.currentHp = Math.max(0, Math.min(Number(state.currentHp || 0), stats.mhp));
  state.currentMp = Math.max(0, Math.min(Number(state.currentMp || 0), stats.mmp));
  if (state.currentHp <= 0 && !state.battle) state.currentHp = 1;
}

function getMasterBonusText(job) {
  if (!job.masterBonus) return "";
  const flat = Object.entries(job.masterBonus.flat || {}).map(([stat, value]) => `${STAT_LABELS[stat]}+${value}`).join("、");
  const passives = (job.masterBonus.passives || []).join("、");
  const joined = [flat, passives].filter(Boolean).join("、");
  return joined ? ` 特典：${joined}` : "";
}

function announceNewlyUnlockedJobs() {
  const newlyUnlocked = jobs.filter((job) => {
    if (job.unlock?.type !== "masteries") return false;
    if (!isJobUnlocked(job.id)) return false;
    return !state.acknowledgedUnlocks.includes(job.id);
  });

  for (const job of newlyUnlocked) {
    state.acknowledgedUnlocks.push(job.id);
    addLog(`上級職「${job.name}」への転職が解放されました。`, "unlock");
  }
}

function addJobBattleProgress(count = 1) {
  const job = getJob(state.currentJobId);
  const progress = getProgress(job.id);
  let rankUps = 0;

  for (let i = 0; i < count; i++) {
    if (!job.thresholds.length || progress.mastered || progress.rank >= 8) continue;
    progress.totalBattles += 1;
    progress.battlesInRank += 1;
    const needed = job.thresholds[progress.rank - 1];
    if (progress.battlesInRank >= needed) {
      progress.battlesInRank = 0;
      progress.rank += 1;
      rankUps += 1;
      addLog(`${job.name}の熟練度が ${progress.rank} になりました。`, "rankup");
      if (progress.rank >= 8) {
        progress.rank = 8;
        progress.mastered = true;
        addLog(`${job.name}をマスターしました。${getMasterBonusText(job)}`, "master");
        announceNewlyUnlockedJobs();
      }
    }
  }
  return rankUps;
}

function changeJob(jobId) {
  const job = getJob(jobId);
  if (!isJobUnlocked(job.id)) {
    addLog(`${job.name}にはまだ転職できません。${getUnlockDetail(job).text}`, "locked");
    saveState(false);
    render();
    return;
  }
  state.currentJobId = job.id;
  state.selectedJobId = job.id;
  getProgress(job.id);
  clampHpMp(false);
  addLog(`${job.name}に転職しました。`, "change");
  saveState(false);
  render();
}

function useUnlockItem(itemId) {
  const item = RARE_ITEMS[itemId];
  if (!item) return;
  const targetJob = getJob(item.targetJobId);

  if (isJobUnlocked(targetJob.id)) {
    addLog(`${targetJob.name}はすでに解放済みです。`, "normal");
    render();
    return;
  }
  const count = state.items[itemId] || 0;
  if (count <= 0) {
    addLog(`${item.name}を持っていません。`, "locked");
    render();
    return;
  }
  state.items[itemId] = count - 1;
  state.unlockedJobIds.push(targetJob.id);
  state.acknowledgedUnlocks.push(targetJob.id);
  addLog(`${item.name}を使用しました。上級職「${targetJob.name}」への転職が解放されました。`, "unlock");
  saveState(false);
  render();
}

function grantItem(itemId) {
  const item = RARE_ITEMS[itemId];
  if (!item) return;
  state.items[itemId] = (state.items[itemId] || 0) + 1;
  addLog(`サンプル用に「${item.name}」を1個入手しました。`, "normal");
  saveState(false);
  render();
}

function restAtInn() {
  if (state.battle?.active) {
    addLog("戦闘中は宿屋を利用できません。", "locked");
    renderLog();
    return;
  }
  clampHpMp(true);
  addLog("宿屋で全回復しました。", "normal");
  saveState(false);
  render();
}

function getDungeonMonsters(dungeon) {
  return monsters.filter((monster) => {
    const no = getMonsterNumber(monster);
    return no >= dungeon.enemyStart && no <= dungeon.enemyEnd && Number(monster.stats?.maxHp || 0) > 0;
  });
}

function pickDungeonMonster(dungeon) {
  const candidates = getDungeonMonsters(dungeon);
  if (candidates.length === 0) return monsters[0];
  return candidates[randInt(0, candidates.length - 1)];
}

function startDungeonBattle(dungeonId = state.currentDungeonId) {
  const dungeon = getDungeon(dungeonId);
  if (!dungeon) return;
  if (state.battle?.active && !confirm("現在の戦闘を中断して新しい戦闘を開始しますか？")) return;
  const stats = getFinalStatValues();
  if (state.currentHp <= 0) state.currentHp = Math.max(1, Math.floor(stats.mhp * 0.25));
  state.currentDungeonId = dungeon.id;
  const enemy = pickDungeonMonster(dungeon);
  state.battle = {
    active: true,
    dungeonId: dungeon.id,
    enemyId: enemy.id,
    enemyHp: Math.max(1, Number(enemy.stats?.maxHp || 1)),
    turn: 1,
    guarding: false
  };
  addLog(`${dungeon.name}に潜りました。${enemy.name}があらわれた！`, "encounter");
  saveState(false);
  render();
}

function getCurrentEnemy() {
  if (!state.battle?.active) return null;
  return getMonster(state.battle.enemyId);
}

function calcPlayerPhysicalDamage(enemy) {
  const stats = getFinalStatValues();
  let base = stats.str * 0.9 - Number(enemy.stats?.defense || 0) * 0.35;
  base = Math.max(1, base);
  let damage = Math.floor(base * (randInt(85, 115) / 100));
  const critical = chance(1 / 16);
  if (critical) damage = Math.floor(damage * 1.65) + randInt(1, 4);
  return { damage: Math.max(1, damage), critical };
}

function applyEnemyDamage(damage) {
  if (!state.battle?.active) return false;
  state.battle.enemyHp = Math.max(0, state.battle.enemyHp - damage);
  return state.battle.enemyHp <= 0;
}

function playerAttack() {
  const enemy = getCurrentEnemy();
  if (!enemy) return;

  if (isMastered("paladin") && chance(0.06)) {
    state.battle.enemyHp = 0;
    addLog(`パラディンの特典が発動！${enemy.name}を一撃で倒した！`, "master");
    handleVictory(enemy);
    return;
  }

  const result = calcPlayerPhysicalDamage(enemy);
  const defeated = applyEnemyDamage(result.damage);
  addLog(`${state.playerName}の攻撃！${enemy.name}に${result.damage}ダメージ。${result.critical ? "会心の一撃！" : ""}`, result.critical ? "critical" : "battle");
  if (defeated) handleVictory(enemy);
  else enemyTurn();
}

function playerFire() {
  const enemy = getCurrentEnemy();
  if (!enemy) return;
  const stats = getFinalStatValues();
  const cost = isMastered("sage") ? 3 : 4;
  if (state.currentMp < cost) {
    addLog(`MPが足りません。火の術にはMP${cost}が必要です。`, "locked");
    renderLog();
    return;
  }
  state.currentMp -= cost;
  const damage = Math.max(6, Math.floor(stats.int * 1.25 + getHeroLevel() * 2 + randInt(0, 8)));
  const defeated = applyEnemyDamage(damage);
  addLog(`${state.playerName}は火の術を使った！${enemy.name}に${damage}ダメージ。`, "spell");
  if (defeated) handleVictory(enemy);
  else enemyTurn();
}

function playerHeal() {
  if (!state.battle?.active) return;
  const stats = getFinalStatValues();
  const cost = isMastered("sage") ? 2 : 3;
  if (state.currentMp < cost) {
    addLog(`MPが足りません。ホイミにはMP${cost}が必要です。`, "locked");
    renderLog();
    return;
  }
  state.currentMp -= cost;
  const recover = Math.floor(30 + stats.int * 0.45 + getHeroLevel() * 1.2 + randInt(0, 8));
  state.currentHp = Math.min(stats.mhp, state.currentHp + recover);
  addLog(`${state.playerName}はホイミを唱えた。HPが${recover}回復した。`, "heal");
  enemyTurn();
}

function playerGuard() {
  if (!state.battle?.active) return;
  state.battle.guarding = true;
  addLog(`${state.playerName}は身を守っている。`, "battle");
  enemyTurn();
}

function playerFlee() {
  const enemy = getCurrentEnemy();
  if (!enemy) return;
  const stats = getFinalStatValues();
  let rate = 0.35 + (stats.agi / Math.max(1, stats.agi + Number(enemy.stats?.speed || 1))) * 0.35;
  if (isMastered("ranger")) rate += 0.2;
  rate = Math.min(0.92, rate);
  if (chance(rate)) {
    addLog(`${state.playerName}は戦闘から逃げ出した。`, "normal");
    state.battle = null;
    saveState(false);
    render();
  } else {
    addLog(`${state.playerName}は逃げられなかった！`, "locked");
    enemyTurn();
  }
}

function enemyTurn() {
  const enemy = getCurrentEnemy();
  if (!enemy) return;
  const stats = getFinalStatValues();

  if (isMastered("superstar") && chance(0.12)) {
    addLog(`${enemy.name}は見とれていて動けない！`, "master");
    endTurnRecovery();
    state.battle.turn += 1;
    state.battle.guarding = false;
    saveState(false);
    render();
    return;
  }

  if (isMastered("battle_master") && chance(0.13)) {
    addLog(`${state.playerName}は${enemy.name}の攻撃を打ち払った！`, "master");
    endTurnRecovery();
    state.battle.turn += 1;
    state.battle.guarding = false;
    saveState(false);
    render();
    return;
  }

  const enemyHasMagic = Number(enemy.stats?.maxMp || 0) > 0 && chance(0.25);
  let damage;
  if (enemyHasMagic) {
    if (isMastered("metal_sprite")) {
      addLog(`${enemy.name}の呪文攻撃！しかし、はぐれメタルの特典で無効化した。`, "master");
      endTurnRecovery();
      state.battle.turn += 1;
      state.battle.guarding = false;
      saveState(false);
      render();
      return;
    }
    damage = Math.max(2, Math.floor(Number(enemy.stats?.attack || 1) * 0.42 + Number(enemy.stats?.maxMp || 0) * 0.12 - stats.int * 0.12 + randInt(-3, 6)));
    if (state.battle.guarding) damage = Math.max(1, Math.floor(damage / 2));
    state.currentHp = Math.max(0, state.currentHp - damage);
    addLog(`${enemy.name}の呪文攻撃！${state.playerName}は${damage}ダメージを受けた。`, "enemy");
  } else {
    damage = Math.max(1, Math.floor(Number(enemy.stats?.attack || 1) * 0.58 - stats.vit * 0.28 + randInt(-2, 5)));
    if (state.battle.guarding) damage = Math.max(1, Math.floor(damage / 2));
    state.currentHp = Math.max(0, state.currentHp - damage);
    addLog(`${enemy.name}の攻撃！${state.playerName}は${damage}ダメージを受けた。`, "enemy");
  }

  if (state.currentHp <= 0) {
    handleDefeat(enemy);
    return;
  }

  endTurnRecovery();
  state.battle.turn += 1;
  state.battle.guarding = false;
  saveState(false);
  render();
}

function endTurnRecovery() {
  if (!isMastered("hero")) return;
  const stats = getFinalStatValues();
  const recover = Math.max(1, Math.floor(stats.mhp * 0.03));
  state.currentHp = Math.min(stats.mhp, state.currentHp + recover);
  addLog(`勇者の特典でHPが${recover}回復した。`, "master");
}

function handleVictory(enemy) {
  const rewards = enemy.rewards || {};
  const oldLevel = getHeroLevel();
  const exp = Number(rewards.exp || 0);
  const gold = Number(rewards.gold || 0);
  state.exp += exp;
  state.gold += gold;
  state.totalBattles += 1;
  addJobBattleProgress(1);
  addLog(`${enemy.name}を倒した！経験値${exp}、${gold}ゴールドを獲得。`, "victory");

  const newLevel = getHeroLevel();
  if (newLevel > oldLevel) {
    clampHpMp(true);
    addLog(`レベルが${oldLevel}から${newLevel}に上がった！HPとMPが全回復した。`, "levelup");
  }

  tryRecruitMonster(enemy);
  state.battle = null;
  clampHpMp(false);
  saveState(false);
  render();
}

function handleDefeat(enemy) {
  const lost = Math.floor(state.gold * 0.2);
  state.gold = Math.max(0, state.gold - lost);
  state.battle = null;
  const stats = getFinalStatValues();
  state.currentHp = Math.max(1, Math.floor(stats.mhp * 0.25));
  state.currentMp = Math.max(0, Math.floor(stats.mmp * 0.25));
  addLog(`${state.playerName}は${enemy.name}に倒された。街に戻った。${lost}ゴールドを失った。`, "defeat");
  saveState(false);
  render();
}

function tryRecruitMonster(enemy) {
  if (!enemy.recruitable) return;
  if (state.recruitedMonsterIds.includes(enemy.id)) return;
  let rate = 0.10;
  if (state.currentJobId === "monster_tamer") rate += 0.15;
  if (isMastered("monster_tamer")) rate += 0.10;
  if (chance(rate)) {
    state.recruitedMonsterIds.push(enemy.id);
    addLog(`${enemy.name}が仲間になりたそうにこちらを見ている。${enemy.name}が仲間になった！`, "recruit");
  }
}

function renderVersionInfo() {
  const versionEl = $("#versionInfo");
  const dataVersionEl = $("#dataVersionInfo");
  if (versionEl) versionEl.textContent = APP_VERSION;
  if (dataVersionEl) dataVersionEl.textContent = DATA_VERSION;
}

function renderPlayerSummary() {
  const level = getHeroLevel();
  const next = getNextLevelInfo();
  const stats = getFinalStatValues();
  const hpRate = stats.mhp ? Math.round((state.currentHp / stats.mhp) * 100) : 0;
  const mpRate = stats.mmp ? Math.round((state.currentMp / stats.mmp) * 100) : 0;
  $("#playerName").value = state.playerName;
  $("#heroLevel").textContent = level;
  $("#heroExp").textContent = state.exp.toLocaleString("ja-JP");
  $("#heroNextExp").textContent = next.max ? "MAX" : next.remain.toLocaleString("ja-JP");
  $("#heroGold").textContent = state.gold.toLocaleString("ja-JP");
  $("#hpText").textContent = `${state.currentHp} / ${stats.mhp}`;
  $("#mpText").textContent = `${state.currentMp} / ${stats.mmp}`;
  $("#hpBar").style.width = `${Math.max(0, Math.min(100, hpRate))}%`;
  $("#mpBar").style.width = `${Math.max(0, Math.min(100, mpRate))}%`;
}

function renderCurrentJob() {
  const job = getJob(state.currentJobId);
  const progress = getProgress(job.id);
  const next = getNextInfo(job);
  $("#currentJobName").textContent = job.name;
  $("#currentJobType").textContent = getTypeLabel(job.type);
  $("#currentRank").textContent = job.thresholds.length ? `${progress.rank} / 8` : "-";
  $("#nextBattles").textContent = next.label;
  $("#totalBattles").textContent = state.totalBattles.toLocaleString("ja-JP");
  $("#progressText").textContent = job.thresholds.length
    ? progress.mastered ? "この職業はマスター済みです。" : `${progress.battlesInRank} / ${next.needed} 勝利`
    : "無職は熟練度がありません。";
  $("#jobProgressBar").style.width = `${next.rate}%`;
}

function renderStats() {
  const stats = computeStats();
  const wrap = $("#statsCards");
  wrap.innerHTML = "";
  for (const [stat, label] of Object.entries(STAT_LABELS)) {
    const data = stats[stat];
    const diff = data.final - data.base;
    const diffClass = diff > 0 ? "stat-plus" : diff < 0 ? "stat-minus" : "";
    const diffText = diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${diff}`;
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<span class="stat-label">${label}</span><strong class="stat-value">${data.final}</strong><span class="stat-detail ${diffClass}">Lv基礎${data.base} / 職業${data.multiplier}% / 特典+${data.bonus} / 差分${diffText}</span>`;
    wrap.appendChild(card);
  }
}

function renderMasterBonuses() {
  const wrap = $("#masterBonusList");
  const bonuses = getMasterBonuses();
  wrap.innerHTML = "";
  if (bonuses.sourceJobs.length === 0) {
    wrap.innerHTML = `<div class="bonus-item"><strong>まだありません</strong><span>上級職を熟練度8まで上げると、永続ボーナスと特殊効果がここに表示されます。</span></div>`;
    return;
  }
  for (const job of bonuses.sourceJobs) {
    const flatText = Object.entries(job.masterBonus.flat || {}).map(([stat, value]) => `${STAT_LABELS[stat]} +${value}`).join("、");
    const passiveText = (job.masterBonus.passives || []).join("、");
    const item = document.createElement("div");
    item.className = "bonus-item";
    item.innerHTML = `<strong>${job.name}</strong><span>${[flatText, passiveText].filter(Boolean).join(" / ")}</span>`;
    wrap.appendChild(item);
  }
}

function renderRareItems() {
  const wrap = $("#rareItemList");
  wrap.innerHTML = "";
  for (const [itemId, item] of Object.entries(RARE_ITEMS)) {
    const count = state.items[itemId] || 0;
    const targetJob = getJob(item.targetJobId);
    const unlocked = isJobUnlocked(targetJob.id);
    const row = document.createElement("div");
    row.className = "unlock-item";
    row.innerHTML = `<div><strong>${item.name}</strong><span>${item.description}</span><em>所持数：${count} / 対象職業：${targetJob.name} / 状態：${unlocked ? "解放済み" : "未解放"}</em></div><div class="unlock-actions"><button class="small use-item-button" ${unlocked || count <= 0 ? "disabled" : ""}>使用して解放</button><button class="ghost small grant-item-button">サンプル用に入手</button></div>`;
    row.querySelector(".use-item-button").addEventListener("click", () => useUnlockItem(itemId));
    row.querySelector(".grant-item-button").addEventListener("click", () => grantItem(itemId));
    wrap.appendChild(row);
  }
}

function renderDungeonPanel() {
  const select = $("#dungeonSelect");
  if (select.options.length !== dungeons.length) {
    select.innerHTML = "";
    for (const dungeon of dungeons) {
      const option = document.createElement("option");
      option.value = dungeon.id;
      option.textContent = `${dungeon.order}. ${dungeon.name}`;
      select.appendChild(option);
    }
  }
  select.value = state.currentDungeonId;
  const dungeon = getDungeon(state.currentDungeonId);
  $("#dungeonInfo").textContent = `推奨Lv ${dungeon.recommendedLevel}`;
  $("#dungeonDescription").textContent = `${dungeon.description} 出現範囲：No.${dungeon.enemyStart}〜${dungeon.enemyEnd}`;
}

function renderBattle() {
  const enemy = getCurrentEnemy();
  const box = $("#enemyBox");
  const buttons = ["#attackButton", "#fireButton", "#healButton", "#guardButton", "#fleeButton"].map($);
  if (!enemy) {
    $("#battleTitle").textContent = "戦闘なし";
    $("#battleTurn").textContent = "待機中";
    box.className = "enemy-box empty";
    box.innerHTML = `<strong>ダンジョンに潜ると敵が出現します。</strong><span>「ダンジョン探索」から行き先を選んでください。</span>`;
    buttons.forEach((button) => button.disabled = true);
    return;
  }
  buttons.forEach((button) => button.disabled = false);
  const enemyStats = enemy.stats || {};
  const maxHp = Math.max(1, Number(enemyStats.maxHp || 1));
  const hpRate = Math.max(0, Math.min(100, Math.round((state.battle.enemyHp / maxHp) * 100)));
  const dungeon = getDungeon(state.battle.dungeonId);
  $("#battleTitle").textContent = `${enemy.name} が出現中`;
  $("#battleTurn").textContent = `${dungeon.name} / ${state.battle.turn}ターン`;
  box.className = "enemy-box";
  box.innerHTML = `<div class="enemy-name-row"><strong>${enemy.name}</strong><span>No.${getMonsterNumber(enemy)}</span></div><div class="enemy-hp-label">HP ${state.battle.enemyHp} / ${maxHp}</div><div class="progress-bar enemy-hp-bar"><div style="width:${hpRate}%"></div></div><div class="enemy-stats-mini"><span>攻 ${enemyStats.attack || 0}</span><span>守 ${enemyStats.defense || 0}</span><span>早 ${enemyStats.speed || 0}</span><span>EXP ${enemy.rewards?.exp || 0}</span><span>G ${enemy.rewards?.gold || 0}</span></div>`;
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.filter === currentFilter));
}

function renderJobList() {
  const wrap = $("#jobList");
  const template = $("#jobCardTemplate");
  wrap.innerHTML = "";
  const filtered = jobs.filter((job) => {
    if (currentFilter === "all") return true;
    if (currentFilter === "unlocked") return isJobUnlocked(job.id);
    if (currentFilter === "locked") return !isJobUnlocked(job.id);
    if (currentFilter === "mastered") return isMastered(job.id);
    return job.type === currentFilter;
  });
  if (filtered.length === 0) {
    wrap.innerHTML = `<p class="hint">該当する職業はありません。</p>`;
    return;
  }
  for (const job of filtered) {
    const progress = getProgress(job.id);
    const next = getNextInfo(job);
    const unlock = getUnlockDetail(job);
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.jobId = job.id;
    node.classList.toggle("selected", state.selectedJobId === job.id);
    node.classList.toggle("current", state.currentJobId === job.id);
    node.classList.toggle("locked", !unlock.unlocked);
    node.querySelector(".job-card-name").textContent = job.name;
    node.querySelector(".job-card-type").textContent = unlock.unlocked ? getTypeLabel(job.type) : "未解放";
    node.querySelector(".job-card-rank").textContent = job.thresholds.length ? `熟練度 ${progress.rank}/8　次まで ${next.label}　累計 ${progress.totalBattles}勝` : "熟練度なし";
    node.querySelector(".job-card-desc").textContent = `${job.description} ${job.type === "advanced" ? `｜${unlock.text}` : ""}`;
    node.addEventListener("click", () => {
      state.selectedJobId = job.id;
      renderJobList();
      renderSelectedJobDetail();
    });
    wrap.appendChild(node);
  }
}

function renderSelectedJobDetail() {
  const job = getJob(state.selectedJobId);
  const progress = getProgress(job.id);
  const next = getNextInfo(job);
  const preview = computeStats(job.id);
  const unlock = getUnlockDetail(job);
  $("#selectedJobName").textContent = job.name;
  $("#selectedJobRank").textContent = job.thresholds.length ? `熟練度 ${progress.rank}/8` : "熟練度なし";
  $("#selectedJobDescription").textContent = `${job.description} ${job.thresholds.length ? `次の熟練度まで${next.label}です。` : ""}`;
  const requirement = $("#selectedJobRequirement");
  if (job.type === "advanced") {
    requirement.className = `requirement-box ${unlock.unlocked ? "ok" : "locked"}`;
    requirement.innerHTML = `<strong>${unlock.unlocked ? "解放済み" : "未解放"}</strong><span>${unlock.text}</span>`;
  } else {
    requirement.className = "requirement-box ok";
    requirement.innerHTML = `<strong>転職可能</strong><span>基本職と無職は最初から転職できます。</span>`;
  }
  const wrap = $("#selectedJobMultipliers");
  wrap.innerHTML = "";
  const currentStats = computeStats();
  for (const [stat, label] of Object.entries(STAT_LABELS)) {
    const data = preview[stat];
    const currentFinal = currentStats[stat].final;
    const diff = data.final - currentFinal;
    const diffClass = diff > 0 ? "stat-plus" : diff < 0 ? "stat-minus" : "";
    const diffText = diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${diff}`;
    const item = document.createElement("div");
    item.className = "multiplier-card";
    item.innerHTML = `<span class="multiplier-label">${label}</span><strong>${data.multiplier}% → ${data.final}</strong><span class="multiplier-value ${diffClass}">現在との差 ${diffText}</span>`;
    wrap.appendChild(item);
  }
  const button = $("#changeJobButton");
  const isCurrent = state.currentJobId === job.id;
  button.disabled = isCurrent || !unlock.unlocked || Boolean(state.battle?.active);
  if (state.battle?.active) button.textContent = "戦闘中は転職できません";
  else if (isCurrent) button.textContent = "現在の職業です";
  else if (!unlock.unlocked) button.textContent = "解放条件を満たしていません";
  else button.textContent = "この職業に転職する";
}

function renderProgressTable() {
  const tbody = $("#progressTableBody");
  tbody.innerHTML = "";
  for (const job of jobs) {
    const progress = getProgress(job.id);
    const next = getNextInfo(job);
    const unlock = getUnlockDetail(job);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${job.name}</td><td>${getTypeLabel(job.type)}</td><td>${job.type === "advanced" ? (unlock.unlocked ? "解放済み" : "未解放") : "最初から可"}</td><td>${job.thresholds.length ? `${progress.rank}/8${progress.mastered ? " ★" : ""}` : "-"}</td><td>${next.label}</td><td>${progress.totalBattles.toLocaleString("ja-JP")}</td><td>${job.type === "advanced" ? unlock.text : "-"}</td>`;
    tbody.appendChild(tr);
  }
}

function getMonsterFilteredList() {
  const keyword = monsterSearch.trim().toLowerCase();
  return monsters.filter((monster) => {
    if (monsterFilter === "recruitable" && !monster.recruitable) return false;
    if (monsterFilter === "recruited" && !state.recruitedMonsterIds.includes(monster.id)) return false;
    if (monsterFilter === "strong" && Number(monster.stats?.attack || 0) < 200) return false;
    if (!keyword) return true;
    return monster.name.toLowerCase().includes(keyword);
  });
}

function renderMonsterTabs() {
  document.querySelectorAll(".monster-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.monsterFilter === monsterFilter));
}

function renderMonsterList() {
  const list = getMonsterFilteredList();
  $("#monsterCount").textContent = `${list.length} / ${monsters.length}体`;
  const tbody = $("#monsterTableBody");
  tbody.innerHTML = "";
  for (const monster of list) {
    const stats = monster.stats || {};
    const rewards = monster.rewards || {};
    const unknownText = Array.isArray(monster.unknownFields) && monster.unknownFields.length ? `数字なし：${monster.unknownFields.map((field) => MONSTER_STAT_LABELS[field] || field).join("、")}` : "";
    const recruited = state.recruitedMonsterIds.includes(monster.id);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${getMonsterNumber(monster)}</td><td class="monster-name-cell"><strong>${monster.name}</strong>${unknownText ? `<span>${unknownText}</span>` : ""}</td><td class="${recruited ? "monster-recruited" : monster.recruitable ? "monster-recruitable" : "monster-normal"}">${recruited ? "仲間" : monster.recruitable ? "候補" : "-"}</td><td>${stats.attack ?? 0}</td><td>${stats.defense ?? 0}</td><td>${stats.speed ?? 0}</td><td>${stats.maxHp ?? 0}</td><td>${stats.maxMp ?? 0}</td><td>${rewards.exp ?? 0}</td><td>${rewards.gold ?? 0}</td>`;
    tbody.appendChild(tr);
  }
}

function renderLog() {
  normalizeOldLogEntries();
  const wrap = $("#battleLog");
  wrap.innerHTML = "";
  if (!state.log.length) {
    wrap.innerHTML = `<div class="log-entry">ログはありません。</div>`;
    return;
  }
  for (const entry of state.log) {
    const div = document.createElement("div");
    div.className = `log-entry ${entry.kind || "normal"}`;
    div.textContent = `${entry.at ? `[${entry.at}] ` : ""}${entry.text}`;
    wrap.appendChild(div);
  }
}

function render() {
  normalizeOldLogEntries();
  clampHpMp(false);
  renderVersionInfo();
  renderPlayerSummary();
  renderCurrentJob();
  renderStats();
  renderDungeonPanel();
  renderBattle();
  renderMasterBonuses();
  renderRareItems();
  renderTabs();
  renderJobList();
  renderSelectedJobDetail();
  renderProgressTable();
  renderMonsterTabs();
  renderMonsterList();
  renderLog();
}

function bindEvents() {
  $("#playerName").addEventListener("input", (event) => {
    state.playerName = event.target.value.trim() || "主人公";
    saveState(false);
    setSaveStatus("自動保存済み");
  });
  $("#saveButton").addEventListener("click", () => saveState(true));
  $("#forceUpdateButton").addEventListener("click", forceUpdate);
  $("#resetButton").addEventListener("click", resetState);
  $("#restButton").addEventListener("click", restAtInn);
  $("#dungeonSelect").addEventListener("change", (event) => {
    state.currentDungeonId = event.target.value;
    saveState(false);
    renderDungeonPanel();
  });
  $("#enterDungeonButton").addEventListener("click", () => startDungeonBattle(state.currentDungeonId));
  $("#sameDungeonButton").addEventListener("click", () => startDungeonBattle(state.currentDungeonId));
  $("#attackButton").addEventListener("click", playerAttack);
  $("#fireButton").addEventListener("click", playerFire);
  $("#healButton").addEventListener("click", playerHeal);
  $("#guardButton").addEventListener("click", playerGuard);
  $("#fleeButton").addEventListener("click", playerFlee);
  $("#changeJobButton").addEventListener("click", () => changeJob(state.selectedJobId));
  $("#clearLogButton").addEventListener("click", () => {
    state.log = [];
    saveState(false);
    renderLog();
  });
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    currentFilter = tab.dataset.filter;
    renderTabs();
    renderJobList();
  }));
  $("#monsterSearch").addEventListener("input", (event) => {
    monsterSearch = event.target.value;
    renderMonsterList();
  });
  document.querySelectorAll(".monster-tab").forEach((tab) => tab.addEventListener("click", () => {
    monsterFilter = tab.dataset.monsterFilter;
    renderMonsterTabs();
    renderMonsterList();
  }));
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#installButton").classList.remove("hidden");
  });
  $("#installButton").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("#installButton").classList.add("hidden");
  });
}

async function forceUpdate() {
  setSaveStatus("更新準備中");
  saveState(false);
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Cache clear failed", error);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("update", Date.now().toString());
  window.location.replace(url.toString());
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("service-worker.js");
  } catch (error) {
    console.warn("Service Worker registration failed", error);
  }
}

async function init() {
  try {
    await loadData();
    loadState();
    getProgress(state.currentJobId);
    getProgress(state.selectedJobId);
    bindEvents();
    render();
    setSaveStatus("自動保存ON");
    await registerServiceWorker();
  } catch (error) {
    document.body.innerHTML = `<main class="layout" style="display:block;max-width:900px;"><section class="panel"><p class="eyebrow">ERROR</p><h1>起動できませんでした</h1><p class="lead">${error.message}</p><p class="hint">ローカルで確認する場合は、フォルダ内で <code>python -m http.server 8000</code> を実行して http://localhost:8000 を開いてください。</p></section></main>`;
  }
}

init();
