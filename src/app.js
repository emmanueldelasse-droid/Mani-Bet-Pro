(() => {
  const API_BASE = "https://manitradepro.emmanueldelasse.workers.dev";
  const STORAGE_KEYS = {
    trainingPositions: "mtp_training_positions_v1",
    trainingHistory: "mtp_training_history_v1",
    settings: "mtp_settings_v1",
    algoJournal: "mtp_algo_journal_v1",
    budgetTracker: "mtp_budget_tracker_v1",
    detailCache: "mtp_detail_cache_v1",
    opportunitiesSnapshot: "mtp_opportunities_snapshot_v1",
    trainingCapital: "mtp_training_capital_v1"
  };

  const TRADE_STORAGE = {
    positions: ["mtp_trades_positions", "mtp_training_positions_v2", STORAGE_KEYS.trainingPositions],
    history: ["mtp_trades_history", "mtp_training_history_v2", STORAGE_KEYS.trainingHistory],
    algoJournal: ["mtp_trades_algo_journal", "mtp_algo_journal_v2", STORAGE_KEYS.algoJournal],
    positionsBackup: "mtp_trades_positions_backup",
    historyBackup: "mtp_trades_history_backup",
    algoJournalBackup: "mtp_trades_algo_journal_backup",
    meta: "mtp_trades_meta"
  };

  const defaultSettings = {
    autoRefreshOpportunities: true,
    showSourceBadges: true,
    showScoreBreakdown: true,
    compactCards: false,
    lightTheme: false,
    displayCurrency: "EUR_PLUS_USD",
    showAlgoJournal: true,
    supabaseEnabled: false,
    supabaseUrl: "",
    supabaseAnonKey: ""
  };

  const state = {
    route: "dashboard",
    opportunities: [],
    filteredOpportunities: [],
    opportunityFilter: "all",
    selectedSymbol: null,
    detail: null,
    aiReview: null,
    loading: false,
    loadingDetail: false,
    loadingAiReview: false,
    error: null,
    opportunitiesRequestId: 0,
    opportunitiesFetchedAt: 0,
    lastOpportunitiesFetchStartedAt: 0,
    opportunitiesRefreshing: false,
    opportunitiesLastGoodAt: 0,
    detailRequestStartedAt: 0,
    dashboard: {
      fearGreed: null,
      trending: [],
      portfolio: null
    },
    news: {
      items: [],
      overview: null,
      status: "idle",
      source: null,
      asOf: null,
      message: null
    },
    trades: {
      mode: "training",
      positions: [],
      history: [],
      remoteStatus: "local_only",
      remoteError: null,
      lastRemoteSyncAt: null
    },
    tradeLive: {
      lastRunAt: 0,
      bySymbol: {},
      running: false
    },
    algoJournal: [],
    settings: loadSettings(),
    budget: loadBudgetTracker(),
    detailCache: readJson(STORAGE_KEYS.detailCache, {}),
    opportunitiesSnapshot: readJson(STORAGE_KEYS.opportunitiesSnapshot, []),
    trainingCapital: loadTrainingCapital(),
    nonCryptoHydration: {},
    tradeConfirm: {
      open: false,
      mode: null,
      side: null
    }
  };

  const app = document.getElementById("app");
  const navItems = [
    ["dashboard", "Accueil", "⌂"],
    ["opportunities", "Opportunites", "◎"],
    ["news", "News", "◌"],
    ["portfolio", "Mes trades", "◫"],
    ["settings", "Reglages", "◦"]
  ];

  // =========================
  // storage
  // =========================
  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function removeJson(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function readJsonFromKeys(keys, fallback) {
    for (const key of keys || []) {
      const value = readJson(key, undefined);
      if (value !== undefined) return value;
    }
    return fallback;
  }

  function writeJsonToKeys(keys, value) {
    for (const key of keys || []) writeJson(key, value);
  }

  function saveTradesMeta(extra = {}) {
    writeJson(TRADE_STORAGE.meta, {
      updatedAt: Date.now(),
      schema: "mestrades_v1",
      ...extra
    });
  }

  function loadTrainingCapital() {
    const raw = readJson(STORAGE_KEYS.trainingCapital, null);
    const startingBalanceEur = Number(raw?.startingBalanceEur);
    return {
      startingBalanceEur: Number.isFinite(startingBalanceEur) && startingBalanceEur > 0 ? startingBalanceEur : 10000,
      updatedAt: raw?.updatedAt || null
    };
  }

  function persistTrainingCapital() {
    state.trainingCapital = {
      startingBalanceEur: Number(state.trainingCapital?.startingBalanceEur || 10000),
      updatedAt: Date.now()
    };
    writeJson(STORAGE_KEYS.trainingCapital, state.trainingCapital);
  }

  function resetTrainingCapital() {
    state.trainingCapital = {
      startingBalanceEur: 10000,
      updatedAt: Date.now()
    };
    writeJson(STORAGE_KEYS.trainingCapital, state.trainingCapital);
  }


  function loadTradesMeta() {
    return readJson(TRADE_STORAGE.meta, {});
  }

  const WORKER_TRADES_ROUTES = {
    state: "/api/trades/state",
    sync: "/api/trades/sync"
  };

  async function workerTradesRequest(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`worker_${res.status}:${txt || res.statusText}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res.text();
  }

  async function loadTradesFromWorker() {
    try {
      const payload = await workerTradesRequest(WORKER_TRADES_ROUTES.state);
      const positions = Array.isArray(payload?.data?.positions) ? payload.data.positions.map(normalizePositionRecord) : [];
      const history = Array.isArray(payload?.data?.history) ? payload.data.history.map((x) => normalizePositionRecord(x)) : [];
      const configured = !!payload?.data?.configured;
      state.trades.remoteStatus = configured ? "connected" : "fallback_local";
      state.trades.remoteError = configured ? null : (payload?.message || "worker_not_configured");
      state.trades.lastRemoteSyncAt = Date.now();
      return {
        loaded: true,
        configured,
        positions,
        history,
        payload
      };
    } catch (err) {
      state.trades.remoteStatus = "fallback_local";
      state.trades.remoteError = err?.message || "worker_trades_load_failed";
      return {
        loaded: false,
        configured: false,
        positions: [],
        history: [],
        payload: null
      };
    }
  }

  async function syncTradesToSupabase() {
    try {
      const payload = await workerTradesRequest(WORKER_TRADES_ROUTES.sync, {
        method: "POST",
        body: JSON.stringify({
          positions: Array.isArray(state.trades.positions) ? state.trades.positions.map(normalizePositionRecord) : [],
          history: Array.isArray(state.trades.history) ? state.trades.history.map((x) => normalizePositionRecord(x)) : []
        })
      });
      const configured = !!payload?.data?.configured;
      state.trades.remoteStatus = configured ? "connected" : "fallback_local";
      state.trades.remoteError = configured ? null : (payload?.message || "worker_not_configured");
      state.trades.lastRemoteSyncAt = Date.now();
      saveTradesMeta({
        positionsCount: Array.isArray(state.trades.positions) ? state.trades.positions.length : 0,
        historyCount: Array.isArray(state.trades.history) ? state.trades.history.length : 0,
        pendingRemoteSync: !configured,
        lastSuccessfulRemoteSyncAt: configured ? Date.now() : (loadTradesMeta().lastSuccessfulRemoteSyncAt || null),
        lastRemoteSyncAttemptAt: Date.now()
      });
      return configured;
    } catch (err) {
      state.trades.remoteStatus = "fallback_local";
      state.trades.remoteError = err?.message || "worker_trades_sync_failed";
      saveTradesMeta({
        positionsCount: Array.isArray(state.trades.positions) ? state.trades.positions.length : 0,
        historyCount: Array.isArray(state.trades.history) ? state.trades.history.length : 0,
        pendingRemoteSync: true,
        lastRemoteSyncAttemptAt: Date.now()
      });
      return false;
    }
  }

  function loadSettings() {
    return { ...defaultSettings, ...readJson(STORAGE_KEYS.settings, {}) };
  }

  function persistSettings() {
    writeJson(STORAGE_KEYS.settings, state.settings);
  }

  function budgetDayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function emptyBudgetTracker() {
    return {
      day: budgetDayKey(),
      dailyLimit: 1800,
      used: 0,
      remaining: 1800,
      byRoute: {},
      seenEvents: [],
      schedule: {},
      pools: {
        opportunities: { reserved: 800, used: 0 },
        detail: { reserved: 450, used: 0 },
        candles: { reserved: 200, used: 0 },
        reserve: { reserved: 350, used: 0 }
      }
    };
  }

  function loadBudgetTracker() {
    const stored = readJson(STORAGE_KEYS.budgetTracker, null);
    const fresh = emptyBudgetTracker();
    if (!stored || stored.day !== fresh.day) return fresh;
    return {
      ...fresh,
      ...stored,
      byRoute: stored.byRoute || {},
      seenEvents: stored.seenEvents || [],
      schedule: stored.schedule || {},
      pools: {
        opportunities: { ...fresh.pools.opportunities, ...((stored.pools || {}).opportunities || {}) },
        detail: { ...fresh.pools.detail, ...((stored.pools || {}).detail || {}) },
        candles: { ...fresh.pools.candles, ...((stored.pools || {}).candles || {}) },
        reserve: { ...fresh.pools.reserve, ...((stored.pools || {}).reserve || {}) }
      }
    };
  }

  function persistBudgetTracker() {
    writeJson(STORAGE_KEYS.budgetTracker, state.budget);
  }

  function routePoolName(routeName = "") {
    if (routeName === "opportunities") return "opportunities";
    if (routeName === "detail" || routeName === "quote") return "detail";
    if (routeName === "candles") return "candles";
    return "reserve";
  }

  function recordBudgetUsage(headers) {
    if (!headers) return;
    if (state.budget.day !== budgetDayKey()) state.budget = emptyBudgetTracker();
    const eventId = headers.get("X-MTP-Budget-Event");
    const routeName = headers.get("X-MTP-Route-Name") || "unknown";
    const routeCalls = Number(headers.get("X-MTP-Twelve-Calls") || "0");
    const dailyLimit = Number(headers.get("X-MTP-Budget-Limit") || state.budget.dailyLimit || 1800);
    state.budget.dailyLimit = dailyLimit;
    if (!eventId) {
      state.budget.remaining = Math.max(0, dailyLimit - state.budget.used);
      persistBudgetTracker();
      return;
    }
    if (!state.budget.seenEvents.includes(eventId)) {
      state.budget.seenEvents.push(eventId);
      state.budget.used += routeCalls;
      if (!state.budget.byRoute[routeName]) state.budget.byRoute[routeName] = { calls: 0, events: 0 };
      state.budget.byRoute[routeName].calls += routeCalls;
      state.budget.byRoute[routeName].events += 1;
      const pool = routePoolName(routeName);
      if (state.budget.pools[pool]) state.budget.pools[pool].used += routeCalls;
      state.budget.seenEvents = state.budget.seenEvents.slice(-500);
    }
    state.budget.remaining = Math.max(0, dailyLimit - state.budget.used);
    persistBudgetTracker();
  }

  function estimatedCostForRoute(route, symbol = null) {
    if (route === "opportunities") return 1;
    if (route === "detail") return symbol && ["BTC","ETH","SOL","XRP","AAVE","NEAR","BNB","ADA","DOGE","DOT","LINK","AVAX","ATOM","LTC","MATIC","ARB","OP","UNI","FIL","ETC","BCH","APT","SUI","TAO","XAUT"].includes(String(symbol).toUpperCase()) ? 0 : 2;
    if (route === "candles") return symbol && ["BTC","ETH","SOL","XRP","AAVE","NEAR","BNB","ADA","DOGE","DOT","LINK","AVAX","ATOM","LTC","MATIC","ARB","OP","UNI","FIL","ETC","BCH","APT","SUI","TAO","XAUT"].includes(String(symbol).toUpperCase()) ? 0 : 1;
    return 0;
  }

  function budgetAdvice() {
    const remaining = state.budget.remaining ?? 0;
    if (remaining <= 50) return "";
    if (remaining <= 200) return "";
    return "";
  }

  const CRYPTO_SYMBOLS_UI = new Set(["BTC","ETH","BNB","SOL","XRP","ADA","DOGE","DOT","LINK","AVAX","ATOM","LTC","MATIC","ARB","OP","AAVE","NEAR","UNI","FIL","ETC","BCH","APT","SUI","TAO","XAUT"]);
  const NON_CRYPTO_TRACKED_COUNT = 17;
  const TWELVE_POLICY = {
    opportunities: {
      label: "",
      cooldownMs: 5 * 60 * 1000,
      cost: 1,
      maxPerDay: 288
    },
    detail_non_crypto: {
      label: "",
      cooldownMs: 60 * 60 * 1000,
      cost: 1,
      maxPerDayPerSymbol: 24
    },
    candles_non_crypto: {
      label: "",
      cooldownMs: 12 * 60 * 60 * 1000,
      cost: 1,
      maxPerDayPerSymbol: 2
    }
  };

  function isCryptoSymbol(symbol) {
    return CRYPTO_SYMBOLS_UI.has(String(symbol || "").toUpperCase());
  }

  function scheduleKey(policyName, symbol = "") {
    return symbol ? `${policyName}:${String(symbol).toUpperCase()}` : policyName;
  }

  function getScheduleEntry(policyName, symbol = "") {
    return state.budget.schedule[scheduleKey(policyName, symbol)] || null;
  }

  function nextAllowedAt(policyName, symbol = "") {
    const policy = TWELVE_POLICY[policyName];
    const entry = getScheduleEntry(policyName, symbol);
    if (!policy || !entry || !entry.lastAt) return 0;
    return entry.lastAt + policy.cooldownMs;
  }

  function canRunScheduledFetch(policyName, symbol = "") {
    const next = nextAllowedAt(policyName, symbol);
    return Date.now() >= next;
  }

  function markScheduledFetch(policyName, symbol = "") {
    state.budget.schedule[scheduleKey(policyName, symbol)] = {
      lastAt: Date.now(),
      nextAt: Date.now() + (TWELVE_POLICY[policyName]?.cooldownMs || 0)
    };
    persistBudgetTracker();
  }

  function formatDelay(ms) {
    if (!ms || ms <= 0) return "maintenant";
    const totalMinutes = Math.ceil(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!minutes) return `${hours} h`;
    return `${hours} h ${minutes} min`;
  }

  function nextAllowedLabel(policyName, symbol = "") {
    const next = nextAllowedAt(policyName, symbol);
    if (!next) return "maintenant";
    return formatDelay(next - Date.now());
  }

  function refreshStatusLabel(policyName, symbol = "") {
    const next = nextAllowedAt(policyName, symbol);
    if (!next || Date.now() >= next) return "mise a jour possible maintenant";
    return `prochaine mise a jour dans ${formatDelay(next - Date.now())}`;
  }

  function countdownOnlyLabel(policyName, symbol = "") {
    const next = nextAllowedAt(policyName, symbol);
    if (!next || Date.now() >= next) return "maintenant";
    return `dans ${formatDelay(next - Date.now())}`;
  }

  function dashboardRefreshLabel() {
    return "Le dashboard repart toujours du dernier snapshot enregistre.";
  }

  function detailRefreshLabel(symbol = "") {
    if (!symbol) return "Aucune fiche chargee";
    return isCryptoSymbol(symbol)
      ? "Les actifs crypto restent plus souples car ils ne dependent pas de Twelve."
      : refreshStatusLabel("detail_non_crypto", symbol);
  }

  function candlesRefreshLabel(symbol = "") {
    if (!symbol) return "Aucune bougie chargee";
    return isCryptoSymbol(symbol)
      ? "Les bougies crypto peuvent etre rafraichies plus souvent."
      : refreshStatusLabel("candles_non_crypto", symbol);
  }

  function schedulerSummaryCards(symbol = "") {
    const clean = String(symbol || "").toUpperCase();
    return `
      <div class="grid scheduler-grid">
        <div class="stat-card"><div class="stat-label">Dashboard</div><div class="stat-value small">${dashboardRefreshLabel()}</div></div>
        <div class="stat-card"><div class="stat-label">Opportunites</div><div class="stat-value small">${refreshStatusLabel("opportunities")}</div></div>
        <div class="stat-card"><div class="stat-label">Fiche actif</div><div class="stat-value small">${detailRefreshLabel(clean)}</div></div>
        <div class="stat-card"><div class="stat-label">Bougies</div><div class="stat-value small">${candlesRefreshLabel(clean)}</div></div>
      </div>`;
  }

  function poolRemaining(poolName) {
    const pool = state.budget.pools?.[poolName];
    if (!pool) return state.budget.remaining ?? 0;
    return Math.max(0, (pool.reserved || 0) - (pool.used || 0));
  }

  function canSpendEstimatedBudget(route, symbol = null) {
    const estimated = estimatedCostForRoute(route, symbol);
    const globalRemaining = state.budget.remaining ?? 0;
    if (globalRemaining < estimated) return false;

    if (route === "opportunities") {
      return poolRemaining("opportunities") >= estimated || globalRemaining > 250;
    }
    if (route === "detail") {
      return poolRemaining("detail") >= estimated || globalRemaining > 200;
    }
    if (route === "candles") {
      return poolRemaining("candles") >= estimated || globalRemaining > 300;
    }
    return globalRemaining >= estimated;
  }

  function theoreticalDailyCap() {
    return (state.budget.pools.opportunities.reserved || 0) + (state.budget.pools.detail.reserved || 0) + (state.budget.pools.candles.reserved || 0) + (state.budget.pools.reserve.reserved || 0);
  }

  function persistDetailCache() {
    writeJson(STORAGE_KEYS.detailCache, state.detailCache);
  }

  function detailCacheHit(symbol) {
    const row = state.detailCache[String(symbol || "").toUpperCase()];
    if (!row) return null;
    return row;
  }

  function saveDetailCache(symbol, value) {
    const clean = String(symbol || "").toUpperCase();
    if (!clean || !value) return;
    state.detailCache[clean] = value;
    persistDetailCache();

    const currentList = (state.opportunitiesSnapshot || []).slice();
    const idx = currentList.findIndex(x => String(x.symbol || "").toUpperCase() === clean);
    if (idx >= 0) {
      currentList[idx] = mergeOpportunityWithStored(currentList[idx], value);
      saveOpportunitiesSnapshot(currentList);
      state.opportunities = state.opportunities.map(item =>
        String(item.symbol || "").toUpperCase() === clean ? currentList[idx] : item
      );
      applyFilter();
    }
  }

  async function loadTradesState() {
    const remote = await loadTradesFromWorker();
    const rawPositions = readJsonFromKeys(TRADE_STORAGE.positions, []);
    const rawHistory = readJsonFromKeys(TRADE_STORAGE.history, []);
    const rawAlgo = readJsonFromKeys(TRADE_STORAGE.algoJournal, []);
    const localPositions = Array.isArray(rawPositions) ? rawPositions.map(normalizePositionRecord) : [];
    const localHistory = Array.isArray(rawHistory) ? rawHistory.map((x) => normalizePositionRecord(x)) : [];
    const meta = loadTradesMeta();
    const localUpdatedAt = Number(meta?.localUpdatedAt || meta?.updatedAt || 0);
    const lastSuccessfulRemoteSyncAt = Number(meta?.lastSuccessfulRemoteSyncAt || 0);
    const hasLocalTrades = localPositions.length > 0 || localHistory.length > 0;
    const preferLocal = hasLocalTrades && (
      meta?.pendingRemoteSync === true ||
      (localUpdatedAt > 0 && lastSuccessfulRemoteSyncAt > 0 && localUpdatedAt > lastSuccessfulRemoteSyncAt)
    );

    if (remote.loaded && remote.configured && !preferLocal) {
      state.trades.positions = Array.isArray(remote.positions) ? remote.positions : [];
      state.trades.history = Array.isArray(remote.history) ? remote.history : [];
      saveTradesMeta({
        migratedAt: Date.now(),
        pendingRemoteSync: false,
        lastSuccessfulRemoteSyncAt: Date.now(),
        positionsCount: state.trades.positions.length,
        historyCount: state.trades.history.length
      });
    } else {
      state.trades.positions = localPositions;
      state.trades.history = localHistory;
      if (preferLocal && remote.configured) syncTradesToSupabase().catch(() => {});
    }

    state.algoJournal = Array.isArray(rawAlgo) ? rawAlgo : [];

    // Warm the current versioned keys too, so older/newer builds keep seeing the same trades.
    writeJsonToKeys(TRADE_STORAGE.positions, state.trades.positions);
    writeJsonToKeys(TRADE_STORAGE.history, state.trades.history);
    writeJsonToKeys(TRADE_STORAGE.algoJournal, state.algoJournal);
    writeJson(TRADE_STORAGE.positionsBackup, state.trades.positions);
    writeJson(TRADE_STORAGE.historyBackup, state.trades.history);
    writeJson(TRADE_STORAGE.algoJournalBackup, state.algoJournal);
    saveTradesMeta({
      migratedAt: Date.now(),
      positionsCount: Array.isArray(state.trades.positions) ? state.trades.positions.length : 0,
      historyCount: Array.isArray(state.trades.history) ? state.trades.history.length : 0
    });
  }

  function persistTradesState() {
    const positions = Array.isArray(state.trades.positions) ? state.trades.positions.map(normalizePositionRecord) : [];
    const history = Array.isArray(state.trades.history) ? state.trades.history.map((x) => normalizePositionRecord(x)) : [];
    const algoJournal = Array.isArray(state.algoJournal) ? state.algoJournal : [];
    const localUpdatedAt = Date.now();

    state.trades.positions = positions;
    state.trades.history = history;
    state.algoJournal = algoJournal;

    writeJsonToKeys(TRADE_STORAGE.positions, positions);
    writeJsonToKeys(TRADE_STORAGE.history, history);
    writeJsonToKeys(TRADE_STORAGE.algoJournal, algoJournal);

    writeJson(TRADE_STORAGE.positionsBackup, positions);
    writeJson(TRADE_STORAGE.historyBackup, history);
    writeJson(TRADE_STORAGE.algoJournalBackup, algoJournal);
    saveTradesMeta({
      positionsCount: positions.length,
      historyCount: history.length,
      algoCount: algoJournal.length,
      localUpdatedAt,
      pendingRemoteSync: true
    });
    syncTradesToSupabase().catch(() => {});
  }

  function persistTradesLocalCache() {
    const positions = Array.isArray(state.trades.positions) ? state.trades.positions.map(normalizePositionRecord) : [];
    const history = Array.isArray(state.trades.history) ? state.trades.history.map((x) => normalizePositionRecord(x)) : [];
    state.trades.positions = positions;
    state.trades.history = history;
    writeJsonToKeys(TRADE_STORAGE.positions, positions);
    writeJsonToKeys(TRADE_STORAGE.history, history);
    writeJson(TRADE_STORAGE.positionsBackup, positions);
    writeJson(TRADE_STORAGE.historyBackup, history);
    saveTradesMeta({
      positionsCount: positions.length,
      historyCount: history.length,
      liveUpdatedAt: Date.now(),
      localUpdatedAt: Date.now()
    });
  }

  // =========================
  // helpers
  // =========================
  function safeText(v) {
    return String(v ?? "").replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  function money(v, currency = "USD") {
    if (v == null || Number.isNaN(v)) return "Donnee indisponible";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: v > 999 ? 0 : 2
    }).format(v);
  }

  function fxRateUsdToEur() {
    return 0.92;
  }

  function priceDisplay(vUsd) {
    if (vUsd == null || Number.isNaN(vUsd)) return "Donnee indisponible";
    const eur = vUsd * fxRateUsdToEur();
    const mode = state.settings.displayCurrency || "EUR_PLUS_USD";
    if (mode === "EUR") return money(eur, "EUR");
    if (mode === "USD") return money(vUsd, "USD");
    return `${money(eur, "EUR")} <span class="muted">(${money(vUsd, "USD")})</span>`;
  }

  function currencyLabel() {
    const mode = state.settings.displayCurrency || "EUR_PLUS_USD";
    if (mode === "EUR") return "Euro";
    if (mode === "USD") return "Dollar";
    return "Euro + dollar";
  }

  function simpleDirectionLabel(direction, score) {
    if (direction === "long") return "tendance haussiere";
    if (direction === "short") return "tendance baissiere";
    return "tendance neutre";
  }

  function simpleConfidenceLabel(value) {
    if (value === "high") return "elevee";
    if (value === "medium") return "moyenne";
    if (value === "low") return "faible";
    return "faible";
  }

  function simpleFreshnessLabel(value) {
    if (value === "live") return "en direct";
    if (value === "recent") return "recent";
    return "inconnu";
  }

  function simpleScoreStatusLabel(value) {
    if (value === "complete") return "complet";
    if (value === "partial") return "partiel";
    if (value === "unavailable") return "indisponible";
    return value || "indisponible";
  }

  function simpleAssetClassLabel(value) {
    const map = {
      crypto: "crypto",
      stock: "action",
      etf: "ETF",
      forex: "devise",
      commodity: "matiere premiere",
      unknown: "inconnu"
    };
    return map[value] || value || "inconnu";
  }

  function simpleAnalysisLabel(value) {
    const map = {
      "Constructive bullish bias": "biais haussier leger",
      "Constructive bearish bias": "biais baissier leger",
      "Bullish setup": "hausse probable",
      "Bearish setup": "baisse probable",
      "Early bullish setup": "debut de hausse probable",
      "Early bearish setup": "debut de baisse probable",
      "No clear direction": "tendance neutre",
      "Positive price change": "hausse du prix",
      "Negative price change": "baisse du prix",
      "Flat price change": "prix stable",
      "Real quote available": "prix reel disponible",
      "Source temporarily unavailable": "source temporairement indisponible"
    };
    return map[value] || value || "Analyse indisponible";
  }

  function breakdownLabel(key) {
    const map = {
      regime: "contexte marche",
      trend: "tendance",
      momentum: "elan",
      entryQuality: "qualite d'entree",
      risk: "risque",
      participation: "activite"
    };
    return map[key] || key;
  }

  function num(v, digits = 2) {
    if (v == null || Number.isNaN(v)) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(v);
  }

  function pct(v) {
    if (v == null || Number.isNaN(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${num(v, 2)}%`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  }

  function compactError(message) {
    const msg = String(message || "");
    if (!msg) return null;
    if (msg.includes("Minute quota reached")) return "Quota minute atteint";
    if (msg.includes("Provider key rejected")) return "Cle fournisseur refusee";
    if (msg.includes("Cloudflare subrequest limit reached")) return "Limite Cloudflare atteinte";
    if (msg.includes("Provider plan limit")) return "Limite fournisseur";
    if (msg.includes("temporarily unavailable")) return "Source temporairement indisponible";
    if (msg.length > 90) return msg.slice(0, 87) + "...";
    return msg;
  }

  function badge(label, cls = "") {
    return `<span class="badge ${cls}">${safeText(label)}</span>`;
  }

  function scoreColor(score) {
    if (score == null) return "var(--neutral)";
    if (score >= 70) return "var(--profit)";
    if (score >= 50) return "#f5a623";
    return "var(--loss)";
  }

  function scoreRing(score) {
    const value = score == null ? 0 : Math.max(0, Math.min(100, score));
    const r = 20;
    const c = 2 * Math.PI * r;
    const dash = (value / 100) * c;
    const color = scoreColor(score);
    return `
      <div class="score-ring">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="${r}" fill="none" stroke="var(--bg-elevated)" stroke-width="4"></circle>
          <circle cx="24" cy="24" r="${r}" fill="none" stroke="${color}" stroke-width="4"
            stroke-dasharray="${dash} ${c}" stroke-linecap="round" transform="rotate(-90 24 24)"></circle>
        </svg>
        <div class="score-ring-text" style="color:${color}">${score == null ? "—" : safeText(score)}</div>
      </div>`;
  }

function simpleSideLabel(side) {
  if (side === "long") return "hausse";
  if (side === "short") return "baisse";
  return "neutre";
}

function horizonLabel(days) {
  if (days <= 2) return "court terme";
  if (days <= 10) return "quelques jours";
  return "quelques semaines";
}

function averageRange(candles, count = 14) {
  const recent = (candles || []).slice(-count);
  if (!recent.length) return null;
  const ranges = recent
    .map((c) => (Number.isFinite(c?.high) && Number.isFinite(c?.low)) ? (c.high - c.low) : null)
    .filter((v) => v != null);
  if (!ranges.length) return null;
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

function decisionBadgeClass(decision) {
  if (decision === "Trade conseille") return "decision-strong";
  if (decision === "Trade possible") return "decision-medium";
  if (decision === "A surveiller") return "decision-watch";
  if (decision === "A eviter") return "decision-avoid";
  return "decision-none";
}


function detectedTrendLabel(direction) {
  if (direction === "long") return "tendance haussiere";
  if (direction === "short") return "tendance baissiere";
  return "tendance neutre";
}

function decisionFromReliability(score) {
  if (score >= 70) return "Trade propose";
  if (score >= 55) return "A surveiller";
  return "Pas de trade";
}

function planSummaryText(plan) {
  if (!plan) return "Aucune lecture exploitable pour le moment.";
  if (plan.decision === "Trade propose") return "Le moteur voit un trade assez fiable pour etre ouvert automatiquement.";
  if (plan.decision === "A surveiller") return "Le contexte existe, mais la fiabilite reste insuffisante pour ouvrir un trade maintenant.";
  return "Le moteur prefere ne pas ouvrir de trade sur cet actif pour le moment.";
}

function lightweightTradePlan(item) {
  if (!item || item.price == null || typeof item.score !== "number") return null;
  const score = Number(item.score || 0);
  const dir = String(item.direction || "neutral");
  const synthetic = {
    ...item,
    breakdown: {
      regime: 50,
      trend: dir === "long" ? Math.max(50, score) : dir === "short" ? Math.max(50, 100 - score) : 50,
      momentum: dir === "long" ? Math.max(50, score) : dir === "short" ? Math.max(50, 100 - score) : 50,
      entryQuality: 50,
      risk: 50,
      participation: 50
    },
    candles: []
  };
  return generateTradePlan(synthetic);
}

function generateTradePlan(detail) {
  if (!detail || detail.price == null) return null;

  const rawScore = Number(detail.score ?? 0);
  const direction = String(detail.direction || "neutral");
  const confidenceRaw = detail.confidence || "low";
  const breakdown = detail.breakdown || {};
  const momentum = Number(breakdown.momentum ?? 50);
  const entryQuality = Number(breakdown.entryQuality ?? 50);
  const trend = Number(breakdown.trend ?? 50);
  const regime = Number(breakdown.regime ?? 50);
  const risk = Number(breakdown.risk ?? 50);
  const participation = Number(breakdown.participation ?? 50);

  const avgRange = averageRange(detail.candles || [], 14);
  const fallbackVol = detail.price * (detail.assetClass === "crypto" ? 0.028 : 0.018);
  const vol = avgRange && avgRange > 0 ? avgRange : fallbackVol;

  const aiContext = [];
  if (regime >= 58) aiContext.push("contexte porteur");
  if (regime <= 42) aiContext.push("contexte moyen");
  if (entryQuality >= 65) aiContext.push("entree correcte");
  if (entryQuality <= 45) aiContext.push("entree delicate");
  if (risk >= 60) aiContext.push("risque correct");
  if (risk <= 42) aiContext.push("risque eleve");
  if (participation >= 70) aiContext.push("marche assez actif");

  const directionQuality =
    direction === "long" ? rawScore :
    direction === "short" ? (100 - rawScore) :
    35;

  const finalScore = Math.round(
    regime * 0.14 +
    trend * 0.20 +
    momentum * 0.16 +
    entryQuality * 0.22 +
    risk * 0.18 +
    participation * 0.05 +
    directionQuality * 0.05
  );

  let decision = decisionFromReliability(finalScore);
  let side = direction === "neutral" ? null : direction;
  let urgency = decision === "Trade propose" ? "maintenant" : decision === "A surveiller" ? "attendre" : "ne rien faire";
  let timing = entryQuality >= 70 ? "bon" : entryQuality >= 55 ? "moyen" : "mauvais";
  let trendLabel = detectedTrendLabel(direction);
  let safety = finalScore >= 70 ? "elevee" : finalScore >= 55 ? "moyenne" : "faible";
  let reason = "";
  let aiSummary = "";
  let refusalReason = null;
  let blockerType = null;
  let waitFor = null;

  if (decision === "Trade propose" && side) {
    reason = `${trendLabel}, entree encore exploitable et risque correct.`;
    aiSummary = `Le moteur detecte une ${trendLabel} et juge le plan assez fiable pour ouvrir un trade.`;
    blockerType = "aucun";
    waitFor = "rien de special";
  } else if (decision === "A surveiller") {
    side = null;
    if (entryQuality < 55) {
      blockerType = "timing";
      waitFor = "attendre un meilleur point d'entree";
      reason = `${trendLabel}, mais le timing d'entree reste moyen.`;
      aiSummary = `Le scenario existe, mais le moteur prefere attendre un meilleur point d'entree.`;
      refusalReason = "Trade non ouvert : timing encore trop moyen.";
    } else if (risk < 50) {
      blockerType = "risque";
      waitFor = "attendre un risque plus propre";
      reason = `${trendLabel}, mais le risque reste trop present pour entrer maintenant.`;
      aiSummary = `Le signal existe, mais le risque reste encore trop important.`;
      refusalReason = "Trade non ouvert : risque encore trop eleve.";
    } else {
      blockerType = "confirmation";
      waitFor = "attendre une confirmation de marche";
      reason = `${trendLabel}, mais le signal demande encore une confirmation.`;
      aiSummary = `Le contexte est interessant, mais le moteur prefere attendre une confirmation plus nette.`;
      refusalReason = "Trade non ouvert : confirmation encore insuffisante.";
    }
  } else {
    side = null;
    if (trend < 45 && momentum < 45) {
      blockerType = "signal";
      waitFor = "attendre un signal plus clair";
      reason = `${trendLabel}, mais le mouvement reste trop faible pour proposer un trade.`;
      aiSummary = `Le moteur refuse le trade car le signal reste trop faible.`;
      refusalReason = "Pas de trade : signal trop faible.";
    } else if (entryQuality < 45) {
      blockerType = "timing";
      waitFor = "attendre un meilleur point d'entree";
      reason = `${trendLabel}, mais l'entree est trop mauvaise pour etre exploitee.`;
      aiSummary = `Le moteur refuse le trade car le timing d'entree est mauvais.`;
      refusalReason = "Pas de trade : timing d'entree mauvais.";
    } else if (risk < 45) {
      blockerType = "risque";
      waitFor = "attendre moins de risque";
      reason = `${trendLabel}, mais le risque reste trop eleve.`;
      aiSummary = `Le moteur refuse le trade car le risque reste trop eleve.`;
      refusalReason = "Pas de trade : risque trop eleve.";
    } else {
      blockerType = "ratio";
      waitFor = "attendre un meilleur ratio gain / risque";
      reason = `${trendLabel}, mais le trade n'offre pas encore un plan assez propre.`;
      aiSummary = `Le moteur refuse le trade car le plan global reste trop faible.`;
      refusalReason = "Pas de trade : plan encore insuffisant.";
    }
  }

  if (!side) {
    return {
      decision,
      side: null,
      entry: null,
      stopLoss: null,
      takeProfit: null,
      rr: null,
      confidence: simpleConfidenceLabel(confidenceRaw),
      urgency,
      timing,
      horizon: "a definir",
      reason,
      refusalReason,
      aiSummary,
      safety,
      aiContext,
      finalScore,
      trendLabel,
      blockerType,
      waitFor
    };
  }

  const riskDistance = Math.max(
    vol * (detail.assetClass === "crypto" ? 1.0 : 0.85),
    detail.price * (detail.assetClass === "crypto" ? 0.013 : 0.009)
  );
  const rewardMultiplier = finalScore >= 80 ? 2.6 : 2.1;
  const rewardDistance = riskDistance * rewardMultiplier;
  const entry = detail.price;
  const stopLoss = side === "long" ? entry - riskDistance : entry + riskDistance;
  const takeProfit = side === "long" ? entry + rewardDistance : entry - rewardDistance;
  const rr = rewardDistance / riskDistance;
  const horizonDays = finalScore >= 80 ? (detail.assetClass === "crypto" ? 2 : 4) : (detail.assetClass === "crypto" ? 3 : 5);

  return {
    decision,
    side,
    entry,
    stopLoss,
    takeProfit,
    rr,
    confidence: simpleConfidenceLabel(confidenceRaw),
    urgency,
    timing,
    horizon: horizonLabel(horizonDays),
    reason,
    refusalReason,
    aiSummary,
    safety,
    aiContext,
    finalScore,
    trendLabel,
    blockerType,
    waitFor
  };
}


function hasRichBreakdown(item) {
  const b = item?.breakdown || null;
  return !!(b && ["regime", "trend", "momentum", "entryQuality", "risk", "participation"].every((k) => typeof b[k] === "number"));
}

function detailEngineInputFor(item) {
  if (!item) return null;
  const clean = String(item.symbol || "").toUpperCase();
  const cached = clean ? detailCacheHit(clean) : null;
  if (cached && cached.price != null && hasRichBreakdown(cached)) {
    return { ...cached, candles: cached.candles || [] };
  }
  if (hasRichBreakdown(item) && item.price != null) {
    return { ...item, candles: item.candles || [] };
  }
  return null;
}



function rowIsUnavailable(item) {
  if (!item) return true;
  if (item.status === "unavailable") return true;
  if (item.scoreStatus === "unavailable") return true;
  if (item.error && item.price == null && item.score == null && item.officialScore == null) return true;
  return false;
}

function rowIsUnavailable(item) {
  return !item || item.status === "unavailable" || item.scoreStatus === "unavailable";
}

function rowDecisionLabel(item) {
  if (rowIsUnavailable(item)) return "Indisponible";
  return item?.decision || "Pas de trade";
}

function rowTrendLabel(item) {
  if (rowIsUnavailable(item)) return compactError(item?.error || item?.reasonShort || "Source temporairement indisponible") || "indisponible";
  return item?.trendLabel || "tendance neutre";
}

async function hydrateNonCryptoRows(rows) { return; }

function rowTradePlan(item) {
  if (!item || !item.plan) return null;
  return item.plan;
}

function currentTradePlan() {
  return state.detail?.plan || null;
}

function simpleRiskQualityLabel(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "indisponible";
  if (value >= 80) return "faible";
  if (value >= 60) return "correct";
  if (value >= 40) return "acceptable";
  return "eleve";
}

function setupStatusBadgeClass(status) {
  const v = String(status || "").toLowerCase();
  if (v.includes("confirme") || v.includes("propre")) return "positive";
  if (v.includes("surveiller") || v.includes("trop tard")) return "warning";
  if (v.includes("risque") || v.includes("non exploitable") || v.includes("pas de trade")) return "negative";
  return "";
}

function setupStatusLabel(status) {
  return String(status || "Statut inconnu");
}

function confirmationLabelText(plan) {
  const count = Number(plan?.confirmationCount ?? 0);
  const label = String(plan?.confirmationLabel || "").trim();
  if (!count) return "0 confirmation";
  return `${count} confirmation${count > 1 ? "s" : ""}${label ? ` · ${label}` : ""}`;
}

function mainBlockerText(plan) {
  const blockers = Array.isArray(plan?.blockers) ? plan.blockers.filter(Boolean) : [];
  if (blockers.length) return blockers[0];
  return "";
}

function priorityLevel(item) {
  const plan = rowTradePlan(item) || {};
  const score = Number(plan?.finalScore ?? item?.score ?? 0);
  const tradeNow = plan?.tradeNow === true;
  const confirmations = Number(plan?.confirmationCount ?? 0);
  const blockers = Array.isArray(plan?.blockers) ? plan.blockers.filter(Boolean).length : 0;
  if (tradeNow && score >= 78 && confirmations >= 4 && blockers === 0) return "priorite haute";
  if (tradeNow || score >= 65) return "priorite utile";
  if (score >= 45) return "secondaire";
  return "faible";
}

function opportunitiesQuickSummary(groups) {
  const proposed = Array.isArray(groups?.proposed) ? groups.proposed : [];
  const watch = Array.isArray(groups?.watch) ? groups.watch : [];
  const leader = proposed[0] || watch[0] || null;
  if (!leader) return "Aucun actif propre ne ressort pour le moment.";
  const leaderPlan = rowTradePlan(leader) || {};
  const leaderBlocker = mainBlockerText(leaderPlan);
  const names = proposed.slice(0, 3).map((x) => x.symbol).join(", ");
  const leadText = proposed.length ? `Priorites du moment : ${names}.` : `Priorite du moment : ${leader.symbol}.`;
  const tradeText = proposed.length
    ? `${proposed.length} setup${proposed.length > 1 ? "s" : ""} actionnable${proposed.length > 1 ? "s" : ""}`
    : "aucun setup actionnable";
  const watchText = `${watch.length} actif${watch.length > 1 ? "s" : ""} a surveiller`;
  const blockerText = leaderBlocker ? `Blocage principal hors priorite : ${leaderBlocker}.` : "Aucun blocage majeur sur les priorites principales.";
  return `${leadText} ${tradeText}, ${watchText}. ${blockerText}`;
}

function relatedNewsForSymbol(symbol, name = "") {
  const clean = String(symbol || "").toUpperCase();
  const rawName = String(name || "").trim();
  const words = rawName.split(/\s+/).filter((w) => w.length >= 4).slice(0, 2);
  return (state.news?.items || []).filter((item) => {
    const assets = Array.isArray(item?.assets) ? item.assets.map((x) => String(x || "").toUpperCase()) : [];
    const hay = `${item?.title || ""} ${item?.summary || ""}`.toLowerCase();
    if (assets.includes(clean)) return true;
    if (clean && hay.includes(clean.toLowerCase())) return true;
    return words.some((w) => hay.includes(w.toLowerCase()));
  }).slice(0, 3);
}

function renderTradeConfirmModal() {
  if (!state.tradeConfirm?.open) return "";
  const d = state.detail;
  const plan = currentTradePlan() || {};
  const side = state.tradeConfirm?.side || plan?.side || null;
  const entry = plan?.entry ?? d?.price ?? null;
  const quantity = entry > 500 ? 1 : entry > 50 ? 2 : 10;
  const invested = (Number(entry) || 0) * quantity;
  const title = state.tradeConfirm?.mode === "recommended" ? "Confirmer le trade propose" : "Confirmer le trade manuel";
  const reason = state.tradeConfirm?.mode === "recommended"
    ? (plan?.reason || "Le moteur propose ce setup.")
    : "Trade manuel d'entrainement depuis la fiche actif.";

  return `
    <div class="modal-backdrop" data-cancel-trade-confirm style="position:fixed;inset:0;background:rgba(3,8,20,.72);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px">
      <div class="card" style="width:min(560px,100%);padding:18px 18px 16px;border:1px solid rgba(255,255,255,.12)" onclick="event.stopPropagation()">
        <div class="section-title"><span>${safeText(title)}</span><span>${safeText(d?.symbol || "—")}</span></div>
        <div class="kv" style="margin-top:10px">
          <div class="muted">Actif</div><div>${safeText(d?.symbol || "—")} · ${safeText(d?.name || "")}</div>
          <div class="muted">Sens</div><div>${safeText(simpleSideLabel(side || "long"))}</div>
          <div class="muted">Entree</div><div>${entry != null ? priceDisplay(entry) : "—"}</div>
          <div class="muted">Quantite</div><div>${quantity}</div>
          <div class="muted">Investi</div><div>${entry != null ? priceDisplay(invested) : "—"}</div>
          <div class="muted">Stop</div><div>${plan?.stopLoss != null ? priceDisplay(plan.stopLoss) : "—"}</div>
          <div class="muted">Objectif</div><div>${plan?.takeProfit != null ? priceDisplay(plan.takeProfit) : "—"}</div>
          <div class="muted">Ratio</div><div>${plan?.rr != null ? num(plan.rr, 2) : "—"}</div>
        </div>
        <div class="plan-reason" style="margin-top:12px">${safeText(reason)}</div>
        <div class="trade-actions" style="margin-top:14px">
          <button class="btn" data-cancel-trade-confirm>Annuler</button>
          <button class="btn trade-btn primary" data-confirm-open-trade>Confirmer le trade</button>
        </div>
      </div>
    </div>`;
}

function openTradeConfirmModal(mode, side = null) {
  state.tradeConfirm = { open: true, mode, side };
  state.error = null;
  render();
}

function closeTradeConfirmModal() {
  state.tradeConfirm = { open: false, mode: null, side: null };
  render();
}

function confirmTradeFromModal() {
  const mode = state.tradeConfirm?.mode;
  const side = state.tradeConfirm?.side || null;
  state.tradeConfirm = { open: false, mode: null, side: null };
  if (mode === "recommended") createRecommendedTrade();
  else if (mode === "manual" && side) addTrainingTradeFromDetail(side);
}

  function normalizeOpportunity(item) {
    return {
      symbol: item?.symbol || "",
      name: item?.name || "Nom indisponible",
      assetClass: item?.assetClass || "unknown",
      price: typeof item?.price === "number" ? item.price : null,
      change24hPct: typeof item?.change24hPct === "number" ? item.change24hPct : null,
      sourceUsed: item?.sourceUsed || null,
      freshness: item?.freshness || "unknown",
      status: item?.status || (item?.price != null ? "ok" : "unavailable"),
      score: typeof item?.score === "number" ? item.score : null,
      scoreStatus: item?.scoreStatus || (item?.price != null ? "complete" : "unavailable"),
      direction: item?.direction || "neutral",
      analysisLabel: item?.analysisLabel || null,
      confidence: item?.confidence || "low",
      confidenceLabel: item?.confidenceLabel || simpleConfidenceLabel(item?.confidence || "low"),
      breakdown: item?.breakdown || null,
      reasonShort: item?.reasonShort || null,
      decision: item?.decision || null,
      trendLabel: item?.trendLabel || null,
      plan: item?.plan || null,
      setupStatus: item?.setupStatus || item?.plan?.setupStatus || null,
      tradeNow: item?.tradeNow === true || item?.plan?.tradeNow === true,
      confirmationCount: typeof item?.confirmationCount === "number" ? item.confirmationCount : (typeof item?.plan?.confirmationCount === "number" ? item.plan.confirmationCount : null),
      blockers: Array.isArray(item?.blockers) ? item.blockers : (Array.isArray(item?.plan?.blockers) ? item.plan.blockers : []),
      candles: Array.isArray(item?.candles) ? item.candles : [],
      error: compactError(item?.error || item?.reasonShort || null)
    };
  }

  function saveOpportunitiesSnapshot(rows) {
    state.opportunitiesSnapshot = rows;
    writeJson(STORAGE_KEYS.opportunitiesSnapshot, rows);
  }

  function mergeOpportunityWithStored(current, stored) {
    if (!stored) return current;
    return normalizeOpportunity({
      ...current,
      ...stored,
      price: stored.price ?? current.price,
      change24hPct: stored.change24hPct ?? current.change24hPct,
      score: stored.score ?? current.score,
      decision: stored.decision || current.decision || null,
      trendLabel: stored.trendLabel || current.trendLabel || null,
      reasonShort: stored.reasonShort || current.reasonShort || null,
      plan: stored.plan || current.plan || null,
      status: stored.status || current.status || null,
      freshness: stored.freshness || current.freshness || "unknown"
    });
  }

  function backfillOpportunities(rows) {
    const snapshotMap = new Map((state.opportunitiesSnapshot || []).map(x => [String(x.symbol || "").toUpperCase(), x]));
    return (rows || []).map((item) => {
      const clean = String(item?.symbol || "").toUpperCase();
      if (!clean) return item;
      const snap = snapshotMap.get(clean);
      return snap ? mergeOpportunityWithStored(item, snap) : item;
    });
  }

  function setOpportunities(rows) {
    const prepared = Array.isArray(rows) ? backfillOpportunities(rows).map(normalizeOpportunity) : [];
    state.opportunities = prepared;
    saveOpportunitiesSnapshot(prepared);
    applyFilter();
    state.opportunitiesFetchedAt = Date.now();
    state.opportunitiesLastGoodAt = state.opportunitiesFetchedAt;
  }

  // =========================
  // api
  // =========================
  async function api(path, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") throw new Error("Delai depasse");
      throw e;
    }
    clearTimeout(timer);
    recordBudgetUsage(res.headers);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  async function apiPost(path, payload) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  async function loadAiReview(detail, localPlan) {
    if (!detail) return null;
    state.loadingAiReview = true;
    state.aiReview = null;
    render();
    try {
      const payload = {
        symbol: detail.symbol,
        detail: {
          symbol: detail.symbol,
          name: detail.name,
          assetClass: detail.assetClass,
          price: detail.price,
          change24hPct: detail.change24hPct,
          score: detail.score,
          scoreStatus: detail.scoreStatus,
          direction: detail.direction,
          analysisLabel: detail.analysisLabel,
          confidence: detail.confidence,
          breakdown: detail.breakdown || {},
          sourceUsed: detail.sourceUsed,
          freshness: detail.freshness
        },
        localPlan
      };
      const review = await apiPost("/api/ai/trade-review", payload);
      state.aiReview = review?.data || null;
    } catch (e) {
      state.aiReview = {
        provider: "local_ui_fallback",
        externalAiUsed: false,
        decision: localPlan?.decision || "Pas de trade conseille",
        prudence: localPlan?.safety || "moyenne",
        reason: localPlan?.aiSummary || localPlan?.reason || "Lecture prudente locale utilisee.",
        invalidation: localPlan?.refusalReason || "Attendre un signal plus propre.",
        summary: localPlan?.aiSummary || localPlan?.reason || "Lecture prudente locale utilisee.",
        warning: "Pont Analyse externe indisponible."
      };
    } finally {
      state.loadingAiReview = false;
      render();
    }
  }

  async function loadDashboard() {
    try {
      const [fg, trending, portfolio, news] = await Promise.all([
        api("/api/fear-greed").catch(() => null),
        api("/api/trending").catch(() => null),
        api("/api/portfolio/summary").catch(() => null),
        api("/api/news").catch(() => null)
      ]);
      state.dashboard.fearGreed = fg?.data || null;
      state.dashboard.trending = trending?.data || [];
      state.dashboard.portfolio = portfolio?.data || null;
      state.news = {
        items: Array.isArray(news?.data?.items) ? news.data.items : [],
        overview: news?.data?.overview || null,
        status: news?.status || "idle",
        source: news?.source || null,
        asOf: news?.asOf || null,
        message: news?.message || null
      };
      state.error = null;
    } catch (e) {
      state.error = e.message || "Chargement impossible";
    }
  }

  async function loadOpportunities(force = true) {
    const now = Date.now();

    if (!canSpendEstimatedBudget("opportunities") && state.opportunities.length) {
      state.error = null;
      render();
      return;
    }

    if (state.opportunities.length && !canRunScheduledFetch("opportunities")) {
      state.error = null;
      render();
      return;
    }

    if (!force && state.opportunities.length && (now - state.opportunitiesFetchedAt) < 30000) {
      render();
      return;
    }

    if ((now - state.lastOpportunitiesFetchStartedAt) < 8000 && state.opportunities.length) {
      state.error = "Attends quelques secondes avant un nouveau refresh.";
      render();
      return;
    }

    state.lastOpportunitiesFetchStartedAt = now;
    const requestId = ++state.opportunitiesRequestId;
    const hasVisibleRows = Array.isArray(state.opportunities) && state.opportunities.length > 0;

    state.opportunitiesRefreshing = true;
    if (force && !hasVisibleRows) {
      state.loading = true;
    }
    render();

    try {
      const result = await api("/api/opportunities", 12000);
      if (requestId !== state.opportunitiesRequestId) return;
      const rows = Array.isArray(result?.data) ? result.data : [];
      if (rows.length) {
        setOpportunities(rows);
        rows.forEach((row) => updateJournalMoteurFromOpportunity(normalizeOpportunity(row)));
        state.opportunitiesLastGoodAt = Date.now();
      }
      markScheduledFetch("opportunities");
      state.error = null;
    } catch (e) {
      if (requestId !== state.opportunitiesRequestId) return;
      if (!state.opportunities.length && state.opportunitiesSnapshot?.length) {
        state.opportunities = state.opportunitiesSnapshot.map(normalizeOpportunity);
        applyFilter();
      }
      state.error = state.opportunities.length ? "Mise a jour impossible pour le moment. Derniere liste conservee." : (e.message || "Chargement impossible");
    } finally {
      if (requestId !== state.opportunitiesRequestId) return;
      state.loading = false;
      state.opportunitiesRefreshing = false;
      render();
    }
  }

  async function loadDetail(symbol) {
    const now = Date.now();
    const cleanSymbol = String(symbol || "").toUpperCase();
    const cachedDetail = detailCacheHit(cleanSymbol);

    if (state.detail && state.detail.symbol === cleanSymbol && (now - state.detailRequestStartedAt) < 15000) {
      render();
      return;
    }

    state.detailRequestStartedAt = now;
    state.loadingDetail = !cachedDetail;
    if (cachedDetail) state.detail = normalizeOpportunity(cachedDetail);
    state.error = null;
    render();

    try {
      const [detail, candles] = await Promise.all([
        api(`/api/opportunity-detail/${encodeURIComponent(cleanSymbol)}`),
        api(`/api/candles/${encodeURIComponent(cleanSymbol)}?timeframe=1d&limit=90`).catch(() => null)
      ]);

      const merged = normalizeOpportunity({
        ...(detail.data || {}),
        candles: Array.isArray(detail?.data?.candles) && detail.data.candles.length
          ? detail.data.candles
          : (candles?.data || cachedDetail?.candles || [])
      });

      state.detail = merged;
      updateJournalMoteurFromOpportunity(merged);
      saveDetailCache(cleanSymbol, merged);
      state.error = null;

      if (merged.status === "ok" && merged.plan) {
        loadAiReview(merged, merged.plan);
      } else {
        state.aiReview = null;
      }
    } catch (e) {
      state.error = e.message || "Fiche indisponible";
      if (cachedDetail) state.detail = normalizeOpportunity(cachedDetail);
    } finally {
      state.loadingDetail = false;
      render();
    }
  }

  // =========================
  // trades
  // =========================
  function getOpenPnl(position, livePrice) {
    if (position.entryPrice == null || livePrice == null || !position.quantity) return { pnl: null, pnlPct: null };
    const priceDiff = position.side === "short" ? (position.entryPrice - livePrice) : (livePrice - position.entryPrice);
    const pnl = priceDiff * position.quantity;
    const invested = position.entryPrice * position.quantity;
    const pnlPct = invested ? (pnl / invested) * 100 : null;
    return { pnl, pnlPct };
  }

function addTrainingTradeFromDetail(side) {
  const d = state.detail;
  if (!d || d.price == null) {
    state.error = "Impossible d'ajouter ce trade pour le moment.";
    render();
    return;
  }
  const quantity = d.price > 500 ? 1 : d.price > 50 ? 2 : 10;
  const investedUsd = d.price * quantity;
  if (!canOpenTrainingTrade(d.price, quantity)) {
    state.error = "Capital fictif insuffisant pour ouvrir ce trade d'entrainement.";
    render();
    return;
  }
  const position = {
    id: uid("pos"),
    symbol: d.symbol,
    name: d.name,
    assetClass: d.assetClass,
    side,
    quantity,
    entryPrice: d.price,
    invested: investedUsd,
    openedAt: nowIso(),
    sourceUsed: d.sourceUsed || null,
    stopLoss: null,
    takeProfit: null,
    tradeDecision: "manuel",
    tradeReason: "Trade cree manuellement depuis la fiche actif.",
    rr: null,
    horizon: null,
    execution: {
      openedAt: nowIso(),
      entryPrice: d.price,
      quantity,
      invested: investedUsd
    }
  };
  state.trades.positions.unshift(position);
  state.algoJournal.unshift({
    id: uid("algo"),
    symbol: d.symbol,
    createdAt: nowIso(),
    mode: "manuel",
    score: d.score ?? null,
    decision: "manuel",
    side,
    entry: d.price,
    stopLoss: null,
    takeProfit: null,
    rr: null,
    confidence: simpleConfidenceLabel(d.confidence || "low"),
    reason: "Trade manuel depuis la fiche actif.",
    aiSummary: "Decision manuelle hors moteur prudent.",
    safety: "non evalue"
  });
  persistTradesState();
  state.error = null;
  render();
}

function createRecommendedTrade() {
  const d = state.detail;
  const plan = currentTradePlan();
  if (!d || !plan || !plan.side || plan.decision !== "Trade propose") {
    state.error = "Aucun trade n'est propose automatiquement pour le moment.";
    render();
    return;
  }
  const quantity = d.price > 500 ? 1 : d.price > 50 ? 2 : 10;
  const investedUsd = plan.entry * quantity;
  if (!canOpenTrainingTrade(plan.entry, quantity)) {
    state.error = "Capital fictif insuffisant pour ouvrir ce trade propose.";
    render();
    return;
  }
  const position = {
    id: uid("pos"),
    symbol: d.symbol,
    name: d.name,
    assetClass: d.assetClass,
    side: plan.side,
    quantity,
    entryPrice: plan.entry,
    invested: investedUsd,
    openedAt: nowIso(),
    sourceUsed: d.sourceUsed || null,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit,
    tradeDecision: plan.decision,
    tradeReason: plan.reason,
    rr: plan.rr,
    horizon: plan.horizon,
    confidence: plan.confidence,
    algoScore: d.score ?? null,
    execution: {
      openedAt: nowIso(),
      entryPrice: plan.entry,
      quantity,
      invested: investedUsd
    }
  };
  state.trades.positions.unshift(position);
  state.algoJournal.unshift({
    id: uid("algo"),
    symbol: d.symbol,
    createdAt: nowIso(),
    mode: "conseille",
    score: d.score ?? null,
    decision: plan.decision,
    side: plan.side,
    entry: plan.entry,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit,
    rr: plan.rr,
    confidence: plan.confidence,
    reason: plan.reason,
    horizon: plan.horizon,
    aiSummary: state.aiReview?.summary || plan.aiSummary,
    safety: state.aiReview?.prudence || plan.safety,
    aiProvider: state.aiReview?.provider || "local_plan"
  });
  persistTradesState();
  state.error = null;
  render();
}

function closeTrainingTrade(id, livePrice = null) {
    const idx = state.trades.positions.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const position = normalizePositionRecord(state.trades.positions[idx]);
    const meta = tradeStatusMeta(position);
    const fallbackEntry = Number(position?.execution?.entryPrice ?? position?.entryPrice);
    const resolvedExitPrice = Number(livePrice ?? meta.livePrice ?? position?.live?.price ?? fallbackEntry);
    const exitPrice = (Number.isFinite(resolvedExitPrice) && resolvedExitPrice > 0) ? resolvedExitPrice : fallbackEntry;
    if (!(Number.isFinite(exitPrice) && exitPrice > 0)) {
      state.error = "Impossible de cloturer ce trade : prix de sortie invalide.";
      render();
      return;
    }
    const { pnl, pnlPct } = getOpenPnl(position, exitPrice);
    const closedAt = nowIso();
    const closed = normalizePositionRecord({
      ...position,
      exitPrice,
      closedAt,
      pnl,
      pnlPct,
      sourceUsed: position.sourceUsed || "training",
      closeType: "Cloture manuelle",
      closedExecution: {
        exitPrice,
        closedAt,
        closeType: "Cloture manuelle"
      }
    });
    state.trades.positions.splice(idx, 1);
    state.trades.history.unshift(closed);
    persistTradesState();
    render();
  }

  function trainingWallet() {
    const positions = Array.isArray(state.trades?.positions) ? state.trades.positions.map(normalizePositionRecord) : [];
    const history = Array.isArray(state.trades?.history) ? state.trades.history.map(normalizePositionRecord) : [];
    const startingBalanceEur = Number(state.trainingCapital?.startingBalanceEur || 10000);

    const engagedEur = positions.reduce((sum, p) => {
      const investedUsd = Number((p.execution || {}).invested ?? p.invested);
      return sum + ((Number.isFinite(investedUsd) && investedUsd > 0) ? investedUsd * fxRateUsdToEur() : 0);
    }, 0);

    const realizedEur = history.reduce((sum, row) => sum + (Number(row?.pnl || 0) * fxRateUsdToEur()), 0);
    const unrealizedEur = positions.reduce((sum, p) => sum + (Number((p.live || {}).pnl || 0) * fxRateUsdToEur()), 0);
    const availableEur = startingBalanceEur + realizedEur - engagedEur;
    const equityEur = startingBalanceEur + realizedEur + unrealizedEur;

    return {
      startingBalanceEur,
      engagedEur,
      realizedEur,
      unrealizedEur,
      availableEur,
      equityEur
    };
  }

  function canOpenTrainingTrade(entryPriceUsd, quantity) {
    const wallet = trainingWallet();
    const requiredEur = Number(entryPriceUsd || 0) * Number(quantity || 0) * fxRateUsdToEur();
    return Number.isFinite(requiredEur) && requiredEur > 0 && wallet.availableEur >= requiredEur;
  }

  function trainingStats() {
    const positions = state.trades.positions;
    const history = state.trades.history;
    const realized = history.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winsRows = history.filter((t) => Number(t.pnl || 0) > 0);
    const lossRows = history.filter((t) => Number(t.pnl || 0) < 0);
    const wins = winsRows.length;
    const total = history.length;
    const grossWin = winsRows.reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    const grossLossAbs = Math.abs(lossRows.reduce((sum, t) => sum + Number(t.pnl || 0), 0));
    const wallet = trainingWallet();
    return {
      openCount: positions.length,
      closedCount: history.length,
      realized,
      winRate: total ? (wins / total) * 100 : null,
      avgWin: winsRows.length ? grossWin / winsRows.length : null,
      avgLoss: lossRows.length ? lossRows.reduce((sum, t) => sum + Number(t.pnl || 0), 0) / lossRows.length : null,
      profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : (grossWin > 0 ? 999 : null),
      wallet
    };
  }

  
function groupedOpportunities(rows) {
  const items = Array.isArray(rows) ? rows.slice() : [];
  const buckets = { proposed: [], watch: [], noTrade: [] };

  items.forEach((item) => {
    const decision = rowDecisionLabel(item);
    const score = typeof item?.score === "number" ? item.score : -1;
    const enriched = { ...item, _score: score };

    if (decision === "Trade propose") buckets.proposed.push(enriched);
    else if (decision === "A surveiller") buckets.watch.push(enriched);
    else buckets.noTrade.push(enriched);
  });

  const sorter = (a, b) => {
    if ((b._score ?? -1) !== (a._score ?? -1)) return (b._score ?? -1) - (a._score ?? -1);
    return String(a.symbol || "").localeCompare(String(b.symbol || ""));
  };

  buckets.proposed.sort(sorter);
  buckets.watch.sort(sorter);
  buckets.noTrade.sort(sorter);

  return buckets;
}

function renderOpportunitySection(title, subtitle, rows, baseRank = 1, emptyText = "Aucun actif dans cette section.") {
  return `
    <section class="opp-section">
      <div class="section-title">
        <span>${safeText(title)}</span>
        <span>${rows.length}</span>
      </div>
      <div class="opp-section-subtitle">${safeText(subtitle)}</div>
      ${rows.length
        ? `<div class="opp-list">${rows.map((item, idx) => renderOppRow(item, baseRank + idx)).join("")}</div>`
        : `<div class="empty-state">${safeText(emptyText)}</div>`}
    </section>
  `;
}

function applyFilter() {
    const f = state.opportunityFilter;
    state.filteredOpportunities = state.opportunities.filter(item => f === "all" ? true : item.assetClass === f);
  }

  // =========================
  // navigation
  // =========================
  function navigate(route, symbol = null) {
    state.route = route;
    if (symbol) state.selectedSymbol = symbol;

    if (route === "opportunities") {
      state.error = null;
      state.aiReview = null;
      render();
      loadOpportunities(true);
    } else if (route === "asset-detail" && symbol) {
      state.aiReview = null;
      loadDetail(symbol);
    } else {
      render();
    }
  }

  // =========================
  // render primitives
  // =========================
  function renderSidebar() {
    return `
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="logo-mark">M</div>
          <div class="logo-text">ManiTrade<strong>Pro</strong></div>
        </div>
        <nav class="nav-list">
          ${navItems.map(([route, label, icon]) => `
            <button class="nav-item ${state.route === route ? "active" : ""}" data-route="${route}">
              <span>${icon}</span><span>${label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="sidebar-status"><span class="status-dot"></span><span>Donnees reelles uniquement</span></div>
      </aside>`;
  }

  function renderBottomNav() {
    return `<nav class="bottom-nav"><div class="bottom-wrap">
      ${navItems.map(([route, label, icon]) => `
        <button class="bnav-item ${state.route === route ? "active" : ""}" data-route="${route}">
          <span>${icon}</span><span>${label}</span>
        </button>`).join("")}
    </div></nav>`;
  }

  function renderOppRow(item, rank) {
    const changeClass = item.change24hPct > 0 ? "up" : item.change24hPct < 0 ? "down" : "";
    const scoreValue = typeof item?.score === "number" ? item.score : null;
    const decisionLabel = rowDecisionLabel(item);
    const trendLabel = rowTrendLabel(item);
    const note = item?.reasonShort || item?.error || null;
    const plan = rowTradePlan(item) || {};
    const setupStatus = plan?.setupStatus || item?.setupStatus || null;
    const confirmationText = confirmationLabelText(plan);
    const blockerText = mainBlockerText(plan);
    const priority = priorityLevel(item);
    const actionText = plan?.tradeNow === true ? "actionnable maintenant" : (decisionLabel === "A surveiller" ? "surveillance active" : "");
    const riskText = plan?.riskQuality != null ? `risque ${safeText(simpleRiskQualityLabel(plan.riskQuality))}` : "";
    const top1 = rank === 1 && decisionLabel === "Trade propose";

    return `
      <div class="opp-row ${state.settings.compactCards ? "compact" : ""}" data-symbol="${safeText(item.symbol)}" style="${top1 ? "border:1px solid rgba(94,234,212,.45); box-shadow:0 0 0 1px rgba(94,234,212,.12) inset;" : ""}">
        <div class="opp-rank">#${rank}</div>
        <div class="asset-main">
          <div class="asset-icon">${safeText((item.symbol || "").slice(0, 4))}</div>
          <div class="asset-text">
            <div class="asset-symbol">${safeText(item.symbol)}</div>
            <div class="asset-name">${safeText(item.name || "Nom indisponible")}</div>
            ${setupStatus ? `<div class="muted opp-note">${safeText(setupStatus)}</div>` : ""}
            ${top1 ? `<div class="muted opp-note">meilleure opportunite du moment</div>` : ""}
          </div>
        </div>
        <div class="score-box">
          ${scoreRing(scoreValue)}
          <div class="score-meta">
            ${badge(decisionLabel, decisionLabel)}
            ${badge(trendLabel, item.direction || "")}
            ${setupStatus ? badge(setupStatusLabel(setupStatus), setupStatusBadgeClass(setupStatus)) : ""}
          </div>
        </div>
        <div class="price-col">
          <div class="price">${item.price != null ? priceDisplay(item.price) : "Donnee indisponible"}</div>
          <div class="change ${changeClass}">${pct(item.change24hPct)}</div>
          ${note ? `<div class="muted opp-note">${safeText(note)}</div>` : ""}
          ${actionText ? `<div class="muted opp-note">${safeText(actionText)}</div>` : ""}
          ${(state.settings.showSourceBadges && item.sourceUsed) ? `<div class="muted opp-note">${safeText(item.sourceUsed)} · ${safeText(simpleFreshnessLabel(item.freshness || "unknown"))}</div>` : ""}
        </div>
        <div class="meta-col">
          ${badge(simpleAssetClassLabel(item.assetClass), item.assetClass)}
          ${badge(`fiabilite ${safeText(item.confidenceLabel || simpleConfidenceLabel(item.confidence || "low"))}`)}
          ${badge(safeText(priority))}
          ${plan?.setupType ? badge(safeText(plan.setupType)) : ""}
          ${plan?.confirmationCount != null ? badge(safeText(confirmationText)) : ""}
          ${blockerText ? badge(`blocage ${safeText(blockerText)}`) : ""}
          ${riskText ? badge(riskText) : ""}
        </div>
      </div>`;
  }

function prudentShortlist(limit = 5) {
    return (state.opportunities || [])
      .filter(x => x && x.price != null)
      .map((item) => {
        const pseudoDetail = {
          ...item,
          candles: [],
          breakdown: item.breakdown || {}
        };
        const plan = generateTradePlan(pseudoDetail);
        return { ...item, plan };
      })
      .filter(x => x.plan && (x.plan.decision === "Trade conseille" || x.plan.decision === "Trade possible"))
      .sort((a, b) => {
        const aw = a.plan?.decision === "Trade conseille" ? 2 : 1;
        const bw = b.plan?.decision === "Trade conseille" ? 2 : 1;
        if (bw !== aw) return bw - aw;
        return (b.score || 0) - (a.score || 0);
      })
      .slice(0, limit);
  }

  function algoJournalPreview(limit = 4) {
    return (state.algoJournal || []).slice(0, limit);
  }

  
function dashboardSignalSummary(opps) {
  const rows = Array.isArray(opps) ? opps : [];
  const tradables = rows.filter((x) => x && typeof x.score === "number");
  const bullish = tradables.filter((x) => String(x.direction || "").toLowerCase() === "long").length;
  const bearish = tradables.filter((x) => String(x.direction || "").toLowerCase() === "short").length;
  const neutral = Math.max(0, tradables.length - bullish - bearish);

  let title = "Lecture prudente";
  let text = "Peu de signaux vraiment propres pour le moment.";

  if (bullish >= 3 && bullish > bearish) {
    title = "Biais haussier";
    text = "Les opportunites les plus fortes restent orientees vers la hausse.";
  } else if (bearish >= 3 && bearish > bullish) {
    title = "Biais baissier";
    text = "Les signaux visibles restent plutot orientes vers la baisse.";
  } else if (tradables.length >= 5) {
    title = "Marche partage";
    text = "Le marche envoie des signaux melanges, sans domination nette.";
  }

  return { title, text, bullish, bearish, neutral, tradables: tradables.length };
}

function dashboardTopPick(opps) {
  const rows = Array.isArray(opps) ? opps.filter((x) => typeof x?.score === "number") : [];
  rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return rows[0] || null;
}



  function safeNewsDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    const t = d.getTime();
    if (!Number.isFinite(t)) return "—";
    return d.toLocaleString("fr-FR");
  }

  function newsToneBadgeClass(tone) {
    const t = String(tone || "").toLowerCase();
    if (t.includes("hauss")) return "positive";
    if (t.includes("baiss")) return "negative";
    return "neutral";
  }

  function renderNewsIaBlock() {
    const items = Array.isArray(state.news?.items) ? state.news.items.slice(0, 3) : [];
    const overview = state.news?.overview || {};
    return `
      <div class="card" style="margin-top:18px">
        <div class="section-title"><span>News + IA</span><span>${items.length}</span></div>

        <div class="grid trades-stats" style="margin-bottom:14px">
          <div class="stat-card"><div class="stat-label">Biais news</div><div class="stat-value" style="font-size:1rem">${safeText(overview.marketTone || "mitige")}</div></div>
          <div class="stat-card"><div class="stat-label">Themes</div><div class="stat-value" style="font-size:1rem">${safeText((overview.keyThemes || []).slice(0,2).join(" · ") || "—")}</div></div>
          <div class="stat-card"><div class="stat-label">Actifs a surveiller</div><div class="stat-value" style="font-size:1rem">${safeText((overview.watchAssets || []).slice(0,3).join(" · ") || "—")}</div></div>
          <div class="stat-card"><div class="stat-label">Maj</div><div class="stat-value" style="font-size:1rem">${safeNewsDate(state.news?.asOf)}</div></div>
        </div>

        <div class="card" style="padding:14px;margin-bottom:14px;background:var(--bg-elevated)">
          <div class="muted" style="margin-bottom:6px">Lecture IA</div>
          <div>${safeText(overview.summary || state.news?.message || "Aucune synthese news disponible pour le moment.")}</div>
        </div>

        ${items.length ? `
          <div class="news-list">
            ${items.map((item) => `
              <div class="news-row">
                <div class="news-top">
                  <div class="trade-symbol">${safeText(item.source || "Source")}</div>
                  <div class="legend">
                    ${badge(item.topic || "marche")}
                    ${badge(item.tone || "mitige", newsToneBadgeClass(item.tone))}
                  </div>
                </div>
                <div class="news-title">${safeText(item.title || "Titre indisponible")}</div>
                <div class="news-summary">${safeText(cleanNewsSummary(item))}</div>
                <div class="news-bottom">
                  <div class="muted">${safeText((item.assets || []).join(" · ") || "Aucun actif cible")} · ${safeNewsDate(item.publishedAt)}</div>
                  <div class="legend">
                    <a class="btn" href="${safeText(item.link)}" target="_blank" rel="noreferrer noopener">Ouvrir la source</a>
                    <button class="btn" data-route="news">Voir tout</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="empty-state">Aucune news exploitable pour le moment.</div>`}
      </div>
    `;
  }


  function groupedNewsItems() {
    const items = Array.isArray(state.news?.items) ? state.news.items : [];
    return {
      macro: items.filter((x) => x.topic === "macro"),
      crypto: items.filter((x) => x.topic === "crypto"),
      tech: items.filter((x) => x.topic === "tech"),
      market: items.filter((x) => x.topic === "marche" || !x.topic)
    };
  }

  function cleanNewsSummary(item) {
    const raw = String(item?.summary || "").trim();
    if (!raw) return "Pas de resume.";
    let text = raw
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/www\.\S+/gi, " ")
      .replace(/target=_blank/gi, " ")
      .replace(/font color=.*?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) text = "Pas de resume.";
    if (text.length > 220) text = `${text.slice(0, 217).trim()}...`;
    return text;
  }

  function newsSourceLabel(item) {
    const src = String(item?.source || "").trim();
    if (src) return src;
    try {
      const url = new URL(String(item?.link || ""));
      return url.hostname.replace(/^www\./, "");
    } catch {
      return "Source";
    }
  }

  function renderNewsList(items, limit = 8) {
    const rows = (items || []).slice(0, limit);
    if (!rows.length) return `<div class="empty-state">Aucune news exploitable pour le moment.</div>`;
    return `
      <div class="news-list">
        ${rows.map((item) => `
          <div class="news-row">
            <div class="news-top">
              <div class="trade-symbol">${safeText(newsSourceLabel(item))}</div>
              <div class="legend">
                ${badge(item.topic || "marche")}
                ${badge(item.tone || "mitige", newsToneBadgeClass(item.tone))}
              </div>
            </div>
            <div class="news-title">${safeText(item.title || "Titre indisponible")}</div>
            <div class="news-summary">${safeText(cleanNewsSummary(item))}</div>
            <div class="news-meta">
              <div class="muted">${safeText((item.assets || []).join(" · ") || "Aucun actif cible")}</div>
              <div class="muted">${safeNewsDate(item.publishedAt)}</div>
            </div>
            <div class="news-bottom">
              <div class="muted">${safeText(item.category || "actualite marche")}</div>
              <a class="btn" href="${safeText(item.link)}" target="_blank" rel="noreferrer noopener">Ouvrir la source</a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderNewsPageSection(title, subtitle, items, limit = 6) {
    return `
      <div class="card" style="margin-top:18px">
        <div class="section-title"><span>${title}</span><span>${items.length}</span></div>
        <div class="muted" style="margin-bottom:12px">${subtitle}</div>
        ${renderNewsList(items, limit)}
      </div>
    `;
  }

  function renderNews() {
    const overview = state.news?.overview || {};
    const groups = groupedNewsItems();
    const allItems = Array.isArray(state.news?.items) ? state.news.items : [];

    return `
      <div class="screen">
        <div class="screen-header">
          <div class="screen-title">News + IA</div>
          <div class="screen-subtitle">Lecture contextuelle du marche, themes dominants, actifs a surveiller et articles utiles.</div>
          <div class="muted">${state.news?.asOf ? `Derniere mise a jour : ${safeNewsDate(state.news.asOf)}` : "Pas encore de mise a jour news"}${state.news?.source ? ` · Panel : ${safeText(state.news.source)}` : ""}${(state.news?.overview?.sources || []).length ? ` · Sources visibles : ${safeText(state.news.overview.sources.slice(0,4).join(" · "))}` : ""}</div>
        </div>

        <div class="grid trades-stats">
          <div class="stat-card"><div class="stat-label">Biais news</div><div class="stat-value" style="font-size:1rem">${safeText(overview.marketTone || "mitige")}</div></div>
          <div class="stat-card"><div class="stat-label">Themes dominants</div><div class="stat-value" style="font-size:1rem">${safeText((overview.keyThemes || []).slice(0,3).join(" · ") || "—")}</div></div>
          <div class="stat-card"><div class="stat-label">Actifs a surveiller</div><div class="stat-value" style="font-size:1rem">${safeText((overview.watchAssets || []).slice(0,4).join(" · ") || "—")}</div></div>
          <div class="stat-card"><div class="stat-label">Articles</div><div class="stat-value">${allItems.length}</div></div>
        </div>

        <div class="card" style="margin-top:18px">
          <div class="section-title"><span>Synthese IA</span><span>priorite</span></div>
          <div class="news-summary-grid">
            <div class="news-summary-box">
              <div class="muted" style="margin-bottom:6px">Lecture IA</div>
              <div>${safeText(overview.summary || state.news?.message || "Aucune synthese news disponible pour le moment.")}</div>
            </div>
            <div class="news-summary-box">
              <div class="muted" style="margin-bottom:6px">Focus utile</div>
              <div>${safeText((overview.watchAssets || []).length ? `Surveiller en priorite : ${(overview.watchAssets || []).join(" · ")}.` : "Aucun actif dominant ne ressort pour le moment.")}</div>
            </div>
          </div>
        </div>

        ${renderNewsPageSection("A la une marche", "Ce qui donne la temperature generale du marche.", groups.market, 6)}
        ${renderNewsPageSection("Macro / banques centrales", "Ce qui peut impacter les taux, les indices et le risque global.", groups.macro, 6)}
        ${renderNewsPageSection("Crypto", "Flux crypto utiles pour BTC, ETH et le sentiment speculatif.", groups.crypto, 6)}
        ${renderNewsPageSection("Tech / actions", "News societes et themes croissance / IA / Nasdaq.", groups.tech, 6)}
      </div>
    `;
  }

function renderDashboard() {
    const stats = trainingStats();
    const summary = dashboardSignalSummary(state.opportunities);
    const topPick = dashboardTopPick(state.opportunities);
    const topRows = state.opportunities.slice(0, 5);
    const recentAlgo = state.algoJournal.slice(0, 3);

    return `
      <div class="screen">
        <div class="screen-header">
          <div class="screen-title">Tableau de bord</div>
          <div class="screen-subtitle">Vue rapide, lecture simple, priorites utiles.</div>
        </div>

        <div class="card dashboard-hero-card" style="margin-bottom:18px">
          <div class="dashboard-hero-top">
            <div>
              <div class="dashboard-hero-title">${stats.openCount} position${stats.openCount > 1 ? "s ouvertes" : " ouverte"}</div>
              <div class="dashboard-hero-subtitle">${summary.title} · ${summary.text}</div>
            </div>
            <div class="legend">
              ${badge("Training")}
              ${badge(`${stats.closedCount} trade${stats.closedCount > 1 ? "s" : ""} cloture${stats.closedCount > 1 ? "s" : ""}`)}
              ${badge(`${money(stats.realized * fxRateUsdToEur(), "EUR")} realise`)}
            </div>
          </div>
        </div>

        ${state.opportunitiesRefreshing ? `
          <div class="card" style="margin-bottom:12px;padding:12px 16px">
            <div class="muted">Mise a jour en cours. La derniere liste valide reste affichee.</div>
          </div>
        ` : ""}

        <div class="grid trades-stats" style="margin-bottom:18px">
          <div class="stat-card"><div class="stat-label">Opportunites visibles</div><div class="stat-value">${state.opportunities.length}</div></div>
          <div class="stat-card"><div class="stat-label">Hausse</div><div class="stat-value">${summary.bullish}</div></div>
          <div class="stat-card"><div class="stat-label">Baisse</div><div class="stat-value">${summary.bearish}</div></div>
          <div class="stat-card"><div class="stat-label">Neutre</div><div class="stat-value">${summary.neutral}</div></div>
        </div>

        <div class="dashboard-grid">
          <div class="card">
            <div class="section-title"><span>Meilleure opportunite du moment</span><span>${topPick ? topPick.symbol : "—"}</span></div>
            ${topPick ? `
              <div class="top-pick-box">
                <div>
                  <div class="trade-symbol">${safeText(topPick.symbol)}</div>
                  <div class="trade-sub">${safeText(topPick.name || "Actif")}</div>
                </div>
                <div class="legend">
                  ${badge(rowTradePlan(topPick)?.trendLabel || "analyse en cours")}
                  ${badge(topPick.confidence || "fiabilite")}
                </div>
              </div>
              <div class="kv" style="margin-top:14px">
                <div class="muted">Prix</div><div>${priceDisplay(topPick.price)}</div>
                <div class="muted">Variation 24h</div><div>${pct(topPick.change24hPct)}</div>
                <div class="muted">Tendance</div><div>${safeText(rowTradePlan(topPick)?.trendLabel || "analyse en cours")}</div>
                <div class="muted">Source</div><div>${safeText(topPick.sourceUsed || "—")}</div>
              </div>
              <div class="trade-actions" style="margin-top:14px">
                <button class="btn trade-btn primary" data-open-symbol="${safeText(topPick.symbol)}">Ouvrir la fiche</button>
              </div>
            ` : `<div class="empty-state">Aucune opportunite assez lisible pour le moment.</div>`}
          </div>

          <div class="card">
            <div class="section-title"><span>Dernieres decisions algo</span><span>${recentAlgo.length}</span></div>
            ${recentAlgo.length ? `
              <div class="algo-feed">
                ${recentAlgo.map((row) => `
                  <div class="algo-row full">
                    <div>
                      <div class="trade-symbol">${safeText(row.symbol)}</div>
                      <div class="trade-sub">${safeJournalDate(row.createdAt || row.updatedAt || row.timestamp)}</div>
                    </div>
                    <div>${badge(row.decision || "—", decisionBadgeClass(row.decision || ""))}</div>
                    <div class="muted">${safeText(row.aiSummary || row.reason || "—")}</div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="empty-state">Aucune decision recente pour le moment.</div>`}
          </div>
        </div>

        <div class="card" style="margin-top:18px">
          <div class="section-title"><span>Meilleures opportunites</span><span>${topRows.length}</span></div>
          ${topRows.length ? `<div class="opp-list">${topRows.map((item, idx) => renderOppRow(item, idx + 1)).join("")}</div>` : `<div class="empty-state">Aucune opportunite disponible.</div>`}
        </div>
        ${renderNewsIaBlock()}
        ${state.settings.showAlgoJournal ? renderJournalMoteurCard() : ""}
      </div>`;
  }

  function renderOpportunities() {
    const groups = groupedOpportunities(state.filteredOpportunities || []);
    const total = (state.filteredOpportunities || []).length;
    const visibleHydrating = (state.filteredOpportunities || []).filter((item) => !!state.nonCryptoHydration[String(item?.symbol || "").toUpperCase()]).length;

    return `
      <div class="screen">
        <div class="screen-header">
          <div class="screen-title">Opportunites</div>
          <div class="screen-subtitle">Lecture simple avec statut setup, confirmations, priorite reelle et blocage principal.</div>
        </div>

        <div class="opp-toolbar">
          <div class="filter-group">
            ${["all","crypto","stock","etf","forex","commodity"].map((f) => `
              <button class="chip ${state.opportunityFilter === f ? "active" : ""}" data-filter="${f}">
                ${f === "all" ? "all" : f}
              </button>
            `).join("")}
            <button class="chip" data-refresh="opps">Rafraichir</button>
          </div>
        </div>

        ${state.opportunitiesRefreshing ? `
          <div class="card" style="margin-bottom:12px;padding:12px 16px">
            <div class="muted">Mise a jour en cours. La derniere liste valide reste affichee.</div>
          </div>
        ` : ""}

        <div class="grid trades-stats" style="margin-bottom:18px">
          <div class="stat-card">
            <div class="stat-label">Trades proposes</div>
            <div class="stat-value">${groups.proposed.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">A surveiller</div>
            <div class="stat-value">${groups.watch.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pas de trade</div>
            <div class="stat-value">${groups.noTrade.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Analyses en cours</div>
            <div class="stat-value">${visibleHydrating}</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:18px">
          <div class="section-title"><span>Lecture rapide</span><span>${total}</span></div>
          <div class="opp-overview-text">
            ${groups.proposed.length
              ? `${groups.proposed.length} actif${groups.proposed.length > 1 ? "s" : ""} ressort${groups.proposed.length > 1 ? "ent" : ""} comme prioritaire${groups.proposed.length > 1 ? "s" : ""}.`
              : groups.watch.length
                ? `Aucun trade propose net. ${groups.watch.length} actif${groups.watch.length > 1 ? "s sont" : " est"} surtout a surveiller.`
                : "Aucun trade propre pour le moment. La liste est plutot defensive."}
          </div>
        </div>

        ${renderOpportunitySection(
          "Trades proposes",
          "Actifs a regarder en premier, sans blocage majeur.",
          groups.proposed,
          1,
          "Aucun trade propose pour le moment."
        )}

        ${renderOpportunitySection(
          "A surveiller",
          "Actifs a surveiller avant ouverture, attente d'une meilleure confirmation.",
          groups.watch,
          groups.proposed.length + 1,
          "Aucun actif a surveiller pour le moment."
        )}

        ${renderOpportunitySection(
          "Pas de trade",
          "Actifs non prioritaires ou encore trop faibles.",
          groups.noTrade,
          groups.proposed.length + groups.watch.length + 1,
          "Aucun actif dans cette section."
        )}
      </div>`;
  }

  function renderChart(candles) {
    if (!candles || !candles.length) return `<div class="empty-state">Aucune bougie disponible.</div>`;
    const closes = candles.map(c => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const width = 900, height = 240, pad = 10;
    const pts = closes.map((v, i) => {
      const x = pad + i * ((width - pad * 2) / Math.max(1, closes.length - 1));
      const y = height - pad - ((v - min) / Math.max(1e-9, max - min)) * (height - pad * 2);
      return `${x},${y}`;
    }).join(" ");
    const lineColor = closes[closes.length - 1] >= closes[0] ? "var(--profit)" : "var(--loss)";
    return `
      <div class="chart-wrap">
        <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          <polyline fill="none" stroke="var(--bg-elevated)" stroke-width="1" points="${pad},${pad} ${width - pad},${pad}"/>
          <polyline fill="none" stroke="${lineColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${pts}" />
        </svg>
      </div>`;
  }

  
function simpleReliabilityLabel(score) {
  if (score == null) return "indisponible";
  if (score >= 70) return "elevee";
  if (score >= 55) return "moyenne";
  return "faible";
}

function simpleTrendWord(label) {
  const text = String(label || "").toLowerCase();
  if (text.includes("haussi")) return "hausse";
  if (text.includes("baissi")) return "baisse";
  return "neutre";
}

function simpleDecisionSentence(plan) {
  const decision = String(plan?.decision || "").toLowerCase();
  if (decision.includes("trade propose")) return "Le trade semble assez propre pour etre envisage maintenant.";
  if (decision.includes("surveiller")) return "Le scenario existe, mais il vaut mieux attendre encore.";
  return "Le signal n'est pas assez propre pour prendre position maintenant.";
}

function simpleContextSentence(plan) {
  const trend = simpleTrendWord(plan?.trendLabel || "");
  if (trend === "hausse") return "Le marche montre plutot une hausse.";
  if (trend === "baisse") return "Le marche montre plutot une baisse.";
  return "Le marche n'a pas de direction claire.";
}


function simpleBlockerText(plan) {
  const score = Number(plan?.finalScore ?? 0);
  const trend = simpleTrendWord(plan?.trendLabel || "");
  if (String(plan?.decision || "") === "Trade propose") return "Rien de bloquant pour le moment.";
  if (score < 40) return "Le signal est trop faible pour prendre position.";
  if (trend === "hausse" || trend === "baisse") return "La tendance existe, mais l'entree n'est pas assez propre.";
  return "Le marche reste trop flou pour proposer un trade.";
}

function actionNowLabel(plan) {
  const decision = String(plan?.decision || "");
  if (decision === "Trade propose") return "Ouvrir le trade";
  if (decision === "A surveiller" && String(plan?.waitFor || "").includes("meilleur point d'entree")) return "Attendre un meilleur point d'entree";
  if (decision === "A surveiller") return "Surveiller";
  return "Ne rien faire";
}

function simpleDecisionTitle(plan) {
  const decision = String(plan?.decision || "");
  if (decision === "Trade propose") return "Trade propose";
  if (decision === "A surveiller") return "A surveiller";
  return "Pas de trade";
}


function simpleTimingLabel(plan) {
  const timing = String(plan?.timing || "").toLowerCase();
  if (timing === "bon") return "bon";
  if (timing === "moyen" || timing === "correct") return "moyen";
  if (timing === "mauvais" || timing === "faible") return "mauvais";
  return "a confirmer";
}

function simpleTrendStrengthLabel(detail) {
  const value = Number(detail?.breakdown?.trend ?? 0);
  if (value >= 70) return "forte";
  if (value >= 55) return "moyenne";
  return "faible";
}

function simpleWaitForText(plan) {
  const wait = String(plan?.waitFor || "");
  if (!wait) return "rien de special";
  if (wait.includes("meilleur point d'entree")) return "un meilleur point d'entree";
  if (wait.includes("confirmation")) return "une confirmation plus nette";
  if (wait.includes("risque")) return "moins de risque";
  if (wait.includes("ratio")) return "un meilleur ratio";
  if (wait.includes("signal")) return "un signal plus clair";
  return wait;
}


function computeOfficialPlan(detail) { return detail ? generateTradePlan(detail) : null; }

function applyOfficialPlanToRow(item) { return item; }

function findOfficialOpportunity(symbol) {
  const clean = String(symbol || "").toUpperCase();
  if (!clean) return null;
  const rows = Array.isArray(state.opportunities) ? state.opportunities : [];
  const snap = Array.isArray(state.opportunitiesSnapshot) ? state.opportunitiesSnapshot : [];
  return rows.find((x) => String(x?.symbol || "").toUpperCase() === clean) ||
         snap.find((x) => String(x?.symbol || "").toUpperCase() === clean) ||
         null;
}

function lockDetailToOfficialRow(detail) {
  if (!detail) return detail;
  const row = findOfficialOpportunity(detail.symbol);
  if (!row) return detail;
  return {
    ...detail,
    officialScore: row.officialScore ?? detail.officialScore ?? null,
    officialDecision: row.officialDecision || detail.officialDecision || null,
    officialTrendLabel: row.officialTrendLabel || detail.officialTrendLabel || null,
    officialWaitFor: row.officialWaitFor || detail.officialWaitFor || null
  };
}


function strictDisplayScore(detail) {
  if (!detail) return null;
  const locked = lockDetailToOfficialRow(detail);
  if (locked?.officialScore != null && !Number.isNaN(Number(locked.officialScore))) return Number(locked.officialScore);
  if (locked?.score != null && !Number.isNaN(Number(locked.score))) return Number(locked.score);
  return null;
}

function officialPlanForDetail(detail) {
  const locked = lockDetailToOfficialRow(detail);
  const plan = computeOfficialPlan(locked);
  if (!plan) return plan;

  const displayScore = strictDisplayScore(locked);
  if (displayScore != null) {
    plan.finalScore = displayScore;
  }

  if (locked?.officialDecision) plan.decision = locked.officialDecision;
  if (locked?.officialTrendLabel) plan.trendLabel = locked.officialTrendLabel;
  if (locked?.officialWaitFor) plan.waitFor = locked.officialWaitFor;

  return plan;
}

function renderDetail() {
    const d = state.detail;
    return `
      <div class="screen">
        <div class="section-title"><button class="btn" data-route="opportunities">← Retour</button><span>Fiche actif</span></div>
        ${state.loadingDetail ? `<div class="loading-state">Chargement du detail...</div>` : ""}
        ${state.error ? `<div class="error-box">${safeText(state.error)}</div>` : ""}
        ${d ? `<div class="countdown-item">
                <span class="countdown-dot"></span>
                <span class="countdown-label">Bougies</span>
                <strong>${isCryptoSymbol(d.symbol) ? "recentes" : countdownOnlyLabel("candles_non_crypto", d.symbol)}</strong>
              </div>
            </div>
          <div class="detail-layout">
            <div>
              <div class="card" style="margin-bottom:18px">
                <div class="detail-head">
                  <div class="detail-title-wrap">
                    <div class="detail-icon">${safeText((d.symbol || "").slice(0, 4))}</div>
                    <div>
                      <div class="detail-title">${safeText(d.symbol)}</div>
                      <div class="detail-sub">${safeText(d.name || "")}</div>
                    </div>
                  </div>
                  <div>
                    <div class="detail-price">${d.price != null ? priceDisplay(d.price) : "Donnee indisponible"}</div>
                    <div class="change ${d.change24hPct > 0 ? 'up' : d.change24hPct < 0 ? 'down' : ''}" style="text-align:right">${pct(d.change24hPct)}</div>
                  </div>
                </div>
                <div class="legend">
                  ${badge(simpleAssetClassLabel(d.assetClass), d.assetClass)}
                  ${badge(d.trendLabel || simpleDirectionLabel(d.direction, d.score), d.direction || "")}
                  ${badge(simpleScoreStatusLabel(d.scoreStatus || "n/a"), d.scoreStatus || "")}
                  ${badge(`fiabilite ${safeText(d.confidenceLabel || simpleConfidenceLabel(d.confidence || "low"))}`)}
                  ${state.settings.showSourceBadges ? badge(d.sourceUsed || "source?") : ""}
                  ${state.settings.showSourceBadges ? badge(simpleFreshnessLabel(d.freshness || "unknown"), d.freshness || "") : ""}
                </div>
                ${(() => {
                  const plan = currentTradePlan();
                  return `
                    <div class="plan-card">
                      <div class="section-title"><span>Decision automatique</span><span>${safeText(plan?.decision || "—")}</span></div>
                      <div class="kv plan-grid">
                        <div class="muted">Decision simple</div><div>${safeText(plan?.decision || "Pas de trade")}</div>
                        <div class="muted">Tendance</div><div>${safeText(plan?.trendLabel || d.trendLabel || detectedTrendLabel(d.direction || "neutral"))}</div>
                        <div class="muted">Entree</div><div>${plan?.entry != null ? priceDisplay(plan.entry) : "—"}</div>
                        <div class="muted">Stop</div><div>${plan?.stopLoss != null ? priceDisplay(plan.stopLoss) : "—"}</div>
                        <div class="muted">Objectif</div><div>${plan?.takeProfit != null ? priceDisplay(plan.takeProfit) : "—"}</div>
                        <div class="muted">Ratio</div><div>${plan?.rr != null ? num(plan.rr, 2) : "—"}</div>
                        <div class="muted">Niveau de fiabilite</div><div>${plan?.finalScore != null ? `${num(plan.finalScore, 0)}/100 · ${safeText(simpleReliabilityLabel(plan.finalScore))}` : "—"}</div>
                        <div class="muted">Horizon</div><div>${safeText(plan?.horizon || "—")}</div>
                        <div class="muted">En clair</div><div>${safeText(simpleDecisionSentence(plan))}</div>
                        <div class="muted">Resume simple</div><div>${safeText(simpleContextSentence(plan))} ${safeText(plan?.aiSummary || "")}</div>
                      </div>
                      <div class="plan-reason">${safeText(plan?.reason || plan?.refusalReason || "Pas d'analyse disponible.")}</div>
                      <div class="plan-ai-summary">
                        <div class="muted">Resume court</div>
                        <div>${safeText(plan?.aiSummary || "Pas d'avis complementaire.")}</div>
                      </div>
                      <div class="plan-context">
                        ${(plan?.aiContext || []).map(label => `<span class="mini-pill">${safeText(label)}</span>`).join("")}
                        ${plan?.safety ? `<span class="mini-pill strong">niveau : ${safeText(plan.safety)}</span>` : ""}
                      </div>
                      <div class="trade-actions">
                        ${plan && plan.decision === "Trade propose" && plan.side ? `<button class="btn trade-btn primary" data-create-trade-plan>Ouvrir le trade propose</button>` : ""}
                      </div>
                    </div>`;
                })()}
              </div>

              <div class="card" style="margin-bottom:18px">
                <div class="section-title"><span>Lecture complementaire</span><span>${state.loadingAiReview ? "analyse..." : (state.aiReview?.externalAiUsed ? "Claude" : "fallback local")}</span></div>
                ${state.loadingAiReview ? `<div class="loading-state">Analyse IA en cours...</div>` : state.aiReview ? `
                  <div class="ai-review-box">
                    <div class="legend">
                      ${badge(state.aiReview.decision || "—", decisionBadgeClass(state.aiReview.decision || ""))}
                      ${badge(`prudence ${state.aiReview.prudence || "—"}`)}
                      ${badge(state.aiReview.externalAiUsed ? "IA externe" : "lecture locale")}
                    </div>
                    <div class="ai-summary">${safeText(state.aiReview.summary || state.aiReview.reason || "—")}</div>
                    <div class="kv" style="margin-top:12px">
                      <div class="muted">Pourquoi</div><div>${safeText(state.aiReview.reason || "—")}</div>
                      <div class="muted">Ce qui bloque</div><div>${safeText(state.aiReview.invalidation || "—")}</div>
                      <div class="muted">Source</div><div>${safeText(state.aiReview.provider || "—")}</div>
                    </div>
                    ${state.aiReview.warning ? `<div class="muted" style="margin-top:10px">${safeText(state.aiReview.warning)}</div>` : ""}
                  </div>
                ` : `<div class="empty-state">Aucune validation IA disponible pour le moment.</div>`}
              </div>

              <div class="card" style="margin-bottom:18px">
                <div class="section-title"><span>News liees a l'actif</span><span>${relatedNewsForSymbol(d.symbol, d.name).length}</span></div>
                ${relatedNewsForSymbol(d.symbol, d.name).length ? `
                  <div class="news-list">
                    ${relatedNewsForSymbol(d.symbol, d.name).map((item) => `
                      <article class="news-card compact">
                        <div class="news-source-row">
                          <strong>${safeText(item.source || "source")}</strong>
                          <span class="muted">${safeText(item.topic || "news")}</span>
                        </div>
                        <div class="news-title">${safeText(item.title || "Titre indisponible")}</div>
                        <div class="muted">${safeText(item.summary || "Resume indisponible")}</div>
                        <div class="trade-actions" style="margin-top:10px">
                          ${item.link ? `<a class="btn" href="${safeText(item.link)}" target="_blank" rel="noopener noreferrer">Ouvrir la source</a>` : ""}
                        </div>
                      </article>
                    `).join("")}
                  </div>
                ` : `<div class="empty-state">Aucune news directement reliee a cet actif pour le moment.</div>`}
              </div>

              <div class="card">
                <div class="section-title"><span>Evolution recente</span><span>${Array.isArray(d.candles) && d.candles.length ? `${d.candles.length} bougies` : "historique recent"}</span></div>
                ${renderChart(d.candles)}
              </div>
            </div>

            <div>
              <div class="card conclusion-card" style="margin-bottom:18px">
                <div class="section-title"><span>Conclusion</span><span>${strictDisplayScore(state.detail) != null ? strictDisplayScore(state.detail) : (currentTradePlan()?.finalScore != null ? currentTradePlan().finalScore : "—")}/100</span></div>
                <div class="conclusion-top">
                  <div class="conclusion-main">
                    <div class="conclusion-decision">${safeText(simpleDecisionTitle(currentTradePlan()))}</div>
                    <div class="conclusion-line">Fiabilite du trade : <strong>${safeText(simpleReliabilityLabel(currentTradePlan()?.finalScore))}</strong></div>
                    <div class="conclusion-line">Tendance : <strong>${safeText(currentTradePlan()?.trendLabel || d.trendLabel || detectedTrendLabel(d.direction || "neutral"))}</strong></div>
                    <div class="conclusion-line">Force de la tendance : <strong>${safeText(simpleTrendStrengthLabel(d))}</strong></div>
                    <div class="conclusion-line">Timing d'entree : <strong>${safeText(simpleTimingLabel(currentTradePlan()))}</strong></div>
                    <div class="conclusion-line">A faire maintenant : <strong>${safeText(actionNowLabel(currentTradePlan()))}</strong></div>
                  </div>
                  <div class="conclusion-score">
                    ${scoreRing(currentTradePlan()?.finalScore ?? d.score)}
                  </div>
                </div>
                <div class="conclusion-text">
                  <div class="muted">Pourquoi</div>
                  <div>${safeText(simpleDecisionSentence(currentTradePlan()))}</div>
                </div>
                <div class="conclusion-text">
                  <div class="muted">Ce qui bloque</div>
                  <div>${safeText(simpleBlockerText(currentTradePlan()))}</div>
                </div>
                <div class="conclusion-text">
                  <div class="muted">Ce qu'il faut attendre</div>
                  <div>${safeText(simpleWaitForText(currentTradePlan()))}</div>
                </div>
                ${state.settings.showScoreBreakdown ? `
                  <div class="breakdown" style="margin-top:14px">
                    <div class="break-item"><div class="break-name">Contexte</div><div class="break-value">${safeText(simpleReliabilityLabel(d.breakdown?.regime))}</div></div>
                    <div class="break-item"><div class="break-name">Tendance</div><div class="break-value">${safeText(simpleReliabilityLabel(d.breakdown?.trend))}</div></div>
                    <div class="break-item"><div class="break-name">Elan</div><div class="break-value">${safeText(simpleReliabilityLabel(d.breakdown?.momentum))}</div></div>
                    <div class="break-item"><div class="break-name">Entree</div><div class="break-value">${safeText(simpleReliabilityLabel(d.breakdown?.entryQuality))}</div></div>
                    <div class="break-item"><div class="break-name">Risque</div><div class="break-value">${safeText(simpleReliabilityLabel(d.breakdown?.risk))}</div></div>
                    <div class="break-item"><div class="break-name">Activite</div><div class="break-value">${safeText(simpleReliabilityLabel(d.breakdown?.participation))}</div></div>
                  </div>` : `<div class="muted">Le detail du signal est masque dans les reglages.</div>`
                }
              </div>

              <div class="card">
                <div class="section-title"><span>Informations utiles</span></div>
                <div class="kv">
                  <div class="muted">Source</div><div>${safeText(d.sourceUsed || "—")}</div>
                  <div class="muted">Mise a jour</div><div>${safeText(simpleFreshnessLabel(d.freshness || "unknown"))}</div>
                  <div class="muted">Variation 24h</div><div>${pct(d.change24hPct)}</div>
                  <div class="muted">Type</div><div>${safeText(simpleAssetClassLabel(d.assetClass || "—"))}</div>
                </div>
              </div>
            </div>
          </div>
        ` : (!state.loadingDetail ? `<div class="empty-state">Aucun detail charge.</div>` : "")}
      </div>`;
  }

function tradeStatusMeta(position) {
  const p = normalizePositionRecord(position);
  const snap = p.analysisSnapshot || {};
  const exec = p.execution || {};
  const live = p.live || {};
  const opp = Array.isArray(state.opportunities) ? state.opportunities.find((o) => o.symbol === p.symbol) : null;
  const entryPrice = Number(exec.entryPrice ?? snap.entry ?? p.entryPrice);
  const stopLoss = Number(snap.stopLoss ?? p.stopLoss);
  const takeProfit = Number(snap.takeProfit ?? p.takeProfit);
  const livePrice = Number(opp?.price ?? live?.price ?? entryPrice);

  const validEntry = Number.isFinite(entryPrice) && entryPrice > 0;
  const validLive = Number.isFinite(livePrice) && livePrice > 0;
  const validStop = Number.isFinite(stopLoss) && stopLoss > 0;
  const validTarget = Number.isFinite(takeProfit) && takeProfit > 0;

  const pnlPctLive = (!validLive || !validEntry) ? null :
    (p.side === "short"
      ? ((entryPrice - livePrice) / entryPrice) * 100
      : ((livePrice - entryPrice) / entryPrice) * 100);

  let label = "stable";
  let text = "Trade en attente";
  let badgeClass = "neutral";

  if (pnlPctLive != null && pnlPctLive >= 2) {
    label = "gain";
    text = "Trade en gain";
    badgeClass = "positive";
  } else if (pnlPctLive != null && pnlPctLive <= -1.5) {
    label = "pressure";
    text = "Sous pression";
    badgeClass = "negative";
  }

  let stopDistancePct = null;
  if (validStop && validLive) {
    stopDistancePct = p.side === "short"
      ? ((stopLoss - livePrice) / livePrice) * 100
      : ((livePrice - stopLoss) / livePrice) * 100;
    if (stopDistancePct <= 1.2) {
      label = "near_stop";
      text = "Proche du stop";
      badgeClass = "negative";
    }
  }

  let targetDistancePct = null;
  if (validTarget && validLive) {
    targetDistancePct = p.side === "short"
      ? ((livePrice - takeProfit) / livePrice) * 100
      : ((takeProfit - livePrice) / livePrice) * 100;
    if (targetDistancePct <= 1.5 && targetDistancePct >= -1) {
      label = "near_target";
      text = "Proche de l'objectif";
      badgeClass = "positive";
    }
  }

  return {
    livePrice: validLive ? livePrice : null,
    pnlPctLive,
    stopDistancePct,
    targetDistancePct,
    label,
    text,
    badgeClass
  };
}

function partialClosePosition(positionId, percent = 50) {
  const idx = state.trades.positions.findIndex((p) => p.id === positionId);
  if (idx === -1) return;
  const position = normalizePositionRecord(state.trades.positions[idx]);
  const meta = tradeStatusMeta(position);
  const fallbackEntry = Number(position?.execution?.entryPrice ?? position?.entryPrice);
  const resolvedLivePrice = Number(meta.livePrice ?? position?.live?.price ?? fallbackEntry);
  const livePrice = (Number.isFinite(resolvedLivePrice) && resolvedLivePrice > 0) ? resolvedLivePrice : fallbackEntry;
  if (!(Number.isFinite(livePrice) && livePrice > 0)) {
    state.error = "Impossible de cloturer partiellement : prix de sortie invalide.";
    render();
    return;
  }

  const ratio = Math.max(0.1, Math.min(1, percent / 100));
  const closeQty = Number(position.quantity || 0) * ratio;
  if (!Number.isFinite(closeQty) || closeQty <= 0) return;

  const remainingQty = Number(position.quantity || 0) - closeQty;
  const pnl = position.side === "long"
    ? (livePrice - position.entryPrice) * closeQty
    : (position.entryPrice - livePrice) * closeQty;
  const pnlPct = position.entryPrice ? ((pnl / (position.entryPrice * closeQty)) * 100) : null;
  const closedAt = new Date().toISOString();

  state.trades.history.unshift(normalizePositionRecord({
    id: `${position.id}:partial:${Date.now()}`,
    symbol: position.symbol,
    name: position.name,
    side: position.side,
    quantity: closeQty,
    entryPrice: position.entryPrice,
    invested: Number.isFinite(Number(position.entryPrice)) ? position.entryPrice * closeQty : null,
    exitPrice: livePrice,
    pnl,
    pnlPct,
    closedAt,
    sourceUsed: position.sourceUsed || "training",
    closeType: `Cloture partielle ${percent}%`,
    analysisSnapshot: position.analysisSnapshot,
    execution: {
      openedAt: position.execution?.openedAt || position.openedAt || null,
      entryPrice: position.entryPrice,
      quantity: closeQty,
      invested: Number.isFinite(Number(position.entryPrice)) ? position.entryPrice * closeQty : null
    },
    closedExecution: {
      exitPrice: livePrice,
      closedAt,
      closeType: `Cloture partielle ${percent}%`
    }
  }));

  if (remainingQty <= 0.0000001) {
    state.trades.positions.splice(idx, 1);
  } else {
    state.trades.positions[idx] = normalizePositionRecord({
      ...position,
      quantity: remainingQty,
      invested: Number.isFinite(Number(position.entryPrice)) ? position.entryPrice * remainingQty : null,
      execution: {
        ...(position.execution || {}),
        entryPrice: position.entryPrice,
        quantity: remainingQty,
        invested: Number.isFinite(Number(position.entryPrice)) ? position.entryPrice * remainingQty : null
      },
      partialClosedAt: closedAt
    });
  }

  state.error = null;
  persistTradesState();
  render();
}

function closeTradePosition(positionId) {
  const idx = state.trades.positions.findIndex((p) => p.id === positionId);
  if (idx === -1) return;
  const position = normalizePositionRecord(state.trades.positions[idx]);
  const meta = tradeStatusMeta(position);
  const fallbackEntry = Number(position?.execution?.entryPrice ?? position?.entryPrice);
  const resolvedLivePrice = Number(meta.livePrice ?? position?.live?.price ?? fallbackEntry);
  const livePrice = (Number.isFinite(resolvedLivePrice) && resolvedLivePrice > 0) ? resolvedLivePrice : fallbackEntry;
  if (!(Number.isFinite(livePrice) && livePrice > 0)) {
    state.error = "Impossible de cloturer ce trade : prix de sortie invalide.";
    render();
    return;
  }

  const pnl = position.side === "long"
    ? (livePrice - position.entryPrice) * position.quantity
    : (position.entryPrice - livePrice) * position.quantity;
  const pnlPct = position.entryPrice ? ((pnl / (position.entryPrice * position.quantity)) * 100) : null;
  const closedAt = new Date().toISOString();

  state.trades.history.unshift(normalizePositionRecord({
    id: `${position.id}:full:${Date.now()}`,
    symbol: position.symbol,
    name: position.name,
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    invested: Number.isFinite(Number(position.entryPrice)) ? position.entryPrice * position.quantity : null,
    exitPrice: livePrice,
    pnl,
    pnlPct,
    closedAt,
    sourceUsed: position.sourceUsed || "training",
    closeType: "Cloture manuelle",
    analysisSnapshot: position.analysisSnapshot,
    execution: {
      openedAt: position.execution?.openedAt || position.openedAt || null,
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      invested: Number.isFinite(Number(position.entryPrice)) ? position.entryPrice * position.quantity : null
    },
    closedExecution: {
      exitPrice: livePrice,
      closedAt,
      closeType: "Cloture manuelle"
    }
  }));

  state.trades.positions.splice(idx, 1);
  state.error = null;
  persistTradesState();
  render();
}


function tradeHealthLabel(meta) {
  if (!meta) return "en attente";
  if (meta.label === "gain" || meta.label === "near_target") return "ca se passe bien";
  if (meta.label === "pressure" || meta.label === "near_stop") return "a surveiller";
  return "en attente";
}

function actionTradeSummary(meta) {
  if (!meta) return "Attendre.";
  if (meta.label === "near_stop") return "Proche du stop, a surveiller de pres.";
  if (meta.label === "near_target") return "Proche de l'objectif.";
  if (meta.label === "gain") return "Le trade est en gain.";
  if (meta.label === "pressure") return "Le trade est sous pression.";
  return "Le trade evolue sans signal fort.";
}

function tradePnlText(meta) {
  if (!meta || meta.pnlPctLive == null) return "P/L live indisponible";
  return `P/L live ${pct(meta.pnlPctLive)}`;
}

function historyResultLabel(item) {
  const pnl = Number(item?.pnl || 0);
  if (pnl > 0) return "gain";
  if (pnl < 0) return "perte";
  return "neutre";
}

function renderPositionRow(position) {
  const p = normalizePositionRecord(position);
  const meta = tradeStatusMeta(p);
  const snap = p.analysisSnapshot || {};
  const exec = p.execution || {};
  const live = p.live || {};
  const lastLive = live?.updatedAt ? new Date(live.updatedAt).toLocaleString("fr-FR") : "—";

  return `<div class="trade-row trade-card-row simple-trade-card">
    <div class="trade-card-top">
      <div>
        <div class="trade-symbol">${safeText(p.symbol)}</div>
        <div class="trade-sub">${safeText(snap.decision || p.tradeDecision || "Trade ouvert")}</div>
      </div>
      <div class="trade-card-badges">
        ${badge(simpleSideLabel(p.side), p.side)}
        ${badge(snap.trendLabel || p.trendLabel || "tendance", "neutral")}
        ${badge(tradeOperationalLabel(meta), meta.badgeClass)}
      </div>
    </div>

    <div class="trade-summary-line">${safeText(actionTradeSummary(meta))}</div>

    <div class="muted" style="margin:10px 0 6px">Snapshot d'ouverture</div>
    <div class="trade-plan-grid compact">
      <div><span class="muted">Score d'entree</span><br>${displayScoreValue(p) == null ? "—" : `${num(displayScoreValue(p), 0)}/100`}</div>
      <div><span class="muted">Decision</span><br>${safeText(snap.decision || p.tradeDecision || "—")}</div>
      <div><span class="muted">Tendance</span><br>${safeText(snap.trendLabel || p.trendLabel || "—")}</div>
      <div><span class="muted">Horizon</span><br>${safeText(snap.horizon || p.horizon || "—")}</div>
      <div><span class="muted">Entree</span><br>${Number.isFinite(Number(exec.entryPrice ?? snap.entry ?? p.entryPrice)) ? priceDisplay(exec.entryPrice ?? snap.entry ?? p.entryPrice) : "—"}</div>
      <div><span class="muted">Stop</span><br>${(Number(snap.stopLoss ?? p.stopLoss) > 0) ? priceDisplay(snap.stopLoss ?? p.stopLoss) : "—"}</div>
      <div><span class="muted">Objectif</span><br>${(Number(snap.takeProfit ?? p.takeProfit) > 0) ? priceDisplay(snap.takeProfit ?? p.takeProfit) : "—"}</div>
      <div><span class="muted">Ratio</span><br>${displayRatioValue(p) == null ? "—" : num(displayRatioValue(p), 2)}</div>
    </div>

    <div class="muted" style="margin:14px 0 6px">Etat live</div>
    <div class="trade-plan-grid compact">
      <div><span class="muted">Prix actuel</span><br>${meta.livePrice == null ? "—" : priceDisplay(meta.livePrice)}</div>
      <div><span class="muted">P/L live</span><br>${p.live?.pnl != null && p.live?.pnlPct != null ? `${money(p.live.pnl * fxRateUsdToEur(), "EUR")} · ${pct(p.live.pnlPct)}` : safeText(tradePnlText(meta))}</div>
      <div><span class="muted">Avant stop</span><br>${meta.stopDistancePct == null ? "—" : `${num(meta.stopDistancePct, 2)}%`}</div>
      <div><span class="muted">Avant objectif</span><br>${meta.targetDistancePct == null ? "—" : `${num(meta.targetDistancePct, 2)}%`}</div>
      <div><span class="muted">Maj live</span><br>${safeText(lastLive)}</div>
      <div><span class="muted">Source</span><br>${safeText(snap.sourceUsed || p.sourceUsed || "—")}</div>
      <div><span class="muted">Quantite</span><br>${exec.quantity == null ? "—" : num(exec.quantity, 4)}</div>
      <div><span class="muted">Investi</span><br>${displayInvestedValue(p) == null ? "—" : money(displayInvestedValue(p) * fxRateUsdToEur(), "EUR")}</div>
    </div>

    <div class="muted" style="margin:14px 0 6px">Statut operationnel</div>
    <div class="trade-plan-grid compact">
      <div><span class="muted">Etat</span><br>${safeText(tradeOperationalLabel(meta))}</div>
      <div><span class="muted">Resume</span><br>${safeText(actionTradeSummary(meta))}</div>
      <div style="grid-column: span 2"><span class="muted">Pourquoi</span><br>${safeText(snap.reason || p.tradeReason || "Pas de commentaire pour le moment.")}</div>
    </div>

    <div class="trade-actions split">
      <button class="btn trade-btn secondary" data-close-half="${safeText(p.id)}">Cloturer 50%</button>
      <button class="btn trade-btn primary" data-close-trade="${safeText(p.id)}">Cloturer</button>
    </div>
  </div>`;
}

function displayHistoryEntryPrice(position) {
    const p = normalizePositionRecord(position);
    const value = Number(p?.execution?.entryPrice ?? p?.analysisSnapshot?.entry ?? p?.entryPrice);
    return Number.isFinite(value) ? value : null;
  }

  function displayHistoryExitPrice(position) {
    const p = normalizePositionRecord(position);
    const value = Number(p?.closedExecution?.exitPrice ?? p?.exitPrice ?? p?.live?.price);
    return Number.isFinite(value) ? value : null;
  }

  function displayHistoryClosedAt(position) {
    const p = normalizePositionRecord(position);
    return p?.closedExecution?.closedAt || p?.closedAt || null;
  }

  function displayHistorySourceOrClosure(position){
    const p = normalizePositionRecord(position);
    const raw = p?.closedExecution?.closeType || p?.closeType || p?.sourceUsed || p?.analysisSnapshot?.sourceUsed || "training";
    const text = String(raw || "").trim().toLowerCase();
    if (!text || text === "training") return "cloture legacy";
    if (text === "manual" || text === "manuel" || text === "manual_close") return "cloture manuelle";
    if (text === "stop" || text === "stoploss" || text === "stop_loss") return "stop touche";
    if (text === "target" || text === "takeprofit" || text === "take_profit") return "objectif touche";
    return raw;
  }

function renderHistoryRow(item) {
    const p = normalizePositionRecord(item);
    const scoreValue = displayScoreValue(p);
    const entryPrice = displayHistoryEntryPrice(p);
    const exitPrice = displayHistoryExitPrice(p);
    const closedAt = displayHistoryClosedAt(p);
    const pnl = Number(p?.pnl || 0);
    const pnlPctValue = Number.isFinite(Number(p?.pnlPct)) ? Number(p.pnlPct) : null;
    return `
      <div class="trade-row history simple-history-row">
        <div>
          <div class="trade-symbol">${safeText(p.symbol)}</div>
          <div class="trade-sub">${validTradeDate(closedAt) ? new Date(closedAt).toLocaleString("fr-FR") : "date indisponible"}</div>
        </div>
        <div>${badge(simpleSideLabel(p.side), p.side)}</div>
        <div>${badge(historyResultLabel(p), (pnl >= 0 ? "positive" : "negative"))}</div>
        <div>${entryPrice == null ? "—" : priceDisplay(entryPrice)}</div>
        <div>${exitPrice == null ? "—" : priceDisplay(exitPrice)}</div>
        <div class="${pnl >= 0 ? 'positive' : 'negative'}">${money(pnl * fxRateUsdToEur(), "EUR")} · ${pnlPctValue == null ? "—" : pct(pnlPctValue)}</div>
        <div>${safeText(scoreValue == null ? "—" : `${num(scoreValue, 0)}/100`)}</div>
        <div>${safeText(displayHistorySourceOrClosure(p))}</div>
      </div>`;
  }

  function algoDecisionCounts() {
    const rows = Array.isArray(state.algoJournal) ? state.algoJournal : [];
    const out = { total: rows.length, conseille: 0, possible: 0, surveiller: 0, eviter: 0, aucun: 0, manuel: 0 };
    for (const row of rows) {
      const d = String(row?.decision || "").toLowerCase();
      if (d.includes("trade conseille")) out.conseille += 1;
      else if (d.includes("trade possible")) out.possible += 1;
      else if (d.includes("surveiller")) out.surveiller += 1;
      else if (d.includes("eviter")) out.eviter += 1;
      else if (d.includes("aucun")) out.aucun += 1;
      else if (d.includes("manuel")) out.manuel += 1;
    }
    return out;
  }

  function moteurDecisionLabel(row) {
    const raw = String(row?.decision || row?.analysisLabel || "").toLowerCase();
    if (raw.includes("propose") || raw.includes("conseille")) return "Trade propose";
    if (raw.includes("possible")) return "Trade possible";
    if (raw.includes("surveiller")) return "A surveiller";
    if (raw.includes("eviter")) return "A eviter";
    if (raw.includes("aucun") || raw.includes("pas de trade")) return "Pas de trade";
    return row?.decision || "Decision inconnue";
  }

  function safeJournalDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time)) return "—";
    return date.toLocaleString("fr-FR");
  }

  function journalMoteurRows(limit = 10) {
    const rows = Array.isArray(state.algoJournal) ? state.algoJournal.slice() : [];
    return rows
      .map((row, index) => ({
        ...row,
        _symbol: String(row?.symbol || "").toUpperCase(),
        _decision: moteurDecisionLabel(row),
        _score: Number.isFinite(Number(row?.score)) ? Number(row.score) : null,
        _time: row?.updatedAt || row?.createdAt || row?.timestamp || null,
        _idx: index
      }))
      .filter((row) => row._symbol)
      .sort((a, b) => {
        const ta = a._time ? new Date(a._time).getTime() : 0;
        const tb = b._time ? new Date(b._time).getTime() : 0;
        return tb - ta;
      })
      .slice(0, limit);
  }

  function updateJournalMoteurFromOpportunity(item) {
    if (!item || !item.symbol) return;
    const symbol = String(item.symbol || "").toUpperCase();
    const rows = Array.isArray(state.algoJournal) ? state.algoJournal.slice() : [];
    const next = {
      id: `journal:${symbol}`,
      symbol,
      name: item.name || symbol,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      decision: item.decision || item.analysisLabel || null,
      confidence: item.confidence || null,
      confidenceLabel: item.confidenceLabel || null,
      trendLabel: item.trendLabel || null,
      reasonShort: item.reasonShort || null,
      sourceUsed: item.sourceUsed || null,
      updatedAt: new Date().toISOString()
    };
    const idx = rows.findIndex((row) => String(row?.symbol || "").toUpperCase() === symbol);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...next };
    else rows.unshift(next);
    state.algoJournal = rows.slice(0, 200);
    persistTradesState();
  }

  function renderJournalMoteurCard() {
    const rows = journalMoteurRows(8);
    return `
      <div class="card" style="margin-top:18px">
        <div class="section-title"><span>Journal moteur</span><span>${rows.length}</span></div>
        ${rows.length ? `
          <div class="trade-table simplified-history">
            <div class="trade-row trade-head">
              <div>Actif</div><div>Decision</div><div>Score</div><div>Confiance</div><div>Tendance</div><div>Source</div><div>Maj</div>
            </div>
            ${rows.map((row) => `
              <div class="trade-row history simple-history-row">
                <div>
                  <div class="trade-symbol">${safeText(row._symbol)}</div>
                  <div class="trade-sub">${safeText(row.name || row._symbol)}</div>
                </div>
                <div>${badge(row._decision, row._decision === "Trade propose" ? "positive" : row._decision === "Pas de trade" ? "negative" : "neutral")}</div>
                <div>${row._score == null ? "—" : `${num(row._score, 0)}/100`}</div>
                <div>${safeText(row.confidenceLabel || row.confidence || "—")}</div>
                <div>${safeText(row.trendLabel || "—")}</div>
                <div>${safeText(row.sourceUsed || "—")}</div>
                <div>${safeJournalDate(row._time)}</div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="empty-state">Le journal moteur se remplira au fur et a mesure des analyses.</div>`}
      </div>
    `;
  }

  function groupedHistoryInsights() {
    const history = Array.isArray(state.trades?.history) ? state.trades.history : [];
    const bySymbol = {};
    for (const row of history) {
      const key = String(row?.symbol || "").toUpperCase();
      if (!key) continue;
      if (!bySymbol[key]) bySymbol[key] = { symbol: key, count: 0, pnl: 0, wins: 0 };
      bySymbol[key].count += 1;
      bySymbol[key].pnl += Number(row?.pnl || 0);
      if (Number(row?.pnl || 0) > 0) bySymbol[key].wins += 1;
    }
    const arr = Object.values(bySymbol).map((x) => ({ ...x, winRate: x.count ? (x.wins / x.count) * 100 : null }));
    arr.sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));
    return { best: arr.slice(0, 3), worst: arr.slice(-3).reverse() };
  }

  function tradeOperationalLabel(meta) {
    if (!meta) return "a surveiller";
    if (meta.stopDistancePct != null && meta.stopDistancePct <= 5) return "proche stop";
    if (meta.targetDistancePct != null && meta.targetDistancePct <= 5) return "proche objectif";
    if (meta.livePnlPct != null && meta.livePnlPct > 0) return "en suivi";
    return "en attente";
  }

  function displayScoreValue(position){
    const snap = position?.analysisSnapshot || {};
    const raw = Number(snap?.score ?? position?.score);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }

  function displayRatioValue(position){
    const snap = position?.analysisSnapshot || {};
    const explicit = Number(snap?.ratio ?? position?.rrRatio);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const entry = Number(position?.execution?.entryPrice ?? snap?.entry ?? position?.entryPrice);
    const stop = Number(snap?.stopLoss ?? position?.stopLoss);
    const target = Number(snap?.takeProfit ?? position?.takeProfit);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (!(risk > 0) || !(reward > 0)) return null;
    return reward / risk;
  }

  function displayInvestedValue(position){
    const exec = position?.execution || {};
    const direct = Number(exec?.invested ?? position?.invested);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const entry = Number(exec?.entryPrice ?? position?.analysisSnapshot?.entry ?? position?.entryPrice);
    const qty = Number(exec?.quantity ?? position?.quantity);
    if (Number.isFinite(entry) && entry > 0 && Number.isFinite(qty) && qty > 0) return entry * qty;
    return null;
  }

  function historyCloseLabel(position){
    return displayHistorySourceOrClosure(position);
  }

  function tradeLiveIntervalMs(position) {
    const symbol = String(position?.symbol || "").toUpperCase();
    if (!symbol) return 120000;
    if (["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "SUI", "NEAR", "TON", "APT"].includes(symbol)) return 30000;
    return 120000;
  }

  async function refreshOpenTradesLive(force = false) {
    if (state.tradeLive?.running) return;
    if (state.route !== "portfolio" || state.trades.mode !== "training") return;
    const positions = Array.isArray(state.trades?.positions) ? state.trades.positions : [];
    if (!positions.length) return;

    const now = Date.now();
    const targets = positions.filter((p) => {
      const key = String(p?.symbol || "").toUpperCase();
      const last = Number(state.tradeLive.bySymbol?.[key] || 0);
      return force || (now - last) >= tradeLiveIntervalMs(p);
    });

    if (!targets.length) return;
    state.tradeLive.running = true;

    try {
      const results = await Promise.all(targets.map(async (position) => {
        const symbol = String(position?.symbol || "").toUpperCase();
        try {
          const detail = await api(`/api/opportunity-detail/${encodeURIComponent(symbol)}`, 8000);
          const price = Number(detail?.data?.price);
          return {
            symbol,
            ok: Number.isFinite(price),
            price: Number.isFinite(price) ? price : null,
            sourceUsed: detail?.data?.sourceUsed || null
          };
        } catch (e) {
          return { symbol, ok: false, price: null, sourceUsed: null };
        }
      }));

      let changed = false;
      state.trades.positions = state.trades.positions.map((raw) => {
        const p = normalizePositionRecord(raw);
        const symbol = String(p?.symbol || "").toUpperCase();
        const hit = results.find((x) => x.symbol === symbol);
        if (!hit) return p;
        state.tradeLive.bySymbol[symbol] = now;
        if (!hit.ok || hit.price == null) return p;

        const exec = p.execution || {};
        const entryPrice = Number(exec.entryPrice ?? p.entryPrice ?? p.analysisSnapshot?.entry);
        const quantity = Number(exec.quantity ?? p.quantity);
        const pnl = (Number.isFinite(entryPrice) && Number.isFinite(quantity) && quantity > 0)
          ? ((p.side === "short" ? (entryPrice - hit.price) : (hit.price - entryPrice)) * quantity)
          : null;
        const invested = Number.isFinite(entryPrice) && Number.isFinite(quantity) && quantity > 0 ? entryPrice * quantity : null;
        const pnlPct = (pnl != null && invested && invested > 0) ? (pnl / invested) * 100 : null;

        changed = true
        return normalizePositionRecord({
          ...p,
          sourceUsed: p.sourceUsed || hit.sourceUsed || null,
          live: {
            ...(p.live || {}),
            updatedAt: new Date(now).toISOString(),
            price: hit.price,
            pnl,
            pnlPct
          }
        });
      });

      if (changed || results.length) {
        persistTradesLocalCache();
        render();
      }
    } finally {
      state.tradeLive.lastRunAt = now;
      state.tradeLive.running = false;
    }
  }

  
function createAnalysisSnapshotFromOpportunity(detail){
  if (!detail || typeof detail !== "object") return null;
  const plan = typeof currentTradePlan === "function" ? currentTradePlan(detail) : null;
  return {
    symbol: detail.symbol || null,
    name: detail.name || detail.label || detail.symbol || null,
    score: Number.isFinite(Number(detail.score)) ? Number(detail.score) : null,
    decision: plan?.decision || detail.decision || null,
    trendLabel: plan?.trendLabel || detail.trendLabel || detectedTrendLabel(detail.direction || "neutral"),
    direction: detail.direction || null,
    entry: Number.isFinite(Number(plan?.entry)) ? Number(plan.entry) : null,
    stopLoss: Number.isFinite(Number(plan?.stopLoss)) ? Number(plan.stopLoss) : null,
    takeProfit: Number.isFinite(Number(plan?.takeProfit)) ? Number(plan.takeProfit) : null,
    ratio: Number.isFinite(Number(plan?.ratio)) ? Number(plan.ratio) : null,
    horizon: plan?.horizon || detail.horizon || null,
    reason: plan?.reason || detail.reason || detail.summary || null,
    scoreBreakdown: detail.scoreBreakdown || null,
    sourceUsed: detail.source || detail.sourceUsed || null,
    analysisTimestamp: Date.now()
  };
}

function normalizePositionRecord(position){
  if (!position || typeof position !== "object") return position;

  const safeNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const positiveOrNull = (value) => {
    const num = safeNumber(value);
    return num != null && num > 0 ? num : null;
  };

  const entryPriceRaw = positiveOrNull(position?.execution?.entryPrice ?? position?.entryPrice ?? position?.analysisSnapshot?.entry);
  const quantityRaw = positiveOrNull(position?.execution?.quantity ?? position?.quantity);
  const investedRaw = positiveOrNull(position?.execution?.invested ?? position?.invested)
    ?? ((entryPriceRaw != null && quantityRaw != null) ? entryPriceRaw * quantityRaw : null);
  const stopLossRaw = positiveOrNull(position?.analysisSnapshot?.stopLoss ?? position?.stopLoss);
  const takeProfitRaw = positiveOrNull(position?.analysisSnapshot?.takeProfit ?? position?.takeProfit);
  const ratioRaw = positiveOrNull(position?.analysisSnapshot?.ratio ?? position?.rrRatio ?? position?.rr);
  const exitPriceRaw = positiveOrNull(position?.closedExecution?.exitPrice ?? position?.exitPrice);
  const livePriceRaw = positiveOrNull(position?.live?.price);
  const pnlRaw = safeNumber(position?.pnl);
  const pnlPctRaw = safeNumber(position?.pnlPct);
  const sourceUsed = position?.sourceUsed || position?.source || position?.analysisSnapshot?.sourceUsed || null;

  const snapshot = {
    symbol: position.symbol || null,
    name: position.name || position.symbol || null,
    score: positiveOrNull(position?.analysisSnapshot?.score ?? position?.score),
    decision: position?.analysisSnapshot?.decision || position?.tradeDecision || null,
    trendLabel: position?.analysisSnapshot?.trendLabel || position?.trendLabel || detectedTrendLabel(position?.direction || "neutral"),
    direction: position?.analysisSnapshot?.direction || position?.direction || null,
    entry: entryPriceRaw,
    stopLoss: stopLossRaw,
    takeProfit: takeProfitRaw,
    ratio: ratioRaw,
    horizon: position?.analysisSnapshot?.horizon || position?.horizon || null,
    reason: position?.analysisSnapshot?.reason || position?.tradeReason || null,
    scoreBreakdown: position?.analysisSnapshot?.scoreBreakdown || position?.scoreBreakdown || null,
    sourceUsed,
    analysisTimestamp: position?.analysisSnapshot?.analysisTimestamp || position?.openedAt || Date.now()
  };

  return {
    ...position,
    analysisSnapshot: snapshot,
    execution: {
      ...(position.execution || {}),
      openedAt: position?.execution?.openedAt || position?.openedAt || null,
      entryPrice: entryPriceRaw,
      quantity: quantityRaw,
      invested: investedRaw
    },
    live: {
      ...(position.live || {}),
      updatedAt: position?.live?.updatedAt || Date.now(),
      price: livePriceRaw,
      pnl: position?.live?.pnl != null ? safeNumber(position.live.pnl) : null,
      pnlPct: position?.live?.pnlPct != null ? safeNumber(position.live.pnlPct) : null
    },
    closedExecution: {
      ...(position.closedExecution || {}),
      exitPrice: exitPriceRaw,
      closedAt: position?.closedExecution?.closedAt || position?.closedAt || null,
      closeType: position?.closedExecution?.closeType || position?.closeType || null
    },
    tradeDecision: snapshot.decision,
    tradeReason: snapshot.reason,
    trendLabel: snapshot.trendLabel,
    horizon: snapshot.horizon,
    stopLoss: stopLossRaw,
    takeProfit: takeProfitRaw,
    score: snapshot.score,
    entryPrice: entryPriceRaw,
    quantity: quantityRaw,
    invested: investedRaw,
    exitPrice: exitPriceRaw,
    pnl: pnlRaw,
    pnlPct: pnlPctRaw,
    sourceUsed
  };
}

function normalizeOpenPositionsState(){
  if (!state || !Array.isArray(state.openPositions)) return;
  state.openPositions = state.openPositions.map(normalizePositionRecord);
}

function restoreTradesFromBackupIfEmpty() {
  const backupPositions = readJson(TRADE_STORAGE.positionsBackup, []);
  const backupHistory = readJson(TRADE_STORAGE.historyBackup, []);
  const backupAlgo = readJson(TRADE_STORAGE.algoJournalBackup, []);

  if (!state.trades.positions.length && Array.isArray(backupPositions) && backupPositions.length) {
    state.trades.positions = backupPositions.map(normalizePositionRecord);
  }
  if (!state.trades.history.length && Array.isArray(backupHistory) && backupHistory.length) {
    state.trades.history = backupHistory.map((x) => normalizePositionRecord(x));
  }
  if (!state.algoJournal.length && Array.isArray(backupAlgo) && backupAlgo.length) {
    state.algoJournal = backupAlgo;
  }
}


function validTradeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function historyHasMeaningfulClosure(position) {
  const p = normalizePositionRecord(position);
  const closeType = String(p?.closedExecution?.closeType || p?.closeType || "").toLowerCase();
  return !!(
    validTradeDate(p?.closedExecution?.closedAt || p?.closedAt) ||
    (Number.isFinite(Number(p?.closedExecution?.exitPrice ?? p?.exitPrice)) && Number(p?.closedExecution?.exitPrice ?? p?.exitPrice) > 0) ||
    (Number.isFinite(Number(p?.pnl)) && Math.abs(Number(p?.pnl)) > 0.000001) ||
    (closeType && closeType !== "training")
  );
}

function isLegacyClosedTrade(position) {
  const p = normalizePositionRecord(position);
  const closeType = String(p?.closedExecution?.closeType || p?.closeType || p?.sourceUsed || "").toLowerCase();
  const closedAt = validTradeDate(p?.closedExecution?.closedAt || p?.closedAt);
  const exitPrice = Number(p?.closedExecution?.exitPrice ?? p?.exitPrice);
  const pnl = Number(p?.pnl || 0);
  const pnlPct = Number(p?.pnlPct || 0);
  const entryPrice = Number(p?.execution?.entryPrice ?? p?.entryPrice);
  const hasAnyClose = historyHasMeaningfulClosure(p);

  if (hasAnyClose) return false;
  return !!(
    p?.symbol &&
    Number.isFinite(entryPrice) && entryPrice > 0 &&
    (!closedAt) &&
    (!Number.isFinite(exitPrice) || exitPrice <= 0) &&
    Math.abs(pnl) < 0.000001 &&
    Math.abs(pnlPct) < 0.000001 &&
    (!closeType || closeType === "training")
  );
}

function historyDedupKey(position) {
  const p = normalizePositionRecord(position);
  const symbol = String(p?.symbol || "").toUpperCase();
  const closedAt = validTradeDate(p?.closedExecution?.closedAt || p?.closedAt) || "no-date";
  const entry = Number.isFinite(Number(p?.execution?.entryPrice ?? p?.entryPrice)) ? Number(p?.execution?.entryPrice ?? p?.entryPrice).toFixed(6) : "no-entry";
  const exit = Number.isFinite(Number(p?.closedExecution?.exitPrice ?? p?.exitPrice)) ? Number(p?.closedExecution?.exitPrice ?? p?.exitPrice).toFixed(6) : "no-exit";
  const qty = Number.isFinite(Number(p?.execution?.quantity ?? p?.quantity)) ? Number(p?.execution?.quantity ?? p?.quantity).toFixed(6) : "no-qty";
  return [symbol, closedAt, entry, exit, qty].join("|");
}

function normalizeTradesHistoryState() {
  if (!state?.trades) return;
  state.trades.historyHiddenCount = 0;

  if (Array.isArray(state.trades.positions)) {
    state.trades.positions = state.trades.positions
      .map(normalizePositionRecord)
      .filter((p) => !!String(p?.symbol || "").trim());
  }

  if (Array.isArray(state.trades.history)) {
    const normalized = state.trades.history
      .map(normalizePositionRecord)
      .filter((p) => !!String(p?.symbol || "").trim());

    const hidden = normalized.filter(isLegacyClosedTrade);
    state.trades.historyHiddenCount = hidden.length;

    const clean = normalized.filter((p) => !isLegacyClosedTrade(p));
    const seen = new Set();
    state.trades.history = clean.filter((p) => {
      const key = historyDedupKey(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

function openPositionsRiskView() {
    const positions = Array.isArray(state.trades?.positions) ? state.trades.positions : [];
    return positions.map((p) => {
      const liveMatch = Array.isArray(state.opportunities) ? state.opportunities.find((o) => o.symbol === p.symbol) : null;
      const livePrice = liveMatch?.price ?? p.entryPrice ?? null;
      const distanceToStop = (p.stopLoss == null || livePrice == null)
        ? null
        : (p.side === "long"
            ? ((livePrice - p.stopLoss) / livePrice) * 100
            : ((p.stopLoss - livePrice) / livePrice) * 100);
      return { ...p, livePrice, distanceToStop };
    }).sort((a, b) => {
      const av = a.distanceToStop == null ? 999 : a.distanceToStop;
      const bv = b.distanceToStop == null ? 999 : b.distanceToStop;
      return av - bv;
    });
  }

  function renderPortfolio() {
    restoreTradesFromBackupIfEmpty();
    normalizeTradesHistoryState();
    refreshOpenTradesLive().catch(() => {});
    const stats = trainingStats();
    const positions = state.trades.positions;
    const history = state.trades.history;
    const algoCounts = (typeof algoDecisionCounts === "function") ? algoDecisionCounts() : { total: 0, conseille: 0, possible: 0, surveiller: 0, eviter: 0, aucun: 0, manuel: 0 };
    const insights = (typeof groupedHistoryInsights === "function") ? groupedHistoryInsights() : { best: [], worst: [] };
    const riskRows = (typeof openPositionsRiskView === "function") ? openPositionsRiskView() : [];

    return `
      <div class="screen">
        <div class="screen-header">
          <div class="screen-title">Mes trades</div>
          <div class="screen-subtitle">Lecture simple des positions ouvertes, des trades clotures et des zones a surveiller. La carte trade separe maintenant le snapshot d'ouverture, l'etat live et le statut operationnel. Connexion distante automatique via le Worker avec mise a jour live des trades ouverts. Le mode entrainement suit maintenant un vrai capital fictif.</div>
          ${(() => { const meta = loadTradesMeta(); return meta?.updatedAt ? `<div class="muted">Derniere sauvegarde locale : ${new Date(meta.updatedAt).toLocaleString("fr-FR")}</div>` : ""; })()}
          <div class="muted">Etat distant : ${
            state.trades.remoteStatus === "connected"
              ? `connecte${state.trades.lastRemoteSyncAt ? " · sync " + new Date(state.trades.lastRemoteSyncAt).toLocaleString("fr-FR") : ""}`
              : state.trades.remoteStatus === "fallback_local"
                ? `fallback local · ${safeText(state.trades.remoteError || "erreur distante")}`
                : "local uniquement"
          }</div>
          ${Number(state.trades.historyHiddenCount || 0) > 0 ? `<div class="muted">Historique legacy masque automatiquement : ${num(state.trades.historyHiddenCount, 0)} ligne(s) incomplete(s).</div>` : ""}
        </div>

        <div class="controls">
          <button class="btn ${state.trades.mode === 'training' ? 'active' : ''}" data-trade-mode="training">Entrainement</button>
          <button class="btn ${state.trades.mode === 'real' ? 'active' : ''}" data-trade-mode="real">Reel</button>
          <button class="btn" data-reset-training-capital>Reinitialiser capital fictif</button>
        </div>

        ${state.trades.mode === "real" ? `
          <div class="empty-state">Le portefeuille reel n'est pas encore branche. Cette partie restera vide tant qu'aucune source reelle n'est connectee.</div>
        ` : `
          <div class="grid trades-stats">
            <div class="stat-card"><div class="stat-label">Capital de depart</div><div class="stat-value">${money(stats.wallet.startingBalanceEur, "EUR")}</div></div>
            <div class="stat-card"><div class="stat-label">Disponible</div><div class="stat-value">${money(stats.wallet.availableEur, "EUR")}</div></div>
            <div class="stat-card"><div class="stat-label">Engage</div><div class="stat-value">${money(stats.wallet.engagedEur, "EUR")}</div></div>
            <div class="stat-card"><div class="stat-label">P/L latent</div><div class="stat-value">${money(stats.wallet.unrealizedEur, "EUR")}</div></div>
            <div class="stat-card"><div class="stat-label">Resultat realise</div><div class="stat-value">${money(stats.wallet.realizedEur, "EUR")}</div></div>
            <div class="stat-card"><div class="stat-label">Equity</div><div class="stat-value">${money(stats.wallet.equityEur, "EUR")}</div></div>
          </div>

          <div class="grid trades-stats" style="margin-top:14px">
            <div class="stat-card"><div class="stat-label">Trades ouverts</div><div class="stat-value">${stats.openCount}</div></div>
            <div class="stat-card"><div class="stat-label">Trades clotures</div><div class="stat-value">${stats.closedCount}</div></div>
            <div class="stat-card"><div class="stat-label">Trades proposes</div><div class="stat-value">${algoCounts.conseille}</div></div>
            <div class="stat-card"><div class="stat-label">Possibles</div><div class="stat-value">${algoCounts.possible}</div></div>
            <div class="stat-card"><div class="stat-label">A surveiller</div><div class="stat-value">${algoCounts.surveiller}</div></div>
            <div class="stat-card"><div class="stat-label">A eviter</div><div class="stat-value">${algoCounts.eviter}</div></div>
          </div>

          <div class="card" style="margin-top:18px">
            <div class="section-title"><span>Lecture rapide</span><span>${positions.length}</span></div>
            <div class="portfolio-overview-text">
              ${positions.length
                ? `${positions.length} trade${positions.length > 1 ? "s sont" : " est"} ouvert${positions.length > 1 ? "s" : ""}. ${riskRows.length ? `${riskRows.filter((r) => r.distanceToStop != null && r.distanceToStop <= 2).length} position${riskRows.filter((r) => r.distanceToStop != null && r.distanceToStop <= 2).length > 1 ? "s sont" : " est"} proche${riskRows.filter((r) => r.distanceToStop != null && r.distanceToStop <= 2).length > 1 ? "s" : ""} du stop.` : ""}`
                : "Aucun trade ouvert pour le moment."}
            </div>
          </div>

          <div class="risk-layout">
            <div class="card" style="margin-top:18px">
              <div class="section-title"><span>Positions a surveiller</span><span>${riskRows.length}</span></div>
              ${riskRows.length ? `
                <div class="risk-list">
                  ${riskRows.slice(0, 8).map((row) => `
                    <div class="risk-row">
                      <div>
                        <div class="trade-symbol">${safeText(row.symbol)}</div>
                        <div class="trade-sub">${safeText(row.tradeDecision || "trade ouvert")}</div>
                      </div>
                      <div>${badge(simpleSideLabel(row.side), row.side)}</div>
                      <div>${row.distanceToStop == null ? "stop indisponible" : `${num(row.distanceToStop, 2)}% avant stop`}</div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="empty-state">Aucune position ouverte pour le moment.</div>`}
            </div>

            <div class="card" style="margin-top:18px">
              <div class="section-title"><span>Bilan rapide</span><span>historique</span></div>
              <div class="perf-columns">
                <div>
                  <div class="muted" style="margin-bottom:8px">Actifs qui ont le mieux marche</div>
                  ${insights.best.length ? insights.best.map((row) => `
                    <div class="mini-perf-row">
                      <span>${safeText(row.symbol)}</span>
                      <span>${money(row.pnl * fxRateUsdToEur(), "EUR")} · ${row.count} trade(s)</span>
                    </div>
                  `).join("") : `<div class="empty-mini">Pas assez d'historique</div>`}
                </div>
                <div>
                  <div class="muted" style="margin-bottom:8px">Actifs les plus difficiles</div>
                  ${insights.worst.length ? insights.worst.map((row) => `
                    <div class="mini-perf-row">
                      <span>${safeText(row.symbol)}</span>
                      <span>${money(row.pnl * fxRateUsdToEur(), "EUR")} · ${row.count} trade(s)</span>
                    </div>
                  `).join("") : `<div class="empty-mini">Pas assez d'historique</div>`}
                </div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:18px">
            <div class="section-title"><span>Trades ouverts</span><span>${positions.length}</span></div>
            ${positions.length ? `
              <div class="trade-table simplified-open-trades">
                ${positions.map(renderPositionRow).join("")}
              </div>
            ` : `<div class="empty-state">Aucun trade ouvert. Ouvre une fiche actif quand un trade est vraiment propose.</div>`}
          </div>

          <div class="card" style="margin-top:18px">
            <div class="section-title"><span>Trades clotures</span><span>${history.length}</span></div>
            <div class="muted" style="margin-bottom:12px">Les lignes legacy sans vraie date de cloture, sans prix de sortie valide et sans fermeture exploitable sont maintenant masquees.</div>
            ${history.length ? `
              <div class="trade-table simplified-history">
                <div class="trade-row trade-head">
                  <div>Actif</div><div>Sens</div><div>Resultat</div><div>Entree</div><div>Sortie</div><div>P/L</div><div>Source / cloture</div>
                </div>
                ${history.map(renderHistoryRow).join("")}
              </div>
            ` : `<div class="empty-state">Aucun trade cloture pour le moment.</div>`}
          </div>
          ${state.settings.showAlgoJournal ? renderJournalMoteurCard() : ""}
        `}
      </div>`;
  }

  function renderSettings() {
    return `
      <div class="screen">
        <div class="screen-header">
          <div class="screen-title">Reglages</div>
          <div class="screen-subtitle">Ces reglages servent juste a rendre l'app plus claire.</div>
        </div>

        <div class="card">
          <div class="setting-list">
            <label class="setting-row">
              <div>
                <div class="setting-title">Rafraichir les opportunites</div>
                <div class="setting-desc">Recharge automatiquement la liste quand le delai minimum Twelve est termine.</div>
              </div>
              <input type="checkbox" data-setting-toggle="autoRefreshOpportunities" ${state.settings.autoRefreshOpportunities ? "checked" : ""}>
            </label>

            <label class="setting-row">
              <div>
                <div class="setting-title">Afficher source et mise a jour</div>
                <div class="setting-desc">Montre les badges fournisseur et fraicheur sur les cartes.</div>
              </div>
              <input type="checkbox" data-setting-toggle="showSourceBadges" ${state.settings.showSourceBadges ? "checked" : ""}>
            </label>

            <label class="setting-row">
              <div>
                <div class="setting-title">Afficher le detail du signal</div>
                <div class="setting-desc">Affiche les sous-composants du score detaille dans la fiche actif.</div>
              </div>
              <input type="checkbox" data-setting-toggle="showScoreBreakdown" ${state.settings.showScoreBreakdown ? "checked" : ""}>
            </label>

            <label class="setting-row">
              <div>
                <div class="setting-title">Cartes plus compactes</div>
                <div class="setting-desc">Resserre un peu les cartes opportunites.</div>
              </div>
              <input type="checkbox" data-setting-toggle="compactCards" ${state.settings.compactCards ? "checked" : ""}>
            </label>

            <label class="setting-row">
              <div>
                <div class="setting-title">Activer le theme clair</div>
                <div class="setting-desc">Passe l'app sur un rendu clair, plus doux en journee.</div>
              </div>
              <input type="checkbox" data-setting-toggle="lightTheme" ${state.settings.lightTheme ? "checked" : ""}>
            </label>

            <label class="setting-row">
              <div>
                <div class="setting-title">Afficher le journal moteur</div>
                <div class="setting-desc">Montre les dernieres decisions du moteur dans l'accueil et Mes trades.</div>
              </div>
              <input type="checkbox" data-setting-toggle="showAlgoJournal" ${state.settings.showAlgoJournal ? "checked" : ""}>
            </label>

            <label class="setting-row">
              <div>
                <div class="setting-title">Devise d'affichage</div>
                <div class="setting-desc">Choisis si tu veux voir les prix en euro, en dollar, ou les deux.</div>
              </div>
              <select class="setting-select" data-setting-select="displayCurrency">
                <option value="EUR" ${state.settings.displayCurrency === "EUR" ? "selected" : ""}>Euro</option>
                <option value="USD" ${state.settings.displayCurrency === "USD" ? "selected" : ""}>Dollar</option>
                <option value="EUR_PLUS_USD" ${state.settings.displayCurrency === "EUR_PLUS_USD" ? "selected" : ""}>Euro + dollar</option>
              </select>
            </label>
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="section-title">Supabase trades</div>
          <div class="setting-list">
            <div class="setting-row">
              <div>
                <div class="setting-title">Connexion automatique via Worker Cloudflare</div>
                <div class="setting-desc">Les trades passent maintenant par le Worker. Tu n'as plus besoin de saisir l'URL ni la cle Supabase dans l'app.</div>
              </div>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-title">Etat distant</div>
                <div class="setting-desc">${
                  state.trades.remoteStatus === "connected"
                    ? `connecte${state.trades.lastRemoteSyncAt ? " · sync " + new Date(state.trades.lastRemoteSyncAt).toLocaleString("fr-FR") : ""}`
                    : state.trades.remoteStatus === "fallback_local"
                      ? `fallback local · ${safeText(state.trades.remoteError || "worker / supabase indisponible")}`
                      : "local uniquement"
                }</div>
              </div>
            </div>
            <div class="muted">Secrets attendus dans Cloudflare : SUPABASE_URL et SUPABASE_ANON_KEY.</div>
          </div>
        </div>
      </div>`;
  }

  function renderMain() {
    switch (state.route) {
      case "dashboard": return renderDashboard();
      case "opportunities": return renderOpportunities();
      case "news": return renderNews();
      case "asset-detail": return renderDetail();
      case "portfolio": return renderPortfolio();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  }

  function applyThemeMode() {
    document.documentElement.classList.toggle("theme-light-root", !!state.settings.lightTheme);
    document.body.classList.toggle("theme-light-root", !!state.settings.lightTheme);
  }

  function render() {
    app.innerHTML = `
      <div class="app-shell ${state.settings.compactCards ? "compact-ui" : ""} ${state.settings.lightTheme ? "theme-light" : ""}">
        ${renderSidebar()}
        <main class="main-content">${renderMain()}</main>
        ${renderBottomNav()}
        ${renderTradeConfirmModal()}
      </div>
    `;
    applyThemeMode();
    bindEvents();
  }

  function bindEvents() {
    app.querySelectorAll("[data-route]").forEach(el => {
      el.addEventListener("click", () => {
        const route = el.getAttribute("data-route");
        if (route === "opportunities" && state.settings.autoRefreshOpportunities) {
          navigate("opportunities");
        } else {
          state.route = route;
          render();
        }
      });
    });

    app.querySelectorAll("[data-filter]").forEach(el => {
      el.addEventListener("click", () => {
        state.opportunityFilter = el.getAttribute("data-filter");
        applyFilter();
        render();
      });
    });

    app.querySelectorAll("[data-refresh='opportunities']").forEach(el => {
      el.addEventListener("click", () => loadOpportunities(true));
    });

    app.querySelectorAll(".opp-row[data-symbol], .ai-card[data-symbol]").forEach(el => {
      el.addEventListener("click", () => navigate("asset-detail", el.getAttribute("data-symbol")));
    });

    app.querySelectorAll("[data-add-trade]").forEach(el => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openTradeConfirmModal("manual", el.getAttribute("data-add-trade"));
      });
    });

    app.querySelectorAll("[data-create-trade-plan]").forEach(el => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openTradeConfirmModal("recommended");
      });
    });

    app.querySelectorAll("[data-cancel-trade-confirm]").forEach(el => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeTradeConfirmModal();
      });
    });

    app.querySelectorAll("[data-confirm-open-trade]").forEach(el => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        confirmTradeFromModal();
      });
    });

    app.querySelectorAll("[data-close-trade]").forEach(el => {
      el.addEventListener("click", () => closeTrainingTrade(el.getAttribute("data-close-trade")));
    });

    app.querySelectorAll("[data-close-half]").forEach(el => {
      el.addEventListener("click", () => partialClosePosition(el.getAttribute("data-close-half"), 50));
    });

    app.querySelectorAll("[data-reset-training-capital]").forEach(el => {
      el.addEventListener("click", () => {
        resetTrainingCapital();
        render();
      });
    });

    app.querySelectorAll("[data-trade-mode]").forEach(el => {
      el.addEventListener("click", () => {
        state.trades.mode = el.getAttribute("data-trade-mode");
        render();
      });
    });

    app.querySelectorAll("[data-setting-toggle]").forEach(el => {
      el.addEventListener("change", () => {
        const key = el.getAttribute("data-setting-toggle");
        state.settings[key] = el.checked;
        persistSettings();
        render();
      });
    });

    app.querySelectorAll("[data-setting-select]").forEach(el => {
      el.addEventListener("change", () => {
        const key = el.getAttribute("data-setting-select");
        state.settings[key] = el.value;
        persistSettings();
        render();
      });
    });


  }

  async function boot() {
    await loadTradesState();
    if (Array.isArray(state.opportunitiesSnapshot) && state.opportunitiesSnapshot.length) {
      state.opportunities = state.opportunitiesSnapshot.map(normalizeOpportunity);
      applyFilter();
    }
    render();
    await loadDashboard();
    render();
    setInterval(() => {
      if (["dashboard", "opportunities", "news", "asset-detail", "settings", "portfolio"].includes(state.route)) {
        if (state.route === "portfolio") {
          refreshOpenTradesLive().catch(() => {});
        }
        render();
      }
    }, 30000);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  boot();
})();
