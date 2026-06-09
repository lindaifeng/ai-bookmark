const DB_NAME = "ai_bookmark_organizer_mvp";
const DB_VERSION = 6;

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  batchSize: 25,
  threshold: 0.75,
  classificationStrategy: "aggressive",
  rootFolderName: "AI Organized Bookmarks",
  responseFormatMode: "json_schema",
  scanChunkSize: 200,
  topCategoryCount: 8,
  dedupeMode: "url",
  enableUrlEnrichment: "true",
  enrichmentLimit: 60,
  enrichmentConcurrency: 2,
  enablePageCache: "true"
};

const $ = (id) => document.getElementById(id);
let stopRequested = false;
let scanStopRequested = false;
let running = false;
let scanning = false;
let activeJob = null;
let activeBookmarks = [];
let pendingPause = false;
const collapsedTreeNodes = new Set();
let treeDefaultCollapseInitialized = false;
const expandedTreeNodes = new Set();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUI();
  await migrateStorageIfNeeded();
  await loadSettingsToForm();
  await restoreActiveJob();
  setButtons();
  log("插件已启动，当前版本 v1.7.0。");
}

function bindUI() {
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("saveSettingsBtn").addEventListener("click", async () => {
    await saveSettingsFromForm();
    setConnectionStatus("配置已保存", "ok");
    updateFolderModeState();
    log("配置已保存。");
  });

  $("testConnectionBtn").addEventListener("click", testConnection);
  $("backupBookmarksBtn").addEventListener("click", backupAllBookmarks);
  $("scanToggleBtn").addEventListener("click", handleScanToggle);
  $("classifyToggleBtn").addEventListener("click", handleClassifyToggle);
  $("applyBtn").addEventListener("click", applyPlan);
  $("rollbackBtn").addEventListener("click", rollbackCurrentJob);
  $("reclassifyPendingBtn").addEventListener("click", reclassifyPendingItemsOnly);
  $("expandTreeBtn").addEventListener("click", renderBookmarkTreeFromCurrentState);
  $("treeSearch").addEventListener("input", renderBookmarkTreeFromCurrentState);
  $("bookmarkTreePreview").addEventListener("click", handleTreeClick);
  $("taxonomyBox").addEventListener("keydown", handleTaxonomyEditKeydown);
  $("taxonomyPreviewTree").addEventListener("keydown", handleTaxonomyEditKeydown);

  $("taxonomyBox").addEventListener("focusout", async (event) => {
    const el = event.target.closest("[data-taxonomy-index]");
    if (!el) return;
    await updateTaxonomyPathFromEditable(el);
  });
  $("taxonomyPreviewTree").addEventListener("focusout", async (event) => {
    const el = event.target.closest("[data-taxonomy-index]");
    if (!el) return;
    await updateTaxonomyPathFromEditable(el);
  });

  $("clearLogBtn").addEventListener("click", () => { $("logBox").textContent = ""; });
  $("copyLogBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("logBox").textContent || "");
      log("日志已复制到剪贴板。");
    } catch (err) {
      log(`复制日志失败：${err.message}`);
    }
  });
  $("toggleKeyBtn").addEventListener("click", () => {
    $("apiKey").type = $("apiKey").type === "password" ? "text" : "password";
  });

  // Mode selector event handlers
  document.querySelectorAll('[name="scan-mode"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const folderSelector = $('folder-selector');
      if (e.target.value === 'folder') {
        folderSelector.style.display = 'block';
        const folders = await loadFolderTree();
        populateFolderSelector(folders);
      } else {
        folderSelector.style.display = 'none';
      }
      maybeHintScopeChanged();
    });
  });

  $('target-folder-select').addEventListener('change', maybeHintScopeChanged);

  $("refresh-folders-btn").addEventListener("click", async () => {
    const folders = await loadFolderTree();
    populateFolderSelector(folders);
    log('📁 文件夹列表已刷新');
  });

  $("new-classification-btn").addEventListener("click", startNewClassification);
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
}

function stopCurrentWork() {
  if (scanning) {
    scanStopRequested = true;
    log("已请求停止扫描。当前扫描批次保存后会停止，不会自动智能整理分类。");
  }
  if (running) {
    stopRequested = true;
    log("已请求停止/暂停分类。当前 AI 批次完成后会暂停。");
  }
}


function handleScanToggle() {
  if (scanning) {
    scanStopRequested = true;
    log("已请求停止扫描。当前扫描批次保存后会停止。");
    return;
  }
  if (running) {
    log("分类任务进行中，暂时不能扫描。");
    return;
  }
  startOrContinueScan();
}

function handleClassifyToggle() {
  if (scanning) {
    log("扫描中不能智能整理分类，请先停止扫描或等待扫描完成。");
    return;
  }
  if (running) {
    stopRequested = true;
    pendingPause = true;
    activeJob = activeJob || {};
    activeJob.status = "paused";
    setButtons();
    setProgress(Number($("progressText").textContent.replace("%", "")) || 0, "分类已暂停，等待当前 AI 批次结束");
    log("已请求暂停分类。按钮已切换为恢复分类，当前 AI 批次完成后会完全暂停。");
    return;
  }
  if (activeJob && activeJob.status === "paused") {
    resumeClassification();
    return;
  }
  generateRecommendationsFromScanned();
}


/* ----------------------------- Chrome wrappers ----------------------------- */

function chromeCall(fn) {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const err = chrome.runtime.lastError;
      err ? reject(new Error(err.message)) : resolve(result);
    });
  });
}

const chromeBookmarks = {
  getTree: () => chromeCall((cb) => chrome.bookmarks.getTree(cb)),
  get: (id) => chromeCall((cb) => chrome.bookmarks.get(id, cb)),
  getChildren: (id) => chromeCall((cb) => chrome.bookmarks.getChildren(id, cb)),
  create: (obj) => chromeCall((cb) => chrome.bookmarks.create(obj, cb)),
  update: (id, changes) => chromeCall((cb) => chrome.bookmarks.update(id, changes, cb)),
  move: (id, dest) => chromeCall((cb) => chrome.bookmarks.move(id, dest, cb)),
  remove: (id) => chromeCall((cb) => chrome.bookmarks.remove(id, cb)),
  removeTree: (id) => chromeCall((cb) => chrome.bookmarks.removeTree(id, cb))
};

const chromeStorage = {
  get: (keys) => chromeCall((cb) => chrome.storage.local.get(keys, cb)),
  set: (obj) => chromeCall((cb) => chrome.storage.local.set(obj, cb))
};

/* ----------------------------- IndexedDB ----------------------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "jobId" });
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "jobId" });
      if (!db.objectStoreNames.contains("scanned")) {
        const s = db.createObjectStore("scanned", { keyPath: "key" });
        s.createIndex("jobId", "jobId", { unique: false });
      }
      if (!db.objectStoreNames.contains("suggestions")) {
        const s = db.createObjectStore("suggestions", { keyPath: "key" });
        s.createIndex("jobId", "jobId", { unique: false });
      }
      if (!db.objectStoreNames.contains("operations")) {
        const s = db.createObjectStore("operations", { keyPath: "opId" });
        s.createIndex("jobId", "jobId", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("page_cache")) db.createObjectStore("page_cache", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbPutMany(store, values) {
  if (!values.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    for (const v of values) s.put(v);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetAllByIndex(store, index, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).index(index).getAll(key);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ----------------------------- Settings and migration ----------------------------- */

async function migrateStorageIfNeeded() {
  const stored = await chromeStorage.get(["settings", "schemaVersion"]);
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  await chromeStorage.set({ settings, schemaVersion: DB_VERSION });
  await idbPut("meta", { key: "schemaVersion", value: DB_VERSION, updatedAt: Date.now() });
}
async function getSettings() {
  const res = await chromeStorage.get(["settings"]);
  return { ...DEFAULT_SETTINGS, ...(res.settings || {}) };
}
async function loadSettingsToForm() {
  const s = await getSettings();
  $("baseUrl").value = s.baseUrl || DEFAULT_SETTINGS.baseUrl;
  $("apiKey").value = s.apiKey;
  $("model").value = s.model || DEFAULT_SETTINGS.model;
  $("batchSize").value = s.batchSize || DEFAULT_SETTINGS.batchSize;
  $("threshold").value = s.threshold ?? DEFAULT_SETTINGS.threshold;
  $("classificationStrategy").value = s.classificationStrategy || DEFAULT_SETTINGS.classificationStrategy;
  if ($("rootFolderName")) $("rootFolderName").value = s.rootFolderName || DEFAULT_SETTINGS.rootFolderName;
  $("responseFormatMode").value = s.responseFormatMode || DEFAULT_SETTINGS.responseFormatMode;
  $("scanChunkSize").value = s.scanChunkSize || DEFAULT_SETTINGS.scanChunkSize;
  $("topCategoryCount").value = s.topCategoryCount || DEFAULT_SETTINGS.topCategoryCount;
  $("dedupeMode").value = s.dedupeMode || DEFAULT_SETTINGS.dedupeMode;
  $("enableUrlEnrichment").value = String(s.enableUrlEnrichment ?? DEFAULT_SETTINGS.enableUrlEnrichment);
  $("enrichmentLimit").value = s.enrichmentLimit || DEFAULT_SETTINGS.enrichmentLimit;
  $("enrichmentConcurrency").value = s.enrichmentConcurrency || DEFAULT_SETTINGS.enrichmentConcurrency;
  $("enablePageCache").value = String(s.enablePageCache ?? DEFAULT_SETTINGS.enablePageCache);
  updateFolderModeState();
}
async function saveSettingsFromForm() {
  const settings = {
    baseUrl: ($("baseUrl").value.trim() || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULT_SETTINGS.model,
    batchSize: clampInt($("batchSize").value, 5, 80, DEFAULT_SETTINGS.batchSize),
    threshold: clampFloat($("threshold").value, 0, 1, DEFAULT_SETTINGS.threshold),
    classificationStrategy: $("classificationStrategy")?.value || DEFAULT_SETTINGS.classificationStrategy,
    rootFolderName: ($("rootFolderName")?.value.trim()) || DEFAULT_SETTINGS.rootFolderName,
    responseFormatMode: $("responseFormatMode").value,
    scanChunkSize: clampInt($("scanChunkSize").value, 50, 1000, DEFAULT_SETTINGS.scanChunkSize),
    topCategoryCount: clampInt($("topCategoryCount").value, 3, 20, DEFAULT_SETTINGS.topCategoryCount),
    dedupeMode: $("dedupeMode").value,
    enableUrlEnrichment: $("enableUrlEnrichment").value,
    enrichmentLimit: clampInt($("enrichmentLimit").value, 5, 200, DEFAULT_SETTINGS.enrichmentLimit),
    enrichmentConcurrency: clampInt($("enrichmentConcurrency").value, 1, 6, DEFAULT_SETTINGS.enrichmentConcurrency),
    enablePageCache: $("enablePageCache").value
  };
  await chromeStorage.set({ settings });
  return settings;
}

/* ----------------------------- UI render ----------------------------- */


function setButtons() {
  const scanBtn = $("scanToggleBtn");
  const classifyBtn = $("classifyToggleBtn");

  if (scanBtn) {
    scanBtn.disabled = running;
    scanBtn.textContent = scanning ? "停止扫描" : (activeBookmarks.length ? "继续扫描" : "开始扫描");
  }

  if (classifyBtn) {
    classifyBtn.disabled = scanning || (!running && activeBookmarks.length === 0);
    if (running) {
      classifyBtn.textContent = "暂停分类";
      classifyBtn.classList.remove("primary");
    } else if (pendingPause || (activeJob && activeJob.status === "paused")) {
      classifyBtn.textContent = "恢复分类";
      classifyBtn.classList.add("primary");
    } else if (activeJob && activeJob.status === "reviewing") {
      classifyBtn.textContent = "重新智能整理";
      classifyBtn.classList.add("primary");
    } else {
      classifyBtn.textContent = "智能整理分类";
      classifyBtn.classList.add("primary");
    }
  }

  $("applyBtn").disabled = !activeJob || !["reviewing", "done"].includes(activeJob.status);
  $("rollbackBtn").disabled = !activeJob;
  if ($("reclassifyPendingBtn")) $("reclassifyPendingBtn").disabled = running || scanning || !activeJob || !["reviewing", "done", "paused", "failed"].includes(activeJob.status);

  // Show/hide new classification button
  const newClassBtn = $("new-classification-wrapper");
  if (newClassBtn) {
    newClassBtn.style.display = activeJob ? 'block' : 'none';
  }

  const label = getStatusLabel(activeJob?.status, activeBookmarks.length ? "扫描已停止" : "未开始");

  $("overviewStatus").textContent = label;
  $("topStatus").textContent = label === "未开始" ? "本地服务已就绪" : label;
  updateStatusHintText(activeJob?.status);
  updateTaxonomyConfirmUI();
}

function setProgress(percent, status) {
  const v = Math.max(0, Math.min(100, Math.round(percent || 0)));
  $("progressBar").style.width = `${v}%`;
  $("progressText").textContent = `${v}%`;
  if (status) {
    $("statusText").textContent = status;
    $("overviewStatus").textContent = status;
  }
  updateStatusHintText(activeJob?.status);
}
function log(message) {
  const ts = new Date().toLocaleTimeString();
  $("logBox").textContent += `[${ts}] ${message}\n`;
  $("logBox").scrollTop = $("logBox").scrollHeight;
}
function setConnectionStatus(text, type) {
  $("connectionStatus").textContent = text;
  $("connectionStatus").style.color = type === "error" ? "#b42318" : "#087567";
  $("connectionStatus").style.background = type === "error" ? "#fff1f3" : "var(--primary-soft)";
}

function getStatusLabel(status, fallback = "未开始") {
  return {
    scanning: "扫描中",
    scanned: "扫描完成",
    stopped_scan: "扫描已停止",
    generating_taxonomy: "生成分类中",
    classifying: "生成分类中",
    reviewing: "分类完成",
    applying: "整理中",
    done: "整理完成",
    failed: "失败",
    paused: "分类已暂停",
    rolled_back: "已回滚"
  }[status] || fallback;
}

function getStatusHint(status) {
  if (!activeJob && !activeBookmarks.length) return "请选择整理范围并开始扫描。";
  if (status === "scanning") return "正在读取书签并建立本地快照。";
  if (status === "scanned") return "扫描完成，可以开始智能整理分类。";
  if (status === "stopped_scan") return "扫描已停止，当前结果可继续分类或重新扫描。";
  if (status === "generating_taxonomy" || status === "classifying") return "正在生成分类体系和整理建议，请稍候。";
  if (status === "reviewing") return "分类结果已生成，检查无误后可以执行整理。";
  if (status === "applying") return "正在移动书签并创建目标分类文件夹。";
  if (status === "done") return "整理已执行完成，可以继续处理待确认或回滚。";
  if (status === "paused") return "分类已暂停，可以恢复分类或重新扫描。";
  if (status === "rolled_back") return "上一次整理已恢复，可重新开始分类。";
  if (status === "failed") return "任务失败，请查看日志后继续处理。";
  return activeBookmarks.length ? "当前已有扫描结果，可继续下一步。" : "请选择整理范围并开始扫描。";
}

function updateStatusHintText(status) {
  if (!$("statusHint")) return;
  $("statusHint").textContent = getStatusHint(status);
}

function renderStats(bookmarks) {
  const domains = countBy(bookmarks.map((b) => b.domain || "unknown"));
  const topDomains = [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("statScanned").textContent = bookmarks.length;
  $("statDomains").textContent = domains.size;
  $("domainChips").classList.toggle("empty", topDomains.length === 0);
  const more = Math.max(0, domains.size - topDomains.length);
  $("domainChips").innerHTML = topDomains.length
    ? topDomains.map(([d, n]) => `<span class="chip">${escapeHTML(d)} <strong>${n}</strong></span>`).join("") + (more ? `<span class="chip">更多 ${more}</span>` : "")
    : "暂无域名统计";

  // Update overview status with mode info
  updateOverviewStatusWithMode();
}

function updateOverviewStatusWithMode() {
  if (!activeJob) return;

  const statusLabel = getStatusLabel(activeJob.status);

  let modeInfo = '';
  if (activeJob.scanMode === 'folder' && activeJob.targetFolderTitle) {
    modeInfo = ` · ${activeJob.targetFolderTitle}`;
  } else if (activeJob.scanMode === 'full') {
    modeInfo = ' · 全量分类';
  }

  $("overviewStatus").textContent = statusLabel + modeInfo;
}



function renderTaxonomy(job) {
  // v1.7.0: 分类体系不再展示独立标签，只在下方预览框中展示和编辑。
  if (!job?.taxonomy?.categories?.length) {
    $("taxonomyBox").classList.add("hidden");
    $("taxonomyPreviewTree").textContent = "暂无分类预览。";
    $("taxonomyPreviewTree").classList.add("empty");
    return;
  }
  $("taxonomyBox").classList.add("hidden");
}

async function renderPlan(job) {
  if (!job) {
    $("planTableWrap").innerHTML = "暂无整理计划。智能整理分类后会显示预览。";
    const reviewStat = $("statReview")?.closest(".stat-pill");
    if (reviewStat) reviewStat.classList.remove("warning-active");
    renderBookmarkTreeFromSuggestions([]);
    return;
  }
  const settings = await getSettings();
  const threshold = Number(settings.threshold);
  const suggestions = await idbGetAllByIndex("suggestions", "jobId", job.jobId);
  const autoItems = buildExecutablePlanItems(suggestions, threshold);
  const reviewItems = buildReviewPlanItems(suggestions, threshold);

  $("statAuto").textContent = autoItems.length;
  $("statReview").textContent = reviewItems.length;
  const reviewStat = $("statReview").closest(".stat-pill");
  if (reviewStat) reviewStat.classList.toggle("warning-active", reviewItems.length > 0);

  if (!suggestions.length) {
    $("planTableWrap").innerHTML = `<div class="empty">暂无整理计划。智能整理分类后会显示预览。</div>`;
  } else {
    const rows = suggestions.slice(0, 12).map((s) => {
      const c = Number(s.confidence || 0);
      const confCls = c >= threshold ? "ok" : c >= 0.65 ? "mid" : "low";
      const warn = c < threshold ? "warn-row" : "";
      const displayPath = shouldAutoApply(s, threshold) ? normalizeExecutionCategoryPath(s.categoryPath, s) : (s.categoryPath || ["待确认"]);
      return `
        <tr class="${warn}">
          <td><input type="checkbox" /></td>
          <td title="${escapeHTML(s.oldTitle || "")}">${escapeHTML(ellipsis(s.oldTitle || "", 32))}</td>
          <td title="${escapeHTML(s.suggestedTitle || "")}">${escapeHTML(ellipsis(s.suggestedTitle || "", 34))}</td>
          <td><span class="cat-badge ${categoryClass(s.categoryPath)}">${escapeHTML(ellipsis(displayPath.join(" / "), 24))}</span></td>
          <td><span class="badge ${confCls}">${Math.round(c * 100)}%</span></td>
        </tr>`;
    }).join("");
    $("planTableWrap").innerHTML = `
      <table>
        <thead><tr><th style="width:36px;"></th><th>原标题</th><th>精简标题</th><th>目标分类</th><th>置信度</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="padding:10px;text-align:center;color:var(--primary-strong);font-weight:800;">共 ${suggestions.length} 项 · 可整理 ${autoItems.length} 项 · 待确认 ${reviewItems.length} 项</div>`;
  }

  renderBookmarkTreeFromSuggestions(suggestions);
  renderTaxonomyPreviewFromSuggestions(suggestions);
  renderTaxonomy(job);
  setButtons();
}
function updateTaxonomyConfirmUI() {
  // v1.7.0: no separate confirmation step; execute means accepted.
}
function updateFolderModeState() {
  // v1.1: 文件夹创建模式已移除，始终按推荐一级分类直接创建。
}
async function confirmTaxonomy() {
  if (!activeJob?.taxonomy?.categories?.length) return log("暂无可确认的分类体系，请先智能整理分类。");
  activeJob.taxonomyConfirmed = true;
  activeJob.updatedAt = Date.now();
  await idbPut("jobs", activeJob);
  log("分类体系已确认，现在可以执行当前整理方案。");
  setButtons();
}
async function resetTaxonomyConfirm() {
  if (!activeJob) return;
  activeJob.taxonomyConfirmed = false;
  activeJob.updatedAt = Date.now();
  await idbPut("jobs", activeJob);
  log("已取消分类体系确认。");
  setButtons();
}

/* ----------------------------- Incremental scan ----------------------------- */

async function startOrContinueScan() {
  if (scanning || running) return;
  scanning = true;
  scanStopRequested = false;
  stopRequested = false;
  setButtons();

  try {
    const settings = await saveSettingsFromForm();

    // Get scan mode and target folder
    const mode = document.querySelector('[name="scan-mode"]:checked').value;
    const targetFolderId = mode === 'folder'
      ? $('target-folder-select').value
      : null;

    if (mode === 'folder' && !targetFolderId) {
      scanning = false;
      setButtons();
      return log('请先选择要整理的书签夹');
    }

    setProgress(0, "读取书签树……");
    log(activeJob?.jobId ? "继续增量扫描书签……" : "开始增量扫描书签……");

    const { tree, flat } = await readAllBookmarks(targetFolderId);
    const scannedIdSet = new Set(activeBookmarks.map((b) => String(b.id)));
    const remaining = flat.filter((b) => !scannedIdSet.has(String(b.id)));

    // 切换了整理范围/书签夹：必须新建 job，避免沿用旧 targetFolderId 与旧书签集
    const scanTargetChanged = activeJob &&
      (activeJob.scanMode !== mode || (activeJob.targetFolderId || null) !== (targetFolderId || null));

    if (!activeJob || ["done", "rolled_back"].includes(activeJob.status) || scanTargetChanged) {
      const jobId = makeJobId();
      activeJob = {
        jobId,
        status: "scanning",
        scanMode: mode,
        targetFolderId: targetFolderId,
        targetFolderTitle: null,
        targetFolderPath: [],
        totalAvailableBookmarks: flat.length,
        scannedBookmarks: 0,
        processedBookmarks: 0,
        currentBatchIndex: 0,
        totalBatches: 0,
        taxonomy: null,
        taxonomyConfirmed: false,
        rootFolderTitle: settings.rootFolderName,
        settings: { ...settings },
        errors: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Store folder info for display
      if (targetFolderId) {
        const targetNode = findNodeById(tree, targetFolderId);
        if (targetNode) {
          activeJob.targetFolderTitle = targetNode.title;
          activeJob.targetFolderPath = await getNodePath(tree, targetFolderId);
        }
      }

      activeBookmarks = [];
      scannedIdSet.clear();
      await chromeStorage.set({ activeJobId: jobId });
      await idbPut("jobs", activeJob);

      // Show new classification button
      $('new-classification-wrapper').style.display = 'block';
    } else {
      activeJob.status = "scanning";
      activeJob.totalAvailableBookmarks = flat.length;
      activeJob.settings = { ...activeJob.settings, ...settings };
      activeJob.updatedAt = Date.now();
      await idbPut("jobs", activeJob);
    }

    const scanList = flat.filter((b) => !new Set(activeBookmarks.map((x) => String(x.id))).has(String(b.id)));
    if (!scanList.length) {
      activeJob.status = "scanned";
      await idbPut("jobs", activeJob);
      setProgress(100, `没有新的书签可扫描：已扫描 ${activeBookmarks.length} 条`);
      log("没有新的书签可扫描。你可以直接智能整理分类。");
      return;
    }

    const chunkSize = Number(settings.scanChunkSize || DEFAULT_SETTINGS.scanChunkSize);
    for (let i = 0; i < scanList.length; i += chunkSize) {
      if (scanStopRequested) {
        log("扫描已被用户停止。不会自动智能整理分类，你可以手动点击“智能整理分类”。");
        break;
      }

      const chunk = scanList.slice(i, i + chunkSize);
      activeBookmarks.push(...chunk);
      await idbPutMany("scanned", chunk.map((b) => ({ key: `${activeJob.jobId}:${b.id}`, jobId: activeJob.jobId, ...b })));

      activeJob.scannedBookmarks = activeBookmarks.length;
      activeJob.totalBookmarks = activeBookmarks.length;
      activeJob.updatedAt = Date.now();
      await idbPut("jobs", activeJob);
      await idbPut("snapshots", { jobId: activeJob.jobId, tree, flat: activeBookmarks, originalTotal: flat.length, createdAt: activeJob.createdAt, updatedAt: Date.now() });

      renderStats(activeBookmarks);
      const pct = flat.length ? (activeBookmarks.length / flat.length) * 100 : 0;
      setProgress(pct, `扫描中：${activeBookmarks.length} / ${flat.length}`);
      log(`已扫描 ${activeBookmarks.length} / ${flat.length} 条书签。`);

      await sleep(80);
    }

    activeJob.status = scanStopRequested ? "stopped_scan" : "scanned";
    activeJob.scannedBookmarks = activeBookmarks.length;
    activeJob.totalBookmarks = activeBookmarks.length;
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);
    await idbPut("snapshots", { jobId: activeJob.jobId, tree, flat: activeBookmarks, originalTotal: flat.length, createdAt: activeJob.createdAt, updatedAt: Date.now() });

    const finalPct = flat.length ? (activeBookmarks.length / flat.length) * 100 : 100;
    setProgress(finalPct, scanStopRequested ? `已停止扫描：${activeBookmarks.length} 条，可手动智能整理分类` : `扫描完成：${activeBookmarks.length} 条`);
    log(scanStopRequested ? `扫描停止。当前已扫描 ${activeBookmarks.length} 条，可点击“智能整理分类”，也可继续扫描。` : `扫描完成，共 ${activeBookmarks.length} 条书签。`);
  } catch (err) {
    log(`扫描失败：${err.message}`);
    if (activeJob) {
      activeJob.status = "failed";
      activeJob.errors = [...(activeJob.errors || []), err.message];
      await idbPut("jobs", activeJob);
    }
    setProgress(0, "扫描失败");
  } finally {
    scanning = FalseToFalse();
    scanStopRequested = false;
    setButtons();
  }
}
function FalseToFalse(){ return false; }

async function readAllBookmarks(targetFolderId = null) {
  const tree = await chromeBookmarks.getTree();
  const flat = [];

  if (targetFolderId) {
    // Folder mode: find target folder and scan only its contents
    const targetNode = await findNodeById(tree, targetFolderId);
    if (!targetNode) {
      throw new Error(`找不到书签夹 ID: ${targetFolderId}`);
    }
    const parentPath = await getNodePath(tree, targetNode.parentId);
    flattenBookmarkTree([targetNode], parentPath, flat);
  } else {
    // Full mode: scan everything
    flattenBookmarkTree(tree, [], flat);
  }

  return { tree, flat };
}
function flattenBookmarkTree(nodes, path, out) {
  for (const node of nodes) {
    const title = node.title || "ROOT";
    const nextPath = title === "ROOT" ? path : [...path, title];

    if (node.url) {
      const parsed = parseUrlSafe(node.url);
      out.push({
        id: String(node.id),
        title: node.title || "",
        url: node.url,
        parentId: String(node.parentId),
        index: node.index,
        currentFolderPath: path.filter(Boolean),
        domain: parsed.domain,
        urlPath: parsed.path
      });
    }
    if (node.children?.length) flattenBookmarkTree(node.children, nextPath, out);
  }
}
function parseUrlSafe(url) {
  try {
    const u = new URL(url);
    return { domain: u.hostname.replace(/^www\./, ""), path: u.pathname.slice(0, 180) };
  } catch { return { domain: "", path: "" }; }
}

// Helper functions for folder mode
async function loadFolderTree() {
  const tree = await chromeBookmarks.getTree();
  const folders = [];
  extractFolders(tree[0].children, [], folders);
  return folders;
}

function extractFolders(nodes, path, out) {
  for (const node of nodes) {
    if (!node.url && node.children) {
      const folderPath = [...path, node.title].filter(Boolean);
      out.push({
        id: node.id,
        title: node.title,
        path: folderPath,
        depth: folderPath.length,
        bookmarkCount: countBookmarksInFolder(node)
      });
      extractFolders(node.children, folderPath, out);
    }
  }
}

function countBookmarksInFolder(node) {
  if (node.url) return 1;
  let count = 0;
  for (const child of node.children || []) {
    count += countBookmarksInFolder(child);
  }
  return count;
}

function populateFolderSelector(folders) {
  const select = $('target-folder-select');
  select.innerHTML = '<option value="">-- 选择书签夹 --</option>';

  for (const folder of folders) {
    const indent = '　'.repeat(Math.max(0, folder.depth - 1));
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = `${indent}${folder.title} (${folder.bookmarkCount})`;
    select.appendChild(option);
  }
}

function findNodeById(nodes, targetId) {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (node.children) {
      const found = findNodeById(node.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

async function getNodePath(tree, nodeId) {
  const path = [];
  let currentId = nodeId;

  while (currentId && currentId !== '0') {
    const node = findNodeById(tree, currentId);
    if (!node) break;
    path.unshift(node.title);
    currentId = node.parentId;
  }

  return path.filter(Boolean);
}

// 备份/导出当前全部书签为标准 Netscape 书签 HTML（即浏览器“导出书签”的格式，可重新导入任意浏览器）。
async function backupAllBookmarks() {
  const btn = $("backupBookmarksBtn");
  try {
    if (btn) btn.disabled = true;
    log("正在读取书签树……");
    const tree = await chromeBookmarks.getTree();
    const roots = tree?.[0]?.children || [];

    let count = 0;
    const countLinks = (nodes) => (nodes || []).forEach((n) => (n.url ? count++ : countLinks(n.children)));
    countLinks(roots);

    if (!count) return log("当前没有任何书签可备份。");

    const html = buildNetscapeBookmarkHtml(roots);
    const ts = formatBackupTimestamp(new Date());
    downloadTextFile(`bookmarks-backup-${ts}.html`, html, "text/html;charset=utf-8");
    log(`✅ 已备份 ${count} 条书签：bookmarks-backup-${ts}.html（可在浏览器「书签管理器 → 导入书签」中恢复）。`);
  } catch (err) {
    log(`备份书签失败：${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function buildNetscapeBookmarkHtml(rootChildren) {
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>"
  ];
  for (const node of rootChildren || []) appendBookmarkNode(node, lines, 1);
  lines.push("</DL><p>");
  return lines.join("\n");
}

function appendBookmarkNode(node, lines, depth) {
  if (!node) return;
  const indent = "    ".repeat(depth);
  const addDate = node.dateAdded ? ` ADD_DATE="${Math.floor(node.dateAdded / 1000)}"` : "";

  if (node.url) {
    lines.push(`${indent}<DT><A HREF="${escapeHTML(node.url)}"${addDate}>${escapeHTML(node.title || node.url)}</A>`);
    return;
  }

  // 文件夹
  const modified = node.dateGroupModified ? ` LAST_MODIFIED="${Math.floor(node.dateGroupModified / 1000)}"` : "";
  const toolbar = String(node.id) === "1" ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ""; // Chrome 书签栏
  lines.push(`${indent}<DT><H3${addDate}${modified}${toolbar}>${escapeHTML(node.title || "")}</H3>`);
  lines.push(`${indent}<DL><p>`);
  for (const child of node.children || []) appendBookmarkNode(child, lines, depth + 1);
  lines.push(`${indent}</DL><p>`);
}

function formatBackupTimestamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// 通过 Blob + <a download> 触发下载（扩展页面无需 downloads 权限）
function downloadTextFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// 当用户切换整理范围/书签夹、但已有 job 的范围与之不符时，提示需要重新扫描，
// 避免旧结果界面滞留造成“换了书签夹还是旧结果”的困惑。
function maybeHintScopeChanged() {
  if (!activeJob) return;
  const selMode = document.querySelector('[name="scan-mode"]:checked')?.value || 'full';
  const selFolder = selMode === 'folder' ? ($('target-folder-select').value || null) : null;
  if (activeJob.scanMode !== selMode || (activeJob.targetFolderId || null) !== selFolder) {
    const hint = $('statusHint');
    if (hint) hint.textContent = '已切换整理范围，请点「开始或继续扫描」重新扫描该范围后再分类。';
  }
}

async function startNewClassification() {
  if (!activeJob) return;

  // Confirm with user if job is in progress
  if (activeJob.status !== 'done' && activeJob.status !== 'rolled_back') {
    const ok = confirm('当前分类尚未完成，确认开始新分类吗？未保存的结果将丢失。');
    if (!ok) return;
  }

  // Clear current job
  activeJob = null;
  activeBookmarks = [];
  pendingPause = false;
  stopRequested = false;
  scanStopRequested = false;
  await chromeStorage.set({ activeJobId: null });

  // Reset UI
  $('target-folder-select').value = '';
  document.querySelector('[name="scan-mode"][value="full"]').checked = true;
  $('folder-selector').style.display = 'none';

  // Clear displays
  await renderPlan(null);
  renderTaxonomy(null);
  renderTaxonomyPreviewFromSuggestions([]);
  renderBookmarkTreeFromSuggestions([]);
  $('overviewStatus').textContent = '未开始';
  $('statusText').textContent = '未开始';
  $('statusHint').textContent = '请选择整理范围并开始扫描。';
  $('progressText').textContent = '0%';
  $('progressBar').style.width = '0%';

  // Update stats
  $('statScanned').textContent = '0';
  $('statAuto').textContent = '0';
  $('statReview').textContent = '0';
  $('statDomains').textContent = '0';
  const reviewStat = $('statReview').closest('.stat-pill');
  if (reviewStat) reviewStat.classList.remove('warning-active');
  $('domainChips').innerHTML = '暂无域名统计';
  $('domainChips').classList.add('empty');

  // Hide new classification button
  $('new-classification-wrapper').style.display = 'none';

  setButtons();
  log('✅ 已清空，可以开始新的分类任务');
}


/* ----------------------------- Recommendation and classification ----------------------------- */

async function generateRecommendationsFromScanned() {
  if (running || scanning) return;
  const settings = await saveSettingsFromForm();
  if (!settings.apiKey) return log("请先在模型配置中填写 API Key。");
  if (!activeJob || !activeBookmarks.length) return log("请先扫描书签，停止或完成后都可以智能整理分类。");
  const ok = confirm(`将基于当前已扫描的 ${activeBookmarks.length} 条书签生成分类方案。\n如果后续继续扫描，可以重新智能整理。\n\n是否继续？`);
  if (!ok) return log("已取消智能整理分类。");

  running = true;
  stopRequested = false;
  pendingPause = false;
  activeJob.taxonomyConfirmed = false;
  setButtons();

  try {
    switchTab("overview");
    activeJob.status = "generating_taxonomy";
    const dedupeResult = dedupeBookmarksForClassification(activeBookmarks, settings.dedupeMode);
    const bookmarksForClassify = dedupeResult.items;
    if (dedupeResult.removed > 0) {
      log(`已去重 ${dedupeResult.removed} 条重复书签，将基于 ${bookmarksForClassify.length} 条唯一书签智能整理。`);
    }
    activeJob.totalBookmarks = bookmarksForClassify.length;
    activeJob.duplicateBookmarks = dedupeResult.duplicates;
    activeJob.processedBookmarks = 0;
    activeJob.currentBatchIndex = 0;
    activeJob.totalBatches = 0;
    activeJob.settings = { ...activeJob.settings, ...settings };
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);

    setProgress(2, `基于 ${activeBookmarks.length} 条已扫描书签智能整理分类中……`);
    await generateTaxonomyForJob(settings, activeJob, activeBookmarks);

    activeJob.status = "classifying";
    await idbPut("jobs", activeJob);
    await processBatches(settings, activeJob, activeBookmarks);
  } catch (err) {
    log(`智能整理分类失败：${err.message}`);
    activeJob.status = "failed";
    activeJob.errors = [...(activeJob.errors || []), err.message];
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);
  } finally {
    running = false;
    setButtons();
  }
}

async function resumeClassification() {
  pendingPause = false;
  if (running || scanning || !activeJob) return;
  running = true;
  stopRequested = false;
  setButtons();

  try {
    const settings = await getSettings();
    const snapshot = await idbGet("snapshots", activeJob.jobId);
    const flat = snapshot?.flat || activeBookmarks || [];
    if (!flat.length) throw new Error("无法恢复：没有找到本地已扫描书签快照。");

    activeBookmarks = flat;
    renderStats(flat);

    if (!activeJob.taxonomy) await generateTaxonomyForJob(settings, activeJob, flat);
    activeJob.status = "classifying";
    await idbPut("jobs", activeJob);
    await processBatches(settings, activeJob, flat);
  } catch (err) {
    log(`恢复失败：${err.message}`);
    activeJob.status = "failed";
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);
  } finally {
    running = false;
    setButtons();
  }
}
async function restoreActiveJob() {
  const res = await chromeStorage.get(["activeJobId"]);
  if (!res.activeJobId) return;
  const job = await idbGet("jobs", res.activeJobId);
  if (!job) return;

  activeJob = { taxonomyConfirmed: false, ...job };
  const snapshot = await idbGet("snapshots", job.jobId);
  activeBookmarks = snapshot?.flat || [];
  renderStats(activeBookmarks);
  renderTaxonomy(activeJob);
  await renderPlan(activeJob);

  const denom = activeJob.totalAvailableBookmarks || activeJob.totalBookmarks || 1;
  const pct = activeBookmarks.length ? (activeBookmarks.length / denom) * 100 : 0;
  setProgress(pct, `已恢复任务：${activeJob.status || "已扫描"}`);
  log(`恢复任务 ${activeJob.jobId}，状态：${activeJob.status}，已扫描 ${activeBookmarks.length} 条。`);
}
async function generateTaxonomyForJob(settings, job, bookmarks) {
  log("请求 AI 推荐一级/二级/三级分类体系……");
  const messages = [
    { role: "system", content: "You are an expert information architect for browser bookmarks. Return only valid JSON." },
    { role: "user", content:
`请根据用户已扫描的浏览器书签，推荐一个整理前可预览的分类体系。

要求：
1. 输出适合创建为浏览器书签夹的分类体系。
2. 推荐 ${settings.topCategoryCount || 8} 个左右的一级分类，并且尽量让每个一级分类下包含二级分类；必要时可添加三级分类。
3. 不要只返回“待确认”。除非输入几乎完全无法判断，否则必须给出多个有意义的一级分类。
4. 一级分类应该可以直接作为初始书签夹；数量尽量接近 ${settings.topCategoryCount || 8} 个。每个一级分类下建议至少有 1 个二级分类，例如：开发技术 / 代码与项目、AI 工具 / 模型平台、产品设计 / 设计灵感。
5. 子分类可以更具体，例如：开发技术 / Java、开发技术 / 前端、AI工具 / 图像生成、AI工具 / Prompt。
6. 必须包含一个 ["待确认"] 分类，用于低置信度书签。
7. 尽量使用中文分类名，但保留必要英文专有名词。
8. 只返回 JSON，不要 Markdown。

输入摘要：
${JSON.stringify(summarizeForTaxonomy(bookmarks), null, 2)}`
    }
  ];
  const raw = await chatJSON(settings, { messages, schemaName: "bookmark_taxonomy", schema: taxonomySchema(), maxTokens: 2600 });
  const categories = normalizeTaxonomy(raw, bookmarks);
  job.taxonomy = { categories };
  job.taxonomyConfirmed = false;
  job.status = "classifying";
  job.updatedAt = Date.now();
  await idbPut("jobs", job);
  renderTaxonomy(job);
  log(`分类体系推荐完成：${job.taxonomy.categories.length} 个分类。可直接在预览中编辑分类名称，检查无误后执行当前整理方案。`);
}
async function processBatches(settings, job, bookmarks) {
  const batchSize = Number(job.settings?.batchSize || settings.batchSize);
  const totalBatches = Math.ceil(bookmarks.length / batchSize);
  job.status = "classifying";
  job.totalBatches = totalBatches;
  await idbPut("jobs", job);

  for (let i = Number(job.currentBatchIndex || 0); i < totalBatches; i++) {
    if (stopRequested) {
      job.status = "paused";
      job.updatedAt = Date.now();
      await idbPut("jobs", job);
      log("分类任务已暂停，可稍后点击恢复分类。");
      return;
    }

    const batch = bookmarks.slice(i * batchSize, (i + 1) * batchSize);
    const batchId = `${job.jobId}_batch_${String(i + 1).padStart(4, "0")}`;
    setProgress((job.processedBookmarks / Math.max(1, job.totalBookmarks)) * 100, `分类批次 ${i + 1} / ${totalBatches}`);
    log(`开始分类批次 ${i + 1}/${totalBatches}，数量 ${batch.length}。`);

    const suggestions = await classifyBatchWithRetry(settings, job, batch, batchId, 2);
    await idbPutMany("suggestions", suggestions);

    job.currentBatchIndex = i + 1;
    job.processedBookmarks = Math.min(bookmarks.length, (i + 1) * batchSize);
    job.updatedAt = Date.now();
    await idbPut("jobs", job);
    await renderPlan(job);
  }

  await enrichLowConfidenceItems(settings, job, bookmarks);
  await ensureClassificationQuality(job);
  await reducePendingByFallback(job);

  job.status = "reviewing";
  job.updatedAt = Date.now();
  await idbPut("jobs", job);
  activeJob = job;
  setProgress(100, "整理分类已生成，请先确认分类体系");
  log("整理分类和整理计划已生成。确认分类体系后才能执行当前整理方案。");
  await renderPlan(job);
}

async function ensureClassificationQuality(job) {
  const suggestions = await idbGetAllByIndex("suggestions", "jobId", job.jobId);
  if (!suggestions.length) return;

  const reviewCount = suggestions.filter((s) => (s.categoryPath || []).join(">") === "待确认" || s.action === "needs_review").length;
  const reviewRatio = reviewCount / suggestions.length;
  const usefulCategories = new Set((job.taxonomy?.categories || []).map((c) => c.path.join(">")).filter((x) => x !== "待确认"));

  if (usefulCategories.size >= 4 && reviewRatio < 0.8) return;

  log("AI 分类质量较低，已启用本地兜底分类体系。");
  const fallback = buildFallbackTaxonomy(activeBookmarks.length ? activeBookmarks : suggestions.map((s) => ({
    title: s.oldTitle,
    domain: s.domain,
    urlPath: s.urlPath,
    currentFolderPath: s.currentFolderPath || []
  })));

  job.taxonomy = { categories: normalizeTaxonomy({ categories: fallback }, activeBookmarks) };
  const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
  const updated = suggestions.map((s) => {
    const fakeBookmark = {
      title: s.oldTitle,
      domain: s.domain,
      urlPath: s.urlPath,
      currentFolderPath: s.currentFolderPath || []
    };
    const path = fallbackCategoryForBookmark(fakeBookmark, taxonomyPaths);
    const isReview = path.join(">") === "待确认";
    return {
      ...s,
      categoryPath: ensureCategoryDepth(path, fakeBookmark),
      action: isReview ? "needs_review" : (s.action === "move_and_rename" ? "move_and_rename" : "move"),
      confidence: isReview ? Math.min(Number(s.confidence || 0), 0.49) : Math.max(Number(s.confidence || 0), 0.68),
      reason: `${s.reason || ""} fallback classification`.trim(),
      updatedAt: Date.now()
    };
  });
  await idbPutMany("suggestions", updated);
  await idbPut("jobs", job);
}


async function classifyBatchWithRetry(settings, job, batch, batchId, maxRetry) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    try {
      const raw = await classifyBatch(settings, job, batch, batchId);
      const out = normalizeBatchResult(raw, job, batch, batchId);
      log(`批次 ${batchId} 成功返回 ${out.length} 条建议。`);
      return out;
    } catch (err) {
      lastErr = err;
      log(`批次 ${batchId} 第 ${attempt} 次失败：${err.message}`);
      await sleep(700 * attempt);
    }
  }
  log(`批次 ${batchId} 多次失败，全部放入待确认。`);
  return batch.map((b) => suggestionFromBookmark(job, batchId, b, {
    suggestedTitle: b.title || b.domain || "未命名书签",
    categoryPath: ["待确认"],
    confidence: 0,
    action: "needs_review",
    reason: lastErr?.message || "AI batch failed"
  }));
}
async function classifyBatch(settings, job, batch, batchId) {
  const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
  const messages = [
    { role: "system", content: "You are a precise bookmark organizer. Return valid JSON only. Do not invent bookmark IDs." },
    { role: "user", content:
`请对这一批浏览器书签进行分类和标题规范化。

规则：
1. 必须为输入里的每个 bookmark 返回一个 item。
2. bookmarkId 必须完全等于输入 id。
3. categoryPath 必须优先选择二级或三级路径，不要只返回一级分类；除非 taxonomyPaths 只有一级。
4. 如果 taxonomyPaths 中没有完全合适的路径，可以选择最接近的一级/二级分类，不要随意放入待确认。
5. 只有完全无法判断时才使用 ["待确认"]，confidence 低于 0.5。${getStrategyPrompt(settings)}
6. suggestedTitle 必须短、清晰，建议 6-18 个中文字符，最多不超过 28 个字符；去掉冗余后缀、站点名、无意义前缀，只保留核心主题。
7. 普通可整理书签 action 用 "move"；需要重命名，用 "move_and_rename"。

batchId:
${batchId}

taxonomyPaths:
${JSON.stringify(taxonomyPaths, null, 2)}

bookmarks:
${JSON.stringify(batch.map(compactBookmarkForAI), null, 2)}`
    }
  ];
  return chatJSON(settings, { messages, schemaName: "bookmark_batch_result", schema: batchResultSchema(), maxTokens: 3800 });
}



function makePageCacheKey(url) {
  return normalizeUrlForDedupe(url || "");
}

async function getCachedPageInfo(url) {
  const key = makePageCacheKey(url);
  if (!key) return null;
  const cached = await idbGet("page_cache", key).catch(() => null);
  if (!cached) return null;
  const maxAgeMs = 1000 * 60 * 60 * 24 * 14;
  if (Date.now() - Number(cached.updatedAt || 0) > maxAgeMs) return null;
  return cached.value || null;
}

async function setCachedPageInfo(url, value) {
  const key = makePageCacheKey(url);
  if (!key) return;
  await idbPut("page_cache", { key, value, updatedAt: Date.now() }).catch(() => {});
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}



function getStrategyThreshold(settings) {
  const strategy = settings?.classificationStrategy || DEFAULT_SETTINGS.classificationStrategy || "aggressive";
  if (strategy === "conservative") return 0.75;
  if (strategy === "balanced") return 0.60;
  return 0.45;
}

function getStrategyPrompt(settings) {
  const strategy = settings?.classificationStrategy || DEFAULT_SETTINGS.classificationStrategy || "aggressive";
  if (strategy === "conservative") return "分类策略：保守。只有较确定时才归类；但能从 URL、页面信息、域名推断时，也应给出最接近分类。";
  if (strategy === "balanced") return "分类策略：平衡。只要有 60% 左右把握，就归入最接近的分类；避免大量使用待确认。";
  return "分类策略：积极。目标是最大化自动分类，尽量不要使用待确认；只要能从 URL、域名、页面信息或同域名规律推断，就必须归入最接近的分类。待确认比例应低于 5%。";
}

function forceFallbackForStillPending(suggestion, taxonomyPaths) {
  const bookmarkLike = {
    title: suggestion.oldTitle || suggestion.suggestedTitle || "",
    domain: suggestion.domain || "",
    urlPath: suggestion.urlPath || "",
    currentFolderPath: suggestion.currentFolderPath || []
  };
  const path = ensureCategoryDepth(fallbackCategoryForBookmark(bookmarkLike, taxonomyPaths), bookmarkLike);
  const isPending = path.join(">") === "待确认";
  return {
    ...suggestion,
    categoryPath: path,
    action: isPending ? "needs_review" : "move",
    confidence: isPending ? Math.min(Number(suggestion.confidence || 0), 0.49) : Math.max(Number(suggestion.confidence || 0), 0.62),
    reason: `${suggestion.reason || ""} 兜底分类`.trim(),
    fallbackClassified: !isPending,
    updatedAt: Date.now()
  };
}

async function reducePendingByFallback(job) {
  const settings = await getSettings();
  if ((settings.classificationStrategy || DEFAULT_SETTINGS.classificationStrategy) === "conservative") return;

  const threshold = Number(settings.threshold || DEFAULT_SETTINGS.threshold);
  const suggestions = await idbGetAllByIndex("suggestions", "jobId", job.jobId);
  const pending = suggestions.filter((s) => !shouldAutoApply(s, threshold));
  if (!pending.length) return;

  const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
  const updated = pending.map((s) => forceFallbackForStillPending(s, taxonomyPaths));
  await idbPutMany("suggestions", updated);

  const fixed = updated.filter((s) => shouldAutoApply(s, threshold)).length;
  log(`待确认兜底归类完成：${fixed} 条转为可整理，${updated.length - fixed} 条仍待确认。`);
}

/* ----------------------------- Low confidence enrichment ----------------------------- */


async function enrichLowConfidenceItems(settings, job, bookmarks) {
  if (String(settings.enableUrlEnrichment) !== "true") {
    log("低置信度增强分类已关闭。");
    return;
  }

  const threshold = Number(settings.threshold || DEFAULT_SETTINGS.threshold);
  const suggestions = await idbGetAllByIndex("suggestions", "jobId", job.jobId);
  const lowItems = suggestions
    .filter((s) => !shouldAutoApply(s, threshold))
    .slice(0, Number(settings.enrichmentLimit || DEFAULT_SETTINGS.enrichmentLimit));

  if (!lowItems.length) {
    log("没有需要增强分类的低置信度书签。");
    return;
  }

  const concurrency = Number(settings.enrichmentConcurrency || DEFAULT_SETTINGS.enrichmentConcurrency || 2);
  log(`开始低置信度增强分类：${lowItems.length} 条，并发 ${concurrency}。会尝试读取页面信息。`);

  const bookmarkById = new Map((bookmarks || []).map((b) => [String(b.id), b]));
  let cacheHits = 0;
  let fetchOk = 0;
  let fetchFailed = 0;

  const enriched = await mapLimit(lowItems, concurrency, async (s, index) => {
    const b = bookmarkById.get(String(s.bookmarkId)) || {
      id: s.bookmarkId,
      title: s.oldTitle,
      url: s.url,
      domain: s.domain,
      urlPath: s.urlPath,
      currentFolderPath: s.currentFolderPath || []
    };

    let pageInfo = null;
    if (String(settings.enablePageCache) === "true") {
      pageInfo = await getCachedPageInfo(b.url);
      if (pageInfo) cacheHits++;
    }

    if (!pageInfo) {
      pageInfo = await fetchBookmarkPageInfo(b);
      if (String(settings.enablePageCache) === "true" && pageInfo?.ok) {
        await setCachedPageInfo(b.url, pageInfo);
      }
    }

    if (pageInfo?.ok) fetchOk++;
    else fetchFailed++;

    if ((index + 1) % 10 === 0 || index === lowItems.length - 1) {
      setProgress(
        Math.min(95, Number($("progressText").textContent.replace("%", "")) || 0),
        `增强分类读取链接 ${index + 1} / ${lowItems.length}`
      );
    }

    return { suggestion: s, bookmark: b, pageInfo };
  });

  log(`页面信息读取完成：成功 ${fetchOk}，失败 ${fetchFailed}，缓存命中 ${cacheHits}。`);

  const batchSize = Math.min(12, Math.max(5, Number(settings.batchSize || 10)));
  const updatedAll = [];

  for (let i = 0; i < enriched.length; i += batchSize) {
    const batch = enriched.slice(i, i + batchSize);
    const raw = await reclassifyEnrichedBatch(settings, job, batch, `enrich_${Math.floor(i / batchSize) + 1}`);
    const updated = normalizeEnrichedResult(raw, job, batch, threshold);
    updatedAll.push(...updated);
    await idbPutMany("suggestions", updated);
    setProgress(
      Math.min(98, Number($("progressText").textContent.replace("%", "")) || 0),
      `增强分类模型处理 ${Math.min(i + batchSize, enriched.length)} / ${enriched.length}`
    );
    log(`增强分类批次 ${Math.floor(i / batchSize) + 1} 完成，更新 ${updated.length} 条。`);
  }

  const improved = updatedAll.filter((s) => shouldAutoApply(s, threshold)).length;
  const stillReview = updatedAll.length - improved;
  log(`低置信度增强分类完成：${improved} 条提升为可整理，${stillReview} 条仍待确认。`);
}

async function fetchBookmarkPageInfo(bookmark) {
  const url = bookmark.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "非 http(s) 链接，无法访问" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      credentials: "omit",
      redirect: "follow"
    });
    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") || "";
    if (!resp.ok) return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      return { ok: false, contentType, error: "非 HTML 页面" };
    }

    const text = await resp.text();
    return extractPageInfoFromHtml(text, url, contentType);
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.message || "访问失败" };
  }
}

function extractPageInfoFromHtml(html, url, contentType) {
  const cut = String(html || "").slice(0, 220000);
  const getMeta = (name) => {
    const patterns = [
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["'][^>]*>`, "i")
    ];
    for (const p of patterns) {
      const m = cut.match(p);
      if (m) return decodeHtmlEntities(m[1]).trim();
    }
    return "";
  };

  const titleMatch = cut.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])).trim() : "";

  const headings = [];
  const headingRegex = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let m;
  while ((m = headingRegex.exec(cut)) && headings.length < 12) {
    const h = decodeHtmlEntities(stripTags(m[1])).replace(/\s+/g, " ").trim();
    if (h) headings.push(h.slice(0, 120));
  }

  const description = getMeta("description") || getMeta("og:description") || getMeta("twitter:description");
  const keywords = getMeta("keywords");
  const ogTitle = getMeta("og:title") || getMeta("twitter:title");

  return {
    ok: true,
    url,
    contentType,
    title: (ogTitle || title).slice(0, 160),
    description: description.slice(0, 360),
    keywords: keywords.slice(0, 240),
    headings,
    excerpt: makeReadableExcerpt(cut).slice(0, 900)
  };
}

function stripTags(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(input) {
  const map = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(input || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    }
    return map[entity.toLowerCase()] || "";
  });
}

function makeReadableExcerpt(html) {
  return decodeHtmlEntities(stripTags(html))
    .replace(/\s+/g, " ")
    .replace(/(登录|注册|首页|导航|广告|版权所有)/g, "")
    .trim();
}

async function reclassifyEnrichedBatch(settings, job, batch, batchId) {
  const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
  const items = batch.map(({ suggestion, bookmark, pageInfo }) => ({
    bookmarkId: String(suggestion.bookmarkId),
    oldTitle: suggestion.oldTitle,
    previousCategoryPath: suggestion.categoryPath,
    previousConfidence: suggestion.confidence,
    domain: suggestion.domain || bookmark.domain,
    url: bookmark.url,
    urlPath: suggestion.urlPath || bookmark.urlPath,
    currentFolderPath: suggestion.currentFolderPath || bookmark.currentFolderPath || [],
    pageInfo
  }));

  const messages = [
    { role: "system", content: "You are a careful bookmark classifier. Return valid JSON only." },
    { role: "user", content:
`下面这些书签在第一轮分类中置信度较低。插件已经尝试访问网页并提取页面信息。请基于 title、URL、domain、页面 meta description、H1/H2、正文摘要重新分类。\n${getStrategyPrompt(settings)}

规则：
1. 必须为每个 bookmarkId 返回一个 item。
2. categoryPath 必须从 taxonomyPaths 中选择，优先选择二级或三级路径。
3. 如果页面信息访问失败，也必须结合 URL、域名、旧标题、原文件夹进行合理推断；不要因为访问失败就直接待确认。只有完全无法判断时才使用 ["待确认"]。
4. suggestedTitle 必须精简，建议 6-18 个中文字符，最多 28 个字符。
5. 如果重新判断后可以分类，confidence 应 >= ${getStrategyThreshold(settings)}，action 用 "move" 或 "move_and_rename"。
6. 如果仍不确定，categoryPath 用 ["待确认"]，confidence < 0.5，action 用 "needs_review"。

batchId:
${batchId}

taxonomyPaths:
${JSON.stringify(taxonomyPaths, null, 2)}

items:
${JSON.stringify(items, null, 2)}`
    }
  ];

  return chatJSON(settings, {
    messages,
    schemaName: "bookmark_enriched_reclassify",
    schema: batchResultSchema(),
    maxTokens: 3800
  });
}

function normalizeEnrichedResult(raw, job, batch, threshold) {
  const byId = new Map(batch.map((x) => [String(x.suggestion.bookmarkId), x]));
  const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
  const taxonomySet = new Set(taxonomyPaths.map((p) => p.join(">")));
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const out = [];

  for (const item of items) {
    const id = String(item.bookmarkId || "");
    const source = byId.get(id);
    if (!source) continue;

    const old = source.suggestion;
    const bookmark = source.bookmark;
    let categoryPath = ensureCategoryDepth(normalizeCategoryPath(item.categoryPath, taxonomySet, taxonomyPaths, bookmark), bookmark);
    let confidence = clampFloat(item.confidence, 0, 1, 0);
    let action = ["move", "move_and_rename", "keep", "needs_review"].includes(item.action) ? item.action : "needs_review";

    if (categoryPath.join(">") === "待确认") {
      action = "needs_review";
      confidence = Math.min(confidence, 0.49);
    } else if (confidence < threshold) {
      confidence = Math.max(confidence, Math.min(0.72, Math.max(0.45, threshold - 0.05)));
      action = action === "needs_review" ? "move" : action;
    }

    out.push({
      ...old,
      suggestedTitle: sanitizeSuggestedTitle(item.suggestedTitle || old.suggestedTitle, bookmark),
      categoryPath,
      confidence,
      action,
      reason: `增强分类：${String(item.reason || old.reason || "").slice(0, 180)}`,
      enriched: true,
      enrichedAt: Date.now()
    });
  }

  return out;
}


/* ----------------------------- AI ----------------------------- */

async function testConnection() {
  try {
    const settings = await saveSettingsFromForm();
    if (!settings.apiKey) throw new Error("请先填写 API Key。");
    setProgress(0, "测试连接中……");
    setConnectionStatus("测试中", "ok");
    log("开始测试模型连接……");

    const res = await chatJSON(settings, {
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: "请返回：{\"ok\":true,\"message\":\"pong\"}" }
      ],
      schemaName: "connection_test",
      schema: { type: "object", additionalProperties: false, required: ["ok", "message"], properties: { ok: { type: "boolean" }, message: { type: "string" } } },
      maxTokens: 120
    });

    log(`连接成功：${JSON.stringify(res)}`);
    setProgress(0, "连接成功");
    setConnectionStatus("连接正常", "ok");
  } catch (err) {
    log(`连接失败：${err.message}`);
    setProgress(0, "连接失败");
    setConnectionStatus("连接失败", "error");
  }
}
async function chatJSON(settings, { messages, schemaName, schema, maxTokens }) {
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: settings.model,
    messages: [...messages, { role: "system", content: "Output must be JSON only. No markdown. No code fences. No explanation." }],
    temperature: 0.1,
    max_tokens: maxTokens
  };
  if (settings.responseFormatMode === "json_schema") {
    body.response_format = { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } };
  } else if (settings.responseFormatMode === "json_object") {
    body.response_format = { type: "json_object" };
  }

  log(`调用 AI API：${settings.model} / ${settings.responseFormatMode}`);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`AI API HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.output_text ?? "";
  if (!content) throw new Error(`AI 响应为空：${JSON.stringify(data).slice(0, 500)}`);
  return parseJSONContent(content);
}
function parseJSONContent(content) {
  let text = String(content).trim();
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error(`无法解析 JSON：${text.slice(0, 300)}`);
}

/* ----------------------------- Apply / rollback ----------------------------- */





async function reclassifyPendingItemsOnly() {
  if (!activeJob) return log("没有可重新识别的任务。");
  if (running || scanning) return log("当前任务进行中，请稍后再试。");

  const settings = await saveSettingsFromForm();
  const snapshot = await idbGet("snapshots", activeJob.jobId);
  const bookmarks = snapshot?.flat || activeBookmarks || [];
  const suggestions = await idbGetAllByIndex("suggestions", "jobId", activeJob.jobId);
  const threshold = Number(settings.threshold || DEFAULT_SETTINGS.threshold);
  const pendingCount = suggestions.filter((s) => !shouldAutoApply(s, threshold)).length;

  if (!pendingCount) return log("当前没有待确认/低置信度书签需要重新识别。");

  const ok = confirm(`将重新识别 ${pendingCount} 条待确认/低置信度书签。\n插件会尝试访问链接、提取页面信息，并再次调用 AI 分类。\n\n是否继续？`);
  if (!ok) return;

  running = true;
  stopRequested = false;
  setButtons();

  try {
    activeJob.status = "classifying";
    await idbPut("jobs", activeJob);
    setProgress(5, `重新识别待确认：${pendingCount} 条`);

    await enrichLowConfidenceItems(settings, activeJob, bookmarks);
    await reducePendingByFallback(activeJob);

    activeJob.status = "reviewing";
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);

    await renderPlan(activeJob);
    const after = await idbGetAllByIndex("suggestions", "jobId", activeJob.jobId);
    const afterPending = after.filter((s) => !shouldAutoApply(s, threshold)).length;
    setProgress(100, `重新识别完成：待确认 ${pendingCount} → ${afterPending}`);
    log(`重新识别待确认完成：${pendingCount} → ${afterPending}。`);
  } catch (err) {
    log(`重新识别待确认失败：${err.message}`);
    activeJob.status = "failed";
    await idbPut("jobs", activeJob);
  } finally {
    running = false;
    setButtons();
  }
}


async function applyPlan() {
  if (!activeJob) return;

  const settings = await getSettings();
  const threshold = Number(settings.threshold);
  const suggestions = await idbGetAllByIndex("suggestions", "jobId", activeJob.jobId);
  const planItems = buildExecutablePlanItems(suggestions, threshold);
  const pendingItems = buildPendingReviewPlanItems(suggestions, threshold);
  const dedupeRemoved = Array.isArray(activeJob.duplicateBookmarks) ? activeJob.duplicateBookmarks.length : 0;
  const topCategoryCount = getTopCategoryCountFromPlan(planItems);
  const totalToMove = planItems.length + pendingItems.length;

  if (!totalToMove) return log("没有可移动的书签。");

  const targetSummary = isFolderModeActive()
    ? `- 创建位置：所选书签夹「${activeJob.targetFolderTitle}」内部\n`
    : `- 创建位置：其他书签\n`;
  const ok = confirm(
    `即将执行当前整理方案：\n\n` +
    `- 可整理书签：${planItems.length} 条，将按最终结构预览移动\n` +
    `- 待确认书签：${pendingItems.length} 条，将统一移动到「待确认书签」\n` +
    `- 将创建一级分类：${topCategoryCount} 个\n` +
    targetSummary +
    `- 重复书签已去重：${dedupeRemoved} 条（仅用于分类，不会删除原书签）\n\n` +
    `是否继续？`
  );
  if (!ok) return;

  running = true;
  setButtons();

  try {
    activeJob.status = "applying";
    activeJob.updatedAt = Date.now();
    activeJob.createdFolders = [];
    await idbPut("jobs", activeJob);

    // Determine target parent folder based on scan mode
    let parentId;
    if (isFolderModeActive()) {
      // Folder mode: organize within the selected folder
      parentId = activeJob.targetFolderId;
      log(`文件夹模式：在「${activeJob.targetFolderTitle}」内创建一级分类文件夹`);
    } else {
      // Full mode: organize under "Other Bookmarks"
      parentId = await getDefaultTopLevelParentId();
    }

    const folderCache = new Map([["", parentId]]);
    const createdFolders = [];

    activeJob.rootFolderId = parentId;
    activeJob.rootFolderTitle = activeJob.scanMode === 'folder'
      ? activeJob.targetFolderTitle
      : "推荐一级分类";
    await idbPut("jobs", activeJob);

    log("开始执行：可整理书签按最终结构移动，待确认书签统一移动到「待确认书签」。");

    let done = 0;
    let failed = 0;

    async function moveOne(item, options = {}) {
      const isPending = !!options.pendingReview;
      const finalPath = isPending
        ? makePendingReviewPath()
        : normalizeExecutionCategoryPath(item.finalCategoryPath || item.categoryPath, item);

      const targetFolderId = await ensureFolderPathTracked(parentId, finalPath, folderCache, createdFolders);
      activeJob.createdFolders = createdFolders;
      await idbPut("jobs", activeJob);

      const current = (await chromeBookmarks.get(item.bookmarkId))[0];

      const op = {
        opId: `${activeJob.jobId}:${item.bookmarkId}:${Date.now()}`,
        jobId: activeJob.jobId,
        bookmarkId: item.bookmarkId,
        oldParentId: current.parentId,
        oldIndex: current.index,
        oldTitle: current.title,
        newParentId: targetFolderId,
        newTitle: !isPending && item.action === "move_and_rename" ? item.finalTitle : current.title,
        finalCategoryPath: finalPath,
        pendingReview: isPending,
        status: "pending",
        createdAt: Date.now()
      };

      await idbPut("operations", op);

      if (!isPending && item.action === "move_and_rename" && item.finalTitle && item.finalTitle !== current.title) {
        await chromeBookmarks.update(item.bookmarkId, { title: item.finalTitle });
      }

      await chromeBookmarks.move(item.bookmarkId, { parentId: targetFolderId });

      op.status = "done";
      op.doneAt = Date.now();
      await idbPut("operations", op);
    }

    for (const item of planItems) {
      try {
        await moveOne(item, { pendingReview: false });
        done++;
        setProgress((done / totalToMove) * 100, `整理中 ${done} / ${totalToMove}`);
      } catch (err) {
        failed++;
        log(`执行失败 bookmarkId=${item.bookmarkId}: ${err.message}`);
      }
    }

    for (const item of pendingItems) {
      try {
        await moveOne(item, { pendingReview: true });
        done++;
        setProgress((done / totalToMove) * 100, `整理中 ${done} / ${totalToMove}`);
      } catch (err) {
        failed++;
        log(`待确认书签移动失败 bookmarkId=${item.bookmarkId}: ${err.message}`);
      }
    }

    activeJob.createdFolders = createdFolders;
    activeJob.status = "done";
    activeJob.appliedAt = Date.now();
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);

    setProgress(100, "整理完成");
    log(`整理完成：成功 ${done} / ${totalToMove}，失败 ${failed}。待确认书签已统一移动到「待确认书签」。`);
    await renderPlan(activeJob);
  } catch (err) {
    log(`执行失败：${err.message}`);
    activeJob.status = "failed";
    await idbPut("jobs", activeJob);
  } finally {
    running = false;
    setButtons();
  }
}

async function rollbackCurrentJob() {
  if (!activeJob) return log("没有可回滚任务。");
  const ops = await idbGetAllByIndex("operations", "jobId", activeJob.jobId);

  // 只回滚最近一次执行的操作（基于 appliedAt 时间戳）
  // 避免回滚历史残留的失效操作记录
  const appliedAt = activeJob.appliedAt || 0;
  const doneOps = ops.filter((op) => {
    if (op.status !== "done") return false;
    // 只选择本次执行中完成的操作（doneAt 接近 appliedAt）
    const doneAt = op.doneAt || op.createdAt || 0;
    return doneAt >= appliedAt - 5000; // 5 秒容差
  });

  if (!doneOps.length) {
    // 可能之前的回滚已经处理了所有操作，尝试清理文件夹
    if (activeJob.status === "done" || activeJob.status === "rolled_back") {
      await cleanupCreatedFolders(activeJob);
    }
    return log("没有已执行的操作可回滚。");
  }

  const ok = confirm(`确认回滚 ${doneOps.length} 个操作？\n\n回滚会移回原文件夹并恢复原标题；若原文件夹在整理后已被清理删除，将按原路径自动重建。`);
  if (!ok) return;

  running = true;
  setButtons();
  try {
    let count = 0;
    let failedCount = 0;
    const recreateCache = new Map();
    const deletedMap = new Map((activeJob.deletedSourceFolders || []).map((d) => [String(d.oldId), d.path]));
    for (const op of [...doneOps].reverse()) {
      try {
        await chromeBookmarks.update(op.bookmarkId, { title: op.oldTitle });

        // 目标源文件夹若已被清理删除，则按记录的原路径自动重建（兜底移到“其他书签”，绝不丢书签）
        let destParentId = op.oldParentId;
        if (!(await folderExists(destParentId))) {
          const path = deletedMap.get(String(op.oldParentId));
          destParentId = path
            ? await recreateFolderPathFromTitles(path, recreateCache)
            : await getDefaultTopLevelParentId();
        }

        await chromeBookmarks.move(op.bookmarkId, { parentId: destParentId, index: typeof op.oldIndex === "number" ? op.oldIndex : undefined });
        op.status = "rolled_back";
        op.rolledBackAt = Date.now();
        await idbPut("operations", op);
        count++;
        setProgress((count / doneOps.length) * 100, `回滚中 ${count} / ${doneOps.length}`);
      } catch (err) {
        failedCount++;
        log(`回滚失败 bookmarkId=${op.bookmarkId}: ${err.message}`);
      }
    }
    activeJob.status = "rolled_back";
    activeJob.updatedAt = Date.now();
    await idbPut("jobs", activeJob);
    setProgress(100, "回滚完成");
    log(`回滚完成：成功 ${count} / ${doneOps.length}，失败 ${failedCount}。`);
  } finally {
    running = false;
    setButtons();
  }
}
async function getDefaultTopLevelParentId() {
  const tree = await chromeBookmarks.getTree();
  const top = tree[0]?.children || [];
  const other = top.find((n) => n.id === "2") || top.find((n) => /Other bookmarks|其他书签/i.test(n.title)) || top[0];
  if (!other) throw new Error("无法找到可用的顶层书签目录。");
  return other.id;
}

/* ----------------- 整理后清理空源文件夹 / 回滚自动重建 ----------------- */

// 受保护、绝不删除的目录：根容器 / 书签栏 / 其他书签 / 移动设备书签
const PROTECTED_ROOT_IDS = new Set(["0", "1", "2", "3"]);

// 递归判断文件夹是否真的为空（含“只有空子文件夹”的情况），基于实时 chrome.bookmarks 数据
async function isFolderReallyEmpty(folderId) {
  try {
    const children = await chromeBookmarks.getChildren(folderId);
    if (children.length === 0) return true;
    for (const child of children) {
      if (child.url) return false; // 有书签
      if (!(await isFolderReallyEmpty(child.id))) return false; // 子文件夹非空
    }
    return true;
  } catch {
    return false; // 出错时保守认为非空
  }
}

async function folderExists(folderId) {
  try {
    const node = (await chromeBookmarks.get(String(folderId)))[0];
    return !!node && !node.url;
  } catch {
    return false;
  }
}

// 自该文件夹向上走到根，返回标题路径数组，如 ["书签栏","Google Gemini","常用"]（删除前调用以便回滚重建）
async function getFolderPathTitles(folderId) {
  const titles = [];
  let id = String(folderId);
  try {
    while (id && id !== "0") {
      const node = (await chromeBookmarks.get(id))[0];
      if (!node) break;
      titles.unshift(node.title); // 含书签栏/其他书签等根目录标题
      if (!node.parentId || String(node.parentId) === "0") break;
      id = String(node.parentId);
    }
  } catch { /* 尽力而为 */ }
  return titles;
}

// 按标题路径重建文件夹（titles[0] 为根目录标题），返回最终文件夹 id；cache 跨同次回滚复用
async function recreateFolderPathFromTitles(titles, cache) {
  if (!titles || !titles.length) return await getDefaultTopLevelParentId();
  const tree = await chromeBookmarks.getTree();
  const top = tree[0]?.children || [];
  const rootTitle = titles[0];
  const rootNode = top.find((n) => n.title === rootTitle)
    || top.find((n) => n.id === "2") || top[0];
  const rootId = rootNode?.id;
  if (!rootId) return await getDefaultTopLevelParentId();
  return await ensureFolderPath(rootId, titles.slice(1), cache);
}

// 执行整理后，删除本次移动书签留下的空源文件夹（自底向上），并记录被删路径供回滚重建。
async function cleanupEmptiedSourceFolders(job) {
  if (!job) return;
  try {
    const ops = await idbGetAllByIndex("operations", "jobId", job.jobId);
    const doneOps = ops.filter((op) => op.status === "done");
    if (!doneOps.length) return;

    // 受保护集合：根目录 + 目标父级 + 所有 AI 新建文件夹
    const protectedIds = new Set(PROTECTED_ROOT_IDS);
    if (job.rootFolderId) protectedIds.add(String(job.rootFolderId));
    for (const f of (job.createdFolders || [])) protectedIds.add(String(f.id));

    // 候选源文件夹（去重）+ 其向上祖先；只读判定哪些将被删除，并先记录路径
    const seen = new Set();
    const queue = [...new Set(doneOps.map((op) => String(op.oldParentId)).filter(Boolean))];
    const toDelete = []; // { id, path, depth }

    while (queue.length) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (protectedIds.has(id)) continue;

      let node;
      try { node = (await chromeBookmarks.get(id))[0]; } catch { continue; }
      if (!node || node.url) continue; // 已不存在或不是文件夹

      if (await isFolderReallyEmpty(id)) {
        const path = await getFolderPathTitles(id);
        toDelete.push({ id, path, depth: path.length });
        // 父级可能随之变空，加入候选
        if (node.parentId && !protectedIds.has(String(node.parentId))) {
          queue.push(String(node.parentId));
        }
      }
    }

    if (!toDelete.length) {
      log("[清理] 没有需要清理的空源文件夹。");
      return;
    }

    const names = toDelete.map((d) => d.path[d.path.length - 1] || "(未命名)");
    const preview = names.slice(0, 8).join("、") + (names.length > 8 ? ` 等 ${names.length} 个` : "");
    const ok = confirm(
      `检测到整理后变空的 ${toDelete.length} 个原文件夹：\n\n${preview}\n\n` +
      `是否删除这些空文件夹？\n（删除后仍可通过「回滚」自动恢复原结构）`
    );
    if (!ok) { log("[清理] 用户取消清理空源文件夹。"); return; }

    // 记录所有将被删除的源文件夹路径（供回滚重建）——无论稍后是被直接删，还是随祖先一并删除
    toDelete.sort((a, b) => b.depth - a.depth);
    job.deletedSourceFolders = [
      ...(job.deletedSourceFolders || []),
      ...toDelete.map((d) => ({ oldId: d.id, path: d.path }))
    ];

    // 自底向上删除（深度大者先删）。已确认整棵子树无书签，用 removeTree 可一并清掉内部空子文件夹。
    let cleaned = 0;
    for (const d of toDelete) {
      try {
        if (!(await folderExists(d.id))) continue;        // 可能已随祖先被删除
        if (!(await isFolderReallyEmpty(d.id))) continue;  // 二次确认整棵子树无书签
        await chromeBookmarks.removeTree(d.id);
        cleaned++;
      } catch (err) {
        log(`[清理] 删除文件夹失败：${err.message}`);
      }
    }

    job.updatedAt = Date.now();
    await idbPut("jobs", job);
    log(`[清理] ✅ 已清理 ${cleaned} 个空源文件夹（回滚时将自动重建）。`);
  } catch (err) {
    log(`[清理] 清理空源文件夹失败：${err.message}`);
    console.error("[cleanupEmptiedSourceFolders]", err);
  }
}

async function ensureFolderPath(rootId, path, cache) {
  let parentId = rootId;
  let key = "";
  for (const rawTitle of path) {
    const title = String(rawTitle || "").trim();
    if (!title) continue;
    key = key ? `${key}>${title}` : title;
    if (cache.has(key)) {
      parentId = cache.get(key);
      continue;
    }
    const children = await chromeBookmarks.getChildren(parentId);
    let folder = children.find((n) => !n.url && n.title === title);
    if (!folder) folder = await chromeBookmarks.create({ parentId, title });
    cache.set(key, folder.id);
    parentId = folder.id;
  }
  return parentId;
}

/* ----------------------------- Schemas / normalize ----------------------------- */

function taxonomySchema() {
  return { type: "object", additionalProperties: false, required: ["categories"], properties: { categories: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "description"], properties: { path: { type: "array", items: { type: "string" } }, description: { type: "string" } } } } } };
}
function batchResultSchema() {
  return { type: "object", additionalProperties: false, required: ["batchId", "items"], properties: { batchId: { type: "string" }, items: { type: "array", items: { type: "object", additionalProperties: false, required: ["bookmarkId", "suggestedTitle", "categoryPath", "confidence", "action", "reason"], properties: { bookmarkId: { type: "string" }, suggestedTitle: { type: "string" }, categoryPath: { type: "array", items: { type: "string" } }, confidence: { type: "number" }, action: { type: "string", enum: ["move", "move_and_rename", "keep", "needs_review"] }, reason: { type: "string" } } } } } };
}

function normalizeTaxonomy(raw, bookmarks) {
  const settingsTopCount = Number($("topCategoryCount")?.value || DEFAULT_SETTINGS.topCategoryCount || 8);
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];
  const seen = new Set();
  const out = [];

  for (const c of categories) {
    let path = Array.isArray(c.path) ? c.path.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
    if (!path.length) continue;
    if (path[0] !== "待确认" && path.length === 1) {
      path = [path[0], "综合资料"];
    }
    const key = path.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, description: String(c.description || "").slice(0, 180) });
  }

  if (out.filter((c) => c.path[0] !== "待确认").length < Math.min(4, settingsTopCount)) {
    for (const fallback of buildFallbackTaxonomy(bookmarks)) {
      const key = fallback.path.join(">");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(fallback);
      }
    }
  }

  return normalizeTopLevelCategoryCount(out, settingsTopCount);
}


function buildFallbackTaxonomy(bookmarks) {
  const out = [
    { path: ["开发技术", "代码与项目"], description: "代码托管、开源项目、技术项目" },
    { path: ["开发技术", "文档教程"], description: "编程文档、开发教程、技术文章" },
    { path: ["AI 工具", "模型平台"], description: "AI 模型、模型站点、AI 平台" },
    { path: ["AI 工具", "Prompt"], description: "提示词、Agent、AI 工作流" },
    { path: ["产品设计", "设计灵感"], description: "UI、UX、图标、视觉参考" },
    { path: ["商业增长", "创业营销"], description: "增长、营销、创业、SaaS" },
    { path: ["学习资料", "课程教程"], description: "课程、教程、学习资料" },
    { path: ["文档资料", "在线文档"], description: "飞书、语雀、Notion、资料库" },
    { path: ["生活服务", "常用服务"], description: "生活、支付、工具、服务网站" },
    { path: ["待确认"], description: "AI 无法准确判断或需要人工确认的书签" }
  ];
  return out;
}

function normalizeBatchResult(raw, job, batch, batchId) {
  const batchById = new Map(batch.map((b) => [String(b.id), b]));
  const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
  const taxonomySet = new Set(taxonomyPaths.map((p) => p.join(">")));
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const out = [];
  const used = new Set();

  for (const item of rawItems) {
    const id = String(item.bookmarkId || "");
    if (!batchById.has(id) || used.has(id)) continue;
    const bookmark = batchById.get(id);
    const categoryPath = ensureCategoryDepth(normalizeCategoryPath(item.categoryPath, taxonomySet, taxonomyPaths, bookmark), bookmark);
    let confidence = clampFloat(item.confidence, 0, 1, 0);
    let action = ["move", "move_and_rename", "keep", "needs_review"].includes(item.action) ? item.action : "needs_review";
    if (categoryPath.join(">") === "待确认") {
      action = "needs_review";
      confidence = Math.min(confidence, 0.49);
    }
    out.push(suggestionFromBookmark(job, batchId, bookmark, {
      suggestedTitle: sanitizeSuggestedTitle(item.suggestedTitle, bookmark),
      categoryPath,
      confidence,
      action,
      reason: String(item.reason || "").slice(0, 220)
    }));
    used.add(id);
  }

  for (const bookmark of batch) {
    if (!used.has(String(bookmark.id))) {
      const path = fallbackCategoryForBookmark(bookmark, taxonomyPaths);
      out.push(suggestionFromBookmark(job, batchId, bookmark, {
        suggestedTitle: makeConciseBookmarkTitle(bookmark.title, bookmark.domain),
        categoryPath: ensureCategoryDepth(path, bookmark),
        confidence: path.join(">") === "待确认" ? 0 : 0.68,
        action: path.join(">") === "待确认" ? "needs_review" : "move",
        reason: "AI missing this bookmark in response; fallback categorized locally"
      }));
    }
  }
  return out;
}
function suggestionFromBookmark(job, batchId, bookmark, suggestion) {
  return { key: `${job.jobId}:${bookmark.id}`, jobId: job.jobId, batchId, bookmarkId: String(bookmark.id), oldTitle: bookmark.title || "", suggestedTitle: suggestion.suggestedTitle, categoryPath: suggestion.categoryPath, confidence: suggestion.confidence, action: suggestion.action, reason: suggestion.reason || "", oldParentId: bookmark.parentId, oldIndex: bookmark.index, currentFolderPath: bookmark.currentFolderPath, domain: bookmark.domain, urlPath: bookmark.urlPath, createdAt: Date.now() };
}
function normalizeCategoryPath(path, taxonomySet, taxonomyPaths, bookmark) {
  const clean = Array.isArray(path) ? path.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
  if (clean.length && taxonomySet.has(clean.join(">"))) return clean;

  if (clean.length) {
    const first = clean[0];
    const sameFirst = taxonomyPaths.find((p) => p[0] === first);
    if (sameFirst) return sameFirst;
  }

  return fallbackCategoryForBookmark(bookmark, taxonomyPaths);
}
function fallbackCategoryForBookmark(bookmark, taxonomyPaths) {
  const text = `${bookmark.title} ${bookmark.domain} ${bookmark.urlPath} ${(bookmark.currentFolderPath || []).join(" ")}`.toLowerCase();
  const wanted = [];
  if (/github|gitlab|gitee|npm|react|vue|java|spring|python|developer|docs|csdn|cnblogs|stackoverflow|mdn/.test(text)) wanted.push("开发", "技术", "代码", "文档");
  if (/openai|chatgpt|midjourney|stable|prompt|llm|ai|model|模型|claude|gemini/.test(text)) wanted.push("AI", "工具", "模型", "Prompt");
  if (/figma|design|ui|ux|dribbble|behance|icon|设计|灵感/.test(text)) wanted.push("设计", "产品");
  if (/growth|marketing|startup|saas|business|创业|增长|营销|商业/.test(text)) wanted.push("商业", "增长");
  if (/course|learn|tutorial|教程|学习|课程/.test(text)) wanted.push("学习");
  if (/docs|document|notion|yuque|feishu|语雀|飞书|文档/.test(text)) wanted.push("文档", "资料");

  for (const key of wanted) {
    const found = taxonomyPaths.find((p) => p.some((x) => x.toLowerCase().includes(key.toLowerCase())));
    if (found) return found;
  }
  return taxonomyPaths.find((p) => p.join(">") !== "待确认") || ["待确认"];
}

function sanitizeSuggestedTitle(title, bookmark) {
  const aiTitle = String(title || "").replace(/\s+/g, " ").trim();
  const base = aiTitle || bookmark.title || bookmark.domain || "未命名书签";
  return makeConciseBookmarkTitle(base, bookmark.domain);
}

function shouldAutoApply(s, threshold) {
  return ["move", "move_and_rename"].includes(s.action) && Number(s.confidence || 0) >= threshold && (s.categoryPath || []).join(">") !== "待确认";
}



function handleTaxonomyEditKeydown(event) {
  const el = event.target.closest("[data-taxonomy-index]");
  if (!el) return;
  if (event.key === "Enter") {
    event.preventDefault();
    el.blur();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    const index = Number(el.dataset.taxonomyIndex);
    const oldPath = activeJob?.taxonomy?.categories?.[index]?.path || [];
    el.textContent = oldPath.join(" / ");
    el.blur();
  }
}

async function updateTaxonomyPathFromEditable(el) {
  if (!activeJob?.taxonomy?.categories?.length) return;
  const index = Number(el.dataset.taxonomyIndex);
  if (!Number.isInteger(index) || !activeJob.taxonomy.categories[index]) return;

  const oldPath = activeJob.taxonomy.categories[index].path || [];
  const raw = (el.textContent || "").trim();
  const newPath = raw.split("/").map((x) => x.trim()).filter(Boolean).slice(0, 3);

  if (!newPath.length) {
    el.textContent = oldPath.join(" / ");
    return;
  }

  const oldKey = oldPath.join(">");
  const newKey = newPath.join(">");
  if (oldKey === newKey) return;

  activeJob.taxonomy.categories[index].path = newPath;
  activeJob.taxonomy.categories[index].description = activeJob.taxonomy.categories[index].description || "用户手动编辑的分类";

  const suggestions = await idbGetAllByIndex("suggestions", "jobId", activeJob.jobId);
  const updated = suggestions.map((s) => {
    if ((s.categoryPath || []).join(">") === oldKey) {
      return { ...s, categoryPath: newPath, updatedAt: Date.now(), editedCategory: true };
    }
    return s;
  });

  await idbPutMany("suggestions", updated);
  activeJob.updatedAt = Date.now();
  await idbPut("jobs", activeJob);

  log(`已将分类“${oldPath.join(" / ")}”改为“${newPath.join(" / ")}”，并同步更新整理计划。`);
  await renderPlan(activeJob);
}

function findTaxonomyIndexByPath(pathText) {
  if (!activeJob?.taxonomy?.categories?.length) return -1;
  const key = String(pathText || "").split("/").map((x) => x.trim()).filter(Boolean).join(">");
  return activeJob.taxonomy.categories.findIndex((c) => (c.path || []).join(">") === key);
}




const PENDING_REVIEW_FOLDER_PATH = ["待确认书签"];

function makePendingReviewPath() {
  return [...PENDING_REVIEW_FOLDER_PATH];
}

function buildPendingReviewPlanItems(suggestions, threshold) {
  return buildReviewPlanItems(suggestions, threshold).map((s) => ({
    ...s,
    finalCategoryPath: makePendingReviewPath(),
    finalTitle: makeConciseBookmarkTitle(s.suggestedTitle || s.oldTitle, s.domain),
    pendingReview: true
  }));
}

async function ensureFolderPathTracked(rootId, path, cache, createdFolders) {
  let parentId = rootId;
  let key = "";

  for (const rawTitle of path) {
    const title = String(rawTitle || "").trim();
    if (!title) continue;

    key = key ? `${key}>${title}` : title;
    if (cache.has(key)) {
      parentId = cache.get(key);
      continue;
    }

    const children = await chromeBookmarks.getChildren(parentId);
    let folder = children.find((n) => !n.url && n.title === title);

    if (!folder) {
      folder = await chromeBookmarks.create({ parentId, title });
      createdFolders.push({
        id: folder.id,
        title: folder.title,
        parentId,
        path: key,
        createdAt: Date.now()
      });
    }

    cache.set(key, folder.id);
    parentId = folder.id;
  }

  return parentId;
}

async function cleanupCreatedFolders(job) {
  const created = Array.isArray(job?.createdFolders) ? [...job.createdFolders] : [];
  if (!created.length) {
    log("没有记录到本次创建的文件夹需要清理。");
    return;
  }

  let removed = 0;
  let skipped = 0;

  for (const folder of created.reverse()) {
    try {
      const children = await chromeBookmarks.getChildren(folder.id);
      if (children.length === 0) {
        await chromeBookmarks.removeTree(folder.id);
        removed++;
        log(`已删除空文件夹：${folder.title}`);
      } else {
        skipped++;
        log(`跳过非空文件夹：${folder.title}，里面还有 ${children.length} 项。`);
      }
    } catch (err) {
      skipped++;
      log(`删除文件夹失败：${folder.title || folder.id}，${err.message}`);
    }
  }

  log(`回滚清理完成：删除空文件夹 ${removed} 个，跳过 ${skipped} 个。`);
}

function isFolderModeActive() {
  return !!(activeJob?.scanMode === "folder" && activeJob?.targetFolderId);
}

function normalizeExecutionCategoryPath(path, item) {
  let clean = Array.isArray(path)
    ? path.map((x) => String(x).trim()).filter(Boolean).slice(0, 3)
    : [];

  if (!clean.length || clean[0] === "待确认") return ["待确认"];

  const bookmarkLike = {
    title: item.oldTitle || item.title || item.suggestedTitle || "",
    domain: item.domain || "",
    urlPath: item.urlPath || "",
    currentFolderPath: item.currentFolderPath || []
  };

  clean = ensureCategoryDepth(clean, bookmarkLike).slice(0, 3);
  if (!clean.length || clean[0] === "待确认") return ["待确认"];

  if (isFolderModeActive()) {
    return [clean[0]];
  }

  return clean;
}

function buildExecutablePlanItems(suggestions, threshold) {
  return (suggestions || [])
    .filter((s) => shouldAutoApply(s, threshold))
    .map((s) => ({
      ...s,
      finalCategoryPath: normalizeExecutionCategoryPath(s.categoryPath, s),
      finalTitle: makeConciseBookmarkTitle(s.suggestedTitle || s.oldTitle, s.domain)
    }))
    .filter((s) => (s.finalCategoryPath || [])[0] !== "待确认");
}

function buildReviewPlanItems(suggestions, threshold) {
  return (suggestions || []).filter((s) => !shouldAutoApply(s, threshold));
}

function buildPlanTree(planItems) {
  const root = { count: 0, children: new Map(), items: [] };
  for (const item of planItems || []) {
    const path = normalizeExecutionCategoryPath(item.finalCategoryPath || item.categoryPath, item);
    if (!path.length || path[0] === "待确认") continue;

    root.count++;
    let node = root;
    for (const part of path.slice(0, 3)) {
      if (!node.children.has(part)) node.children.set(part, { count: 0, children: new Map(), items: [] });
      node = node.children.get(part);
      node.count++;
    }
    node.items.push(item);
  }
  return root;
}

function getTopCategoryCountFromPlan(planItems) {
  return new Set((planItems || []).map((s) => (s.finalCategoryPath || [])[0]).filter(Boolean)).size;
}


/* ----------------------------- Tree previews ----------------------------- */

function renderBookmarkTreeFromCurrentState() {
  if (!activeJob) return renderBookmarkTreeFromSuggestions([]);
  idbGetAllByIndex("suggestions", "jobId", activeJob.jobId).then(renderBookmarkTreeFromSuggestions).catch((err) => log(`渲染书签树失败：${err.message}`));
}


function renderBookmarkTreeFromSuggestions(suggestions) {
  const el = $("bookmarkTreePreview");
  if (!suggestions?.length) {
    el.classList.add("empty");
    el.textContent = "暂无结果树。智能整理分类后会在这里展示目标结构。";
    return;
  }

  const q = $("treeSearch").value.trim().toLowerCase();
  const threshold = Number($("threshold").value || DEFAULT_SETTINGS.threshold);
  const filtered = suggestions.filter((s) => !q || [
    s.oldTitle,
    s.suggestedTitle,
    s.domain,
    (s.categoryPath || []).join(" / ")
  ].join(" ").toLowerCase().includes(q));

  const planItems = buildExecutablePlanItems(filtered, threshold);
  const reviewItems = buildReviewPlanItems(filtered, threshold);
  const tree = buildPlanTree(planItems);

  if (!treeDefaultCollapseInitialized && planItems.length) {
    initializeDefaultCollapsedNodes(tree);
    treeDefaultCollapseInitialized = true;
  }

  const rows = [];
  rows.push(treeRow({
    level: 0,
    type: "folder",
    title: isFolderModeActive()
      ? `将在「${activeJob.targetFolderTitle || "所选书签夹"}」内创建的一级分类`
      : "将创建的一级书签夹",
    count: planItems.length,
    pathKey: "__root__",
    open: !collapsedTreeNodes.has("__root__")
  }));

  if (!collapsedTreeNodes.has("__root__")) {
    renderTreeNodeRows(tree, rows, 1, "");
    if (reviewItems.length) {
      const pendingKey = "__pending_review__";
      const pendingOpen = !collapsedTreeNodes.has(pendingKey);
      rows.push(`<div class="tree-row folder-row pending-row" data-tree-key="${pendingKey}">
        <div class="tree-main" style="padding-left:22px">
          <span class="tree-caret">${pendingOpen ? "⌄" : "›"}</span><span class="tree-glyph folder" aria-hidden="true"></span>
          <span class="tree-title">待确认书签</span>
          <span class="tree-actions">执行时会统一移动到这里</span>
        </div>
        <span class="tree-count">${reviewItems.length}</span>
      </div>`);
      if (pendingOpen) {
        for (const item of reviewItems.slice(0, 12)) {
          rows.push(treeRow({
            level: 2,
            type: "link",
            title: item.suggestedTitle || item.oldTitle,
            domain: item.domain
          }));
        }
        if (reviewItems.length > 12) {
          rows.push(`<div class="tree-row collapsed-note">
            <div class="tree-main" style="padding-left:44px">
              <span></span><span class="tree-title">还有 ${reviewItems.length - 12} 条待确认书签未展开显示</span>
            </div>
            <span></span>
          </div>`);
        }
      }
    }
  }

  el.classList.remove("empty");
  el.innerHTML = rows.join("");
}

function initializeDefaultCollapsedNodes(tree) {
  function walk(node, level, parentKey) {
    for (const [name, child] of node.children.entries()) {
      const pathKey = parentKey ? `${parentKey}>${name}` : name;
      if (level >= 2) collapsedTreeNodes.add(pathKey);
      walk(child, level + 1, pathKey);
    }
  }
  walk(tree, 1, "");
}

function renderTreeNodeRows(node, rows, level, parentKey) {
  const entries = [...node.children.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 80);
  for (const [name, child] of entries) {
    const pathKey = parentKey ? `${parentKey}>${name}` : name;
    const defaultCollapsed = level >= 2;
    const open = expandedTreeNodes.has(pathKey) || (!defaultCollapsed && !collapsedTreeNodes.has(pathKey));
    rows.push(treeRow({ level, type: "folder", title: name, count: child.count, pathKey, open }));
    if (!open) {
      rows.push(`<div class="tree-row collapsed-note"><div class="tree-main" style="padding-left:${(level + 1) * 22}px"><span></span><span class="tree-title">已折叠 ${child.count} 项</span></div><span></span></div>`);
      continue;
    }
    if (child.children.size) {
      renderTreeNodeRows(child, rows, level + 1, pathKey);
    }
    for (const item of child.items.slice(0, 8)) {
      rows.push(treeRow({ level: level + 1, type: "link", title: item.suggestedTitle || item.oldTitle, domain: item.domain }));
    }
    if (child.items.length > 8) {
      rows.push(`<div class="tree-row collapsed-note"><div class="tree-main" style="padding-left:${(level + 1) * 22}px"><span></span><span class="tree-title">还有 ${child.items.length - 8} 条书签未展开显示</span></div><span></span></div>`);
    }
  }
}

function renderTaxonomyPreviewFromSuggestions(suggestions) {
  const el = $("taxonomyPreviewTree");
  if (!suggestions?.length) {
    el.classList.add("empty");
    el.textContent = "暂无分类预览。";
    return;
  }

  // 以“最终结构”为准：与整理结果/最终结构树使用同一套口径（阈值过滤 + 归一化/截断后的 finalCategoryPath），
  // 保证“分类体系预览”所见即所得，不再与最终结构出现层级/数量不一致。
  const threshold = Number($("threshold").value || DEFAULT_SETTINGS.threshold);
  const planItems = buildExecutablePlanItems(suggestions, threshold);
  const reviewItems = buildReviewPlanItems(suggestions, threshold);

  const grouped = new Map();
  for (const s of planItems) {
    const key = (s.finalCategoryPath || ["待确认"]).join(" / ");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(s);
  }

  const rows = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 24).map(([path, items], idx) => {
    const examples = items.slice(0, 2).map((x) => escapeHTML(ellipsis(x.suggestedTitle || x.oldTitle, 34))).join("、");
    // 仅当最终路径恰好对应 taxonomy 中某条目时才可编辑；折叠/截断/补深得到的派生路径自然为只读。
    const taxonomyIndex = findTaxonomyIndexByPath(path);
    const editableAttr = taxonomyIndex >= 0 ? `contenteditable="true" spellcheck="false" data-taxonomy-index="${taxonomyIndex}"` : "";
    return `<div class="tree-row ${idx === 0 ? "selected" : ""}">
      <div class="tree-main">
        <span class="tree-caret">⌄</span>
        <span class="tree-glyph folder" aria-hidden="true"></span>
        <span class="tree-title">
          <span class="tree-editable-path" ${editableAttr} title="点击可编辑，Enter 保存，Esc 取消">${escapeHTML(path)}</span>
          <span class="tree-domain">示例：${examples}</span>
        </span>
      </div>
      <span class="tree-count">${items.length}</span>
    </div>`;
  });

  // 与最终结构树的“待确认书签”节点对齐：低置信度项单列一组，数量一致
  if (reviewItems.length) {
    rows.push(`<div class="tree-row pending-row">
      <div class="tree-main">
        <span class="tree-caret">⌄</span>
        <span class="tree-glyph folder" aria-hidden="true"></span>
        <span class="tree-title">
          <span class="tree-editable-path" title="低置信度，待确认">待确认</span>
          <span class="tree-domain">置信度不足，需人工确认</span>
        </span>
      </div>
      <span class="tree-count">${reviewItems.length}</span>
    </div>`);
  }

  if (!rows.length) {
    el.classList.add("empty");
    el.textContent = "暂无分类预览。";
    return;
  }
  el.classList.remove("empty");
  el.innerHTML = rows.join("");
}


function buildSuggestionTree(suggestions, threshold) {
  return buildPlanTree(buildExecutablePlanItems(suggestions, threshold));
}

function treeRow({ level, type, title, count, domain, open, selected, pathKey }) {
  const indent = level * 22;
  const icon = `<span class="tree-glyph ${type === "folder" ? "folder" : "link"}" aria-hidden="true"></span>`;
  const caret = type === "folder" ? (open ? "⌄" : "›") : "";
  const meta = type === "folder" ? `<span class="tree-count">${count ?? ""}</span>` : `<span class="tree-domain">${escapeHTML(domain || "")}</span>`;
  const rowClass = `${selected ? "selected" : ""} ${type === "folder" ? "folder-row" : ""}`;
  const data = type === "folder" ? `data-tree-key="${escapeHTML(pathKey || title || "")}"` : "";
  return `<div class="tree-row ${rowClass}" ${data}><div class="tree-main" style="padding-left:${indent}px"><span class="tree-caret">${caret}</span><span>${icon}</span><span class="tree-title">${escapeHTML(title || "未命名")}</span><span class="tree-actions">${type === "folder" ? "点击折叠/展开" : ""}</span></div>${meta}</div>`;
}

function handleTreeClick(event) {
  const row = event.target.closest(".folder-row[data-tree-key]");
  if (!row) return;
  const key = row.dataset.treeKey;
  if (!key) return;
  const level = key === "__root__" ? 0 : key.split(">").length;
  const defaultCollapsed = level >= 2;
  if (defaultCollapsed) {
    if (expandedTreeNodes.has(key)) expandedTreeNodes.delete(key);
    else expandedTreeNodes.add(key);
  } else {
    if (collapsedTreeNodes.has(key)) collapsedTreeNodes.delete(key);
    else collapsedTreeNodes.add(key);
  }
  renderBookmarkTreeFromCurrentState();
}

function dedupeBookmarksForClassification(bookmarks, mode) {
  if (mode === "none") return { items: [...bookmarks], removed: 0, duplicates: [] };

  const seen = new Map();
  const items = [];
  const duplicates = [];

  for (const b of bookmarks) {
    let key;
    if (mode === "domain_title") {
      key = `${b.domain || ""}|${normalizeTextForDedupe(b.title || "")}`;
    } else {
      key = normalizeUrlForDedupe(b.url || "");
    }

    if (!key) key = `${b.domain || ""}|${b.urlPath || ""}|${normalizeTextForDedupe(b.title || "")}`;

    if (seen.has(key)) {
      duplicates.push({ duplicate: b, original: seen.get(key), key });
    } else {
      seen.set(key, b);
      items.push(b);
    }
  }

  return { items, removed: duplicates.length, duplicates };
}

function normalizeUrlForDedupe(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    const removeParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    for (const p of removeParams) u.searchParams.delete(p);
    return `${u.protocol}//${u.hostname.replace(/^www\./, "")}${u.pathname}${u.search}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function normalizeTextForDedupe(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}



function makeConciseBookmarkTitle(title, domain) {
  let t = String(title || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/[-_|—–]\s*(CSDN博客|博客园|知乎|掘金|简书|GitHub|Gitee|SegmentFault|Stack Overflow)\s*$/i, "")
    .replace(/\s*[-_|—–]\s*(官方文档|文档|Docs|Documentation|API Reference|开发者文档)\s*$/i, "")
    .replace(/^(【.*?】|\[.*?\])\s*/g, "")
    .replace(/\s*(复制|收藏|首页|登录|转载|原创)\s*$/g, "")
    .replace(/(\s*-\s*)?(Google Chrome|Mozilla Firefox|Microsoft Edge)$/i, "")
    .trim();

  const separators = [" - ", " | ", "_", "—", "–"];
  for (const sep of separators) {
    if (t.length > 28 && t.includes(sep)) {
      const first = t.split(sep).map((x) => x.trim()).filter(Boolean)[0];
      if (first && first.length >= 4) t = first;
    }
  }

  if (!t && domain) t = domain;
  if (t.length > 28) t = t.slice(0, 27).trim() + "…";
  return t || "未命名书签";
}

function ensureCategoryDepth(path, bookmark) {
  const clean = Array.isArray(path) ? path.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
  if (clean.length >= 2 || clean[0] === "待确认") return clean.length ? clean : ["待确认"];

  const text = `${bookmark?.title || ""} ${bookmark?.domain || ""} ${bookmark?.urlPath || ""}`.toLowerCase();
  let second = "";
  if (/github|gitlab|gitee|repo|代码|项目/.test(text)) second = "代码与项目";
  else if (/docs|documentation|文档|api|developer/.test(text)) second = "文档资料";
  else if (/react|vue|javascript|typescript|前端/.test(text)) second = "前端开发";
  else if (/java|spring|python|go|后端/.test(text)) second = "后端开发";
  else if (/openai|chatgpt|claude|gemini|llm|模型/.test(text)) second = "模型平台";
  else if (/prompt|提示词/.test(text)) second = "Prompt";
  else if (/figma|ui|ux|design|设计/.test(text)) second = "设计灵感";
  else if (/course|教程|学习|面试/.test(text)) second = "教程学习";
  else second = "综合资料";
  return [clean[0] || "待确认", second];
}

function normalizeTopLevelCategoryCount(categories, desiredCount) {
  const desired = Math.max(3, Math.min(20, Number(desiredCount || 8)));
  const result = [];
  const seen = new Set();

  for (const c of categories) {
    if (!Array.isArray(c.path) || !c.path.length) continue;
    const top = c.path[0];
    if (!top || seen.has(c.path.join(">"))) continue;
    seen.add(c.path.join(">"));
    result.push(c);
  }

  const existingTop = new Set(result.map((c) => c.path[0]).filter((x) => x !== "待确认"));
  const fallbackTops = ["开发技术", "AI 工具", "产品设计", "商业增长", "学习资料", "文档资料", "生活服务", "效率工具", "内容创作", "资源收藏", "职业发展", "其他资料"];

  for (const top of fallbackTops) {
    if (existingTop.size >= desired) break;
    if (!existingTop.has(top)) {
      existingTop.add(top);
      result.push({ path: [top, "综合资料"], description: `补充的一级分类：${top}` });
    }
  }

  if (!result.some((c) => c.path.join(">") === "待确认")) {
    result.push({ path: ["待确认"], description: "AI 无法准确判断或需要人工确认的书签" });
  }

  return result.slice(0, 80);
}


/* ----------------------------- Helpers ----------------------------- */

function compactBookmarkForAI(b) {
  return { id: String(b.id), title: String(b.title || "").slice(0, 120), domain: b.domain, path: b.urlPath, currentFolderPath: b.currentFolderPath };
}
function summarizeForTaxonomy(bookmarks) {
  const domains = countBy(bookmarks.map((b) => b.domain || "unknown"));
  const folders = countBy(bookmarks.map((b) => (b.currentFolderPath || []).join(" / ") || "root"));
  return { total: bookmarks.length, topDomains: [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([domain, count]) => ({ domain, count })), topFolders: [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([folder, count]) => ({ folder, count })), examples: bookmarks.slice(0, 240).map(compactBookmarkForAI) };
}
function categoryClass(path) {
  const label = (path || []).join(" / ");
  if (/AI|模型|Prompt|工具/i.test(label)) return "cat-ai";
  if (/开发|前端|后端|React|代码|技术/i.test(label)) return "cat-dev";
  if (/设计|灵感|UI|图片|产品/i.test(label)) return "cat-design";
  if (/商业|增长|营销|创业/i.test(label)) return "cat-business";
  return "cat-review";
}
function countBy(items) {
  const m = new Map();
  for (const item of items) m.set(item, (m.get(item) || 0) + 1);
  return m;
}
function makeJobId() {
  return `job_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 7)}`;
}
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : Math.max(min, Math.min(max, n));
}
function clampFloat(value, min, max, fallback) {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? fallback : Math.max(min, Math.min(max, n));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function ellipsis(text, max) {
  const s = String(text || "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function escapeHTML(str) {
  return String(str ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function formatDateForFolder(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `(${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())})`;
}
