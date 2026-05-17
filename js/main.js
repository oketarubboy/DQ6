const SAVE_KEY = "job-rpg-pwa-sample-v2";

const STAT_LABELS = {
  str: "力",
  agi: "素早さ",
  vit: "身守り",
  int: "賢さ",
  style: "かっこよさ",
  mhp: "MHP",
  mmp: "MMP"
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
  baseStats: {
    str: 80,
    agi: 60,
    vit: 70,
    int: 50,
    style: 40,
    mhp: 120,
    mmp: 40
  },
  currentJobId: "unemployed",
  selectedJobId: "unemployed",
  totalBattles: 0,
  jobProgress: {},
  items: {
    dragon_satori: 1,
    hagure_satori: 1
  },
  unlockedJobIds: [],
  acknowledgedUnlocks: [],
  log: ["職業システムのサンプルを開始しました。基本職をマスターすると、条件に合う上級職が解放されます。"]
};

let jobs = [];
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let currentFilter = "all";
let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadJobs() {
  const response = await fetch("data/jobs.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("data/jobs.json を読み込めませんでした。GitHub Pages またはローカルサーバー上で実行してください。");
  jobs = await response.json();
}

function loadState() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) {
    state = clone(DEFAULT_STATE);
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    state = {
      ...clone(DEFAULT_STATE),
      ...parsed,
      baseStats: { ...DEFAULT_STATE.baseStats, ...(parsed.baseStats || {}) },
      jobProgress: parsed.jobProgress || {},
      items: { ...DEFAULT_STATE.items, ...(parsed.items || {}) },
      unlockedJobIds: Array.isArray(parsed.unlockedJobIds) ? parsed.unlockedJobIds : [],
      acknowledgedUnlocks: Array.isArray(parsed.acknowledgedUnlocks) ? parsed.acknowledgedUnlocks : [],
      log: Array.isArray(parsed.log) ? parsed.log.slice(0, 100) : []
    };
  } catch {
    state = clone(DEFAULT_STATE);
  }

  if (!isJobUnlocked(state.currentJobId)) {
    const lockedName = getJob(state.currentJobId).name;
    state.currentJobId = "unemployed";
    state.selectedJobId = "unemployed";
    addLog(`${lockedName}は現在の条件では未解放のため、無職に戻しました。`, "normal");
  }
}

function saveState(showMessage = true) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  if (showMessage) setSaveStatus("保存済み");
}

function resetState() {
  if (!confirm("セーブデータをリセットします。よろしいですか？")) return;
  state = clone(DEFAULT_STATE);
  localStorage.removeItem(SAVE_KEY);
  render();
  setSaveStatus("リセット済み");
}

function setSaveStatus(text) {
  const el = $("#saveStatus");
  el.textContent = text;
  window.clearTimeout(setSaveStatus.timer);
  setSaveStatus.timer = window.setTimeout(() => {
    el.textContent = "自動保存ON";
  }, 1400);
}

function getJob(jobId) {
  return jobs.find((job) => job.id === jobId) || jobs[0];
}

function getProgress(jobId) {
  if (!state.jobProgress[jobId]) {
    state.jobProgress[jobId] = {
      rank: 1,
      battlesInRank: 0,
      totalBattles: 0,
      mastered: false
    };
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
  if (isJobUnlocked(job.id)) {
    return { unlocked: true, text: "転職可能", missing: [] };
  }

  if (!job.unlock) {
    return { unlocked: true, text: "転職可能", missing: [] };
  }

  if (job.unlock.type === "masteries") {
    const required = job.unlock.required.map((requiredJobId) => {
      const requiredJob = getJob(requiredJobId);
      const mastered = isMastered(requiredJobId);
      return {
        id: requiredJobId,
        name: requiredJob.name,
        mastered
      };
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
  if (!job.thresholds.length) {
    return { label: "対象外", needed: 0, current: 0, rate: 0 };
  }
  if (progress.rank >= 8 || progress.mastered) {
    return { label: "マスター", needed: 0, current: 0, rate: 100 };
  }
  const needed = job.thresholds[progress.rank - 1];
  const current = progress.battlesInRank;
  return {
    label: `${Math.max(needed - current, 0)}戦`,
    needed,
    current,
    rate: Math.min(100, Math.round((current / needed) * 100))
  };
}

function getMasterBonuses() {
  const flat = Object.fromEntries(Object.keys(STAT_LABELS).map((key) => [key, 0]));
  const passives = [];
  const sourceJobs = [];

  for (const job of jobs) {
    if (job.type !== "advanced" || !job.masterBonus || !isMastered(job.id)) continue;
    sourceJobs.push(job);
    for (const [stat, value] of Object.entries(job.masterBonus.flat || {})) {
      flat[stat] += value;
    }
    for (const passive of job.masterBonus.passives || []) {
      passives.push({ jobName: job.name, passive });
    }
  }

  return { flat, passives, sourceJobs };
}

function computeStats(jobId = state.currentJobId) {
  const job = getJob(jobId);
  const bonuses = getMasterBonuses().flat;
  const result = {};

  for (const stat of Object.keys(STAT_LABELS)) {
    const base = Number(state.baseStats[stat] || 0);
    const multiplier = Number(job.multipliers[stat] || 100);
    const afterJob = Math.floor(base * multiplier / 100);
    result[stat] = {
      base,
      multiplier,
      jobValue: afterJob,
      bonus: bonuses[stat] || 0,
      final: afterJob + (bonuses[stat] || 0)
    };
  }

  return result;
}

function addLog(message, kind = "normal") {
  state.log.unshift({ text: message, kind, at: new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });
  state.log = state.log.slice(0, 100);
}

function normalizeOldLogEntries() {
  state.log = state.log.map((entry) => {
    if (typeof entry === "string") return { text: entry, kind: "normal", at: "" };
    return entry;
  });
}

function getMasterBonusText(job) {
  if (!job.masterBonus) return "";
  const flat = Object.entries(job.masterBonus.flat || {})
    .map(([stat, value]) => `${STAT_LABELS[stat]}+${value}`)
    .join("、");
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

function addBattles(count) {
  const job = getJob(state.currentJobId);
  const progress = getProgress(job.id);
  let rankUps = 0;
  let masteredNow = false;

  for (let i = 0; i < count; i++) {
    state.totalBattles += 1;

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
        masteredNow = true;
        addLog(`${job.name}をマスターしました。${getMasterBonusText(job)}`, "master");
        announceNewlyUnlockedJobs();
      }
    }
  }

  if (!job.thresholds.length) {
    addLog(`${job.name}で${count}回戦闘しました。無職は熟練度が上がりません。`, "normal");
  } else if (progress.mastered && !masteredNow && rankUps === 0) {
    addLog(`${job.name}で${count}回戦闘しました。すでにマスター済みです。`, "normal");
  } else if (rankUps === 0) {
    const info = getNextInfo(job);
    addLog(`${job.name}で${count}回戦闘しました。次の熟練度まであと${info.label}です。`, "normal");
  }

  saveState(false);
  render();
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

function renderBaseStatsEditor() {
  const wrap = $("#baseStatsEditor");
  wrap.innerHTML = "";

  for (const [stat, label] of Object.entries(STAT_LABELS)) {
    const item = document.createElement("div");
    item.className = "base-stat-control";
    item.innerHTML = `
      <label for="base-${stat}">${label}</label>
      <input id="base-${stat}" class="stat-input" type="number" min="1" max="9999" step="1" value="${state.baseStats[stat]}">
    `;
    const input = item.querySelector("input");
    input.addEventListener("input", () => {
      state.baseStats[stat] = Math.max(1, Number(input.value || 1));
      saveState(false);
      renderStats();
      renderSelectedJobDetail();
      setSaveStatus("自動保存済み");
    });
    wrap.appendChild(item);
  }
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
    ? progress.mastered
      ? "この職業はマスター済みです。"
      : `${progress.battlesInRank} / ${next.needed} 戦`
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
    card.innerHTML = `
      <span class="stat-label">${label}</span>
      <strong class="stat-value">${data.final}</strong>
      <span class="stat-detail ${diffClass}">基礎${data.base} / 補正${data.multiplier}% / 特典+${data.bonus} / 差分${diffText}</span>
    `;
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
    const flatText = Object.entries(job.masterBonus.flat || {})
      .map(([stat, value]) => `${STAT_LABELS[stat]} +${value}`)
      .join("、");
    const passiveText = (job.masterBonus.passives || []).join("、");
    const item = document.createElement("div");
    item.className = "bonus-item";
    item.innerHTML = `
      <strong>${job.name}</strong>
      <span>${[flatText, passiveText].filter(Boolean).join(" / ")}</span>
    `;
    wrap.appendChild(item);
  }
}

function renderRareItems() {
  const wrap = $("#rareItemList");
  if (!wrap) return;
  wrap.innerHTML = "";

  for (const [itemId, item] of Object.entries(RARE_ITEMS)) {
    const count = state.items[itemId] || 0;
    const targetJob = getJob(item.targetJobId);
    const unlocked = isJobUnlocked(targetJob.id);
    const row = document.createElement("div");
    row.className = "unlock-item";
    row.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <span>${item.description}</span>
        <em>所持数：${count} / 対象職業：${targetJob.name} / 状態：${unlocked ? "解放済み" : "未解放"}</em>
      </div>
      <div class="unlock-actions">
        <button class="small use-item-button" ${unlocked || count <= 0 ? "disabled" : ""}>使用して解放</button>
        <button class="ghost small grant-item-button">サンプル用に入手</button>
      </div>
    `;
    row.querySelector(".use-item-button").addEventListener("click", () => useUnlockItem(itemId));
    row.querySelector(".grant-item-button").addEventListener("click", () => grantItem(itemId));
    wrap.appendChild(row);
  }
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
    node.querySelector(".job-card-rank").textContent = job.thresholds.length
      ? `熟練度 ${progress.rank}/8　次まで ${next.label}　累計 ${progress.totalBattles}戦`
      : "熟練度なし";
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
  if (requirement) {
    if (job.type === "advanced") {
      requirement.className = `requirement-box ${unlock.unlocked ? "ok" : "locked"}`;
      requirement.innerHTML = `
        <strong>${unlock.unlocked ? "解放済み" : "未解放"}</strong>
        <span>${unlock.text}</span>
      `;
    } else {
      requirement.className = "requirement-box ok";
      requirement.innerHTML = `<strong>転職可能</strong><span>基本職は最初から転職できます。</span>`;
    }
  }

  const wrap = $("#selectedJobMultipliers");
  wrap.innerHTML = "";
  for (const [stat, label] of Object.entries(STAT_LABELS)) {
    const data = preview[stat];
    const currentFinal = computeStats()[stat].final;
    const diff = data.final - currentFinal;
    const diffClass = diff > 0 ? "stat-plus" : diff < 0 ? "stat-minus" : "";
    const diffText = diff === 0 ? "±0" : `${diff > 0 ? "+" : ""}${diff}`;
    const item = document.createElement("div");
    item.className = "multiplier-card";
    item.innerHTML = `
      <span class="multiplier-label">${label}</span>
      <strong>${data.multiplier}% → ${data.final}</strong>
      <span class="multiplier-value ${diffClass}">現在との差 ${diffText}</span>
    `;
    wrap.appendChild(item);
  }

  const button = $("#changeJobButton");
  const isCurrent = state.currentJobId === job.id;
  button.disabled = isCurrent || !unlock.unlocked;
  if (isCurrent) {
    button.textContent = "現在の職業です";
  } else if (!unlock.unlocked) {
    button.textContent = "解放条件を満たしていません";
  } else {
    button.textContent = "この職業に転職する";
  }
}

function renderProgressTable() {
  const tbody = $("#progressTableBody");
  tbody.innerHTML = "";

  for (const job of jobs) {
    const progress = getProgress(job.id);
    const next = getNextInfo(job);
    const unlock = getUnlockDetail(job);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${job.name}</td>
      <td>${getTypeLabel(job.type)}</td>
      <td>${job.type === "advanced" ? (unlock.unlocked ? "解放済み" : "未解放") : "最初から可"}</td>
      <td>${job.thresholds.length ? `${progress.rank}/8${progress.mastered ? " ★" : ""}` : "-"}</td>
      <td>${next.label}</td>
      <td>${progress.totalBattles.toLocaleString("ja-JP")}</td>
      <td>${job.type === "advanced" ? unlock.text : "-"}</td>
    `;
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

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === currentFilter);
  });
}

function render() {
  normalizeOldLogEntries();
  $("#playerName").value = state.playerName;
  renderBaseStatsEditor();
  renderCurrentJob();
  renderStats();
  renderMasterBonuses();
  renderRareItems();
  renderTabs();
  renderJobList();
  renderSelectedJobDetail();
  renderProgressTable();
  renderLog();
}

function bindEvents() {
  $("#playerName").addEventListener("input", (event) => {
    state.playerName = event.target.value.trim() || "主人公";
    saveState(false);
    setSaveStatus("自動保存済み");
  });

  $("#saveButton").addEventListener("click", () => saveState(true));
  $("#resetButton").addEventListener("click", resetState);
  $("#battleOnceButton").addEventListener("click", () => addBattles(1));
  $("#battleTenButton").addEventListener("click", () => addBattles(10));
  $("#battleHundredButton").addEventListener("click", () => addBattles(100));
  $("#changeJobButton").addEventListener("click", () => changeJob(state.selectedJobId));
  $("#clearLogButton").addEventListener("click", () => {
    state.log = [];
    saveState(false);
    renderLog();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      currentFilter = tab.dataset.filter;
      renderTabs();
      renderJobList();
    });
  });

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
    await loadJobs();
    loadState();
    getProgress(state.currentJobId);
    getProgress(state.selectedJobId);
    bindEvents();
    render();
    setSaveStatus("自動保存ON");
    await registerServiceWorker();
  } catch (error) {
    document.body.innerHTML = `
      <main class="layout" style="display:block;max-width:900px;">
        <section class="panel">
          <p class="eyebrow">ERROR</p>
          <h1>起動できませんでした</h1>
          <p class="lead">${error.message}</p>
          <p class="hint">ローカルで確認する場合は、フォルダ内で <code>python -m http.server 8000</code> を実行して http://localhost:8000 を開いてください。</p>
        </section>
      </main>`;
  }
}

init();
