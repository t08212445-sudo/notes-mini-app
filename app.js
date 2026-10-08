(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  // ==================================================================
  // ТЕМА: только тёмный режим
  // ==================================================================
  const root = document.documentElement;

  function applyTheme() {
    const theme = localStorage.getItem("rem_theme") || "classic";
    root.dataset.theme = theme;
    root.dataset.scheme = "dark";
    localStorage.removeItem("rem_scheme");
    document.querySelectorAll("[data-set-theme]").forEach((b) =>
      b.classList.toggle("active", b.dataset.setTheme === theme));

    const hero = document.querySelector(".hero-art");
    if (hero) {
      const heroMap = {
        resident: "assets/theme-resident.svg",
        strinova: "assets/theme-strinova.svg",
      };
      hero.src = heroMap[theme] || "assets/reminder-hero.svg";
    }
    document.body.dataset.heroTheme = theme;
  }

  function setTheme(theme) {
    localStorage.setItem("rem_theme", theme);
    tg?.HapticFeedback?.selectionChanged();
    applyTheme();
  }

  // ==================================================================
  // ШТОРКА НАСТРОЕК
  // ==================================================================
  const sheet = document.getElementById("settingsSheet");
  const backdrop = document.getElementById("sheetBackdrop");

  function openSheet() {
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    backdrop.classList.remove("hidden");
    tg?.HapticFeedback?.impactOccurred("light");
  }

  function closeSheet() {
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    backdrop.classList.add("hidden");
  }

  document.getElementById("settingsBtn").addEventListener("click", () => {
    sheet.classList.contains("open") ? closeSheet() : openSheet();
  });
  backdrop.addEventListener("click", closeSheet);

  document.querySelectorAll("[data-set-theme]").forEach((b) =>
    b.addEventListener("click", () => setTheme(b.dataset.setTheme)));

  // «+» — новая напоминалка (сбрасываем форму, уходим из режима редактирования)
  document.getElementById("menuNew").addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("light");
    closeSheet();
    openEditor(null);
  });

  document.getElementById("fabAdd").addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("light");
    openEditor(null);
  });

  document.getElementById("menuList").addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("light");
    closeSheet();
    showHome();
  });

  // ==================================================================
  // РЕЖИМ: новая / редактирование
  // ==================================================================
  function decodePayload(b64url) {
    let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }

  const params = new URLSearchParams(location.search);
  const urlEditing = params.get("mode") === "edit";
  let editing = false;
  let prefill = null;
  let urlPrefill = null;
  if (urlEditing && params.get("data")) {
    try { urlPrefill = decodePayload(params.get("data")); } catch { urlPrefill = null; }
  }

  // Список напоминаний хранится на сервере по Telegram user_id.
  // localStorage используется только как быстрый кэш до ответа API.
  const REMINDER_CACHE_PREFIX = "notes_reminders_cache_v4_";
  let currentTelegramUserId = null;

  function reminderCacheKey() {
    return `${REMINDER_CACHE_PREFIX}${currentTelegramUserId || "unknown"}`;
  }

  const PENDING_KEY = "notes_reminders_pending_v1";

  function readPendingReminders() {
    try {
      const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_) { return {}; }
  }

  function writePendingReminders(value) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function markPendingReminder(item) {
    if (!item?.id) return;
    const pending = readPendingReminders();
    pending[String(item.id)] = { saved_at: Date.now(), item };
    writePendingReminders(pending);
  }

  function clearPendingReminder(id) {
    const pending = readPendingReminders();
    delete pending[String(id)];
    writePendingReminders(pending);
  }

  function readReminderCache() {
    try {
      const value = JSON.parse(localStorage.getItem(reminderCacheKey()) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }

  function writeReminderCache(items) {
    try { localStorage.setItem(reminderCacheKey(), JSON.stringify(items.slice(0, 50))); } catch (_) {}
  }

  function cacheReminder(item) {
    if (!item?.text || !item?.time || !item?.mode) return;
    const serverId = item.id || item.server_id || null;
    if (!serverId) return;
    const next = { ...item, id: serverId, server_id: serverId, saved_at: Date.now() };
    const items = readReminderCache().filter((x) => (x.server_id || x.id) !== serverId);
    writeReminderCache([next, ...items]);
    markPendingReminder(next);
  }

  function replaceReminderCache(items) {
    const remote = (Array.isArray(items) ? items : [])
      .filter((x) => x?.id && x?.text && x?.time && x?.mode)
      .map((x) => ({ ...x, server_id: x.id }));

    const now = Date.now();
    const pending = readPendingReminders();
    const merged = new Map(remote.map((x) => [String(x.id), x]));

    // Protect a just-saved item from a temporarily stale GET response.
    for (const [id, entry] of Object.entries(pending)) {
      if (!entry?.item || now - Number(entry.saved_at || 0) > 120000) {
        delete pending[id];
        continue;
      }
      if (!merged.has(id)) merged.set(id, entry.item);
      else delete pending[id];
    }
    writePendingReminders(pending);

    const normalized = [...merged.values()];
    normalized.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    writeReminderCache(normalized);
    renderReminderCache();
  }

  function removeCachedReminder(id) {
    clearPendingReminder(id);
    writeReminderCache(readReminderCache().filter((x) => (x.server_id || x.id) !== id));
    renderReminderCache();
  }

  function formatSchedule(item) {
    if (item.mode === "once") {
      return item.date ? `Разово · ${item.date.split("-").reverse().join(".")}` : "Разово";
    }
    if (item.mode === "weekly") {
      const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
      const days = (item.weekdays || []).map(Number).sort((a,b) => a-b);
      return `По дням · ${days.map((d) => names[d]).join(", ") || "—"}`;
    }
    const n = Number(item.interval_days || 1);
    return `Каждые ${n} ${n === 1 ? "день" : (n < 5 ? "дня" : "дней")}`;
  }

  function renderReminderCache() {
    const list = document.getElementById("myRemindersList");
    const empty = document.getElementById("myRemindersEmpty");
    const count = document.getElementById("myRemindersCount");
    if (!list || !empty || !count) return;
    const items = readReminderCache();
    count.textContent = String(items.length);
    list.innerHTML = "";
    empty.classList.toggle("hidden", items.length !== 0);

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "reminder-item";
      const top = document.createElement("div"); top.className = "reminder-item-top";
      const time = document.createElement("strong"); time.className = "reminder-item-time"; time.textContent = item.time;
      const badge = document.createElement("span"); badge.className = "reminder-item-badge";
      badge.textContent = item.mode === "once" ? "РАЗОВО" : item.mode === "weekly" ? "ПО ДНЯМ" : "ИНТЕРВАЛ";
      top.append(time, badge);
      const text = document.createElement("div"); text.className = "reminder-item-text"; text.textContent = item.text;
      const meta = document.createElement("div"); meta.className = "reminder-item-meta"; meta.textContent = formatSchedule(item);
      const actions = document.createElement("div"); actions.className = "reminder-item-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button"; editBtn.className = "reminder-mini-btn"; editBtn.textContent = "Изменить";
      editBtn.addEventListener("click", () => {
        openEditor({ ...item, id: item.server_id || item.id });
      });
      actions.append(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button"; deleteBtn.className = "reminder-mini-btn danger"; deleteBtn.textContent = "Убрать";
      deleteBtn.addEventListener("click", async () => {
        const id = item.server_id || item.id;
        deleteBtn.disabled = true; deleteBtn.textContent = "Удаляем…";
        try {
          const response = await fetch("/.netlify/functions/reminders", {
            method: "DELETE",
            headers: apiHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ id }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.ok) throw new Error(data.error || `API ${response.status}`);
          removeCachedReminder(id);
          setSyncStatus("ok", "Удалено на сервере");
          tg?.HapticFeedback?.notificationOccurred("success");
        } catch (err) {
          console.error("Delete reminder failed", err);
          deleteBtn.disabled = false; deleteBtn.textContent = "Убрать";
          alert("Не удалось удалить напоминание.");
        }
      });
      actions.append(deleteBtn);
      card.append(top, text, meta, actions); list.appendChild(card);
    });
  }

  function getLaunchToken() {
    try { return new URLSearchParams(location.search).get("launch") || ""; }
    catch (_) { return ""; }
  }

  function apiHeaders(extra = {}) {
    const headers = { ...extra };
    const initData = tg?.initData || "";
    const launchToken = getLaunchToken();
    if (initData) headers["X-Telegram-Init-Data"] = initData;
    if (launchToken) headers["X-MiniApp-Launch-Token"] = launchToken;
    return headers;
  }

  async function loadRemoteReminders() {
    const initData = tg?.initData || "";
    const launchToken = getLaunchToken();
    if (!initData && !launchToken) {
      setSyncStatus("error", "Нет связи с Telegram");
      renderReminderCache();
      return false;
    }
    setSyncStatus("loading", "Синхронизация…");
    try {
      const response = await fetch("/.netlify/functions/reminders", {
        method: "GET",
        headers: apiHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `API ${response.status}`);
      currentTelegramUserId = String(data.user_id || tg?.initDataUnsafe?.user?.id || "");
      if (!currentTelegramUserId) throw new Error("Telegram user_id отсутствует");
      replaceReminderCache(data.reminders || []);
      setSyncStatus("ok", `Синхронизировано · ${data.reminders?.length || 0}`);
      return true;
    } catch (err) {
      console.error("Не удалось загрузить напоминания пользователя", err);
      setSyncStatus("error", "Нет связи с сервером");
      renderReminderCache();
      return false;
    }
  }

  const headLogo = document.getElementById("headLogo");
  const headSub = document.getElementById("headSub");
  const headTitle = document.getElementById("headTitle");
  const backBtn = document.getElementById("backBtn");
  const viewHome = document.getElementById("viewHome");
  const viewEditor = document.getElementById("viewEditor");
  const fabAdd = document.getElementById("fabAdd");
  const syncStatus = document.getElementById("syncStatus");

  function setSyncStatus(kind, text) {
    if (!syncStatus) return;
    syncStatus.className = `sync-status ${kind}`;
    syncStatus.textContent = text;
  }

  // ==================================================================
  // Колесо выбора времени — настоящее циклическое колесо без «прыжков».
  // Высота ячейки синхронизирована с CSS: 54px.
  // ==================================================================
  function localDateStr(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  const CELL_H = 54;
  const WRAP_H = 164;
  const SPACER = (WRAP_H - CELL_H) / 2;

  function wheelController(container, max, initial, onChange) {
    const count = max + 1;
    const copies = 9;
    const middle = Math.floor(copies / 2);
    const top = document.createElement("div");
    top.style.height = SPACER + "px";
    container.appendChild(top);

    for (let copy = 0; copy < copies; copy++) {
      for (let i = 0; i < count; i++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.textContent = String(i).padStart(2, "0");
        cell.dataset.value = String(i);
        container.appendChild(cell);
      }
    }

    const bottom = document.createElement("div");
    bottom.style.height = SPACER + "px";
    container.appendChild(bottom);

    const cells = Array.from(container.querySelectorAll(".cell"));
    let current = Number(initial) || 0;
    let correcting = false;
    let settleTimer = null;

    const middleIndex = (value) => middle * count + ((Number(value) % count) + count) % count;

    function paint(index) {
      cells.forEach((cell, i) => cell.classList.toggle("is-center", i === index));
    }

    function moveToIndex(index, smooth = true) {
      container.scrollTo({
        top: index * CELL_H,
        behavior: smooth ? "smooth" : "auto",
      });
      paint(index);
    }

    function settle() {
      if (correcting) return;
      let index = Math.round(container.scrollTop / CELL_H);
      index = Math.max(0, Math.min(cells.length - 1, index));
      const value = ((index % count) + count) % count;
      const centered = middleIndex(value);

      // Ровно фиксируем ячейку по центру (без анимации — snap уже отработал).
      if (Math.abs(container.scrollTop - index * CELL_H) > 0.5) {
        container.scrollTo({ top: index * CELL_H, behavior: "auto" });
      }
      paint(index);

      if (value !== current) {
        current = value;
        tg?.HapticFeedback?.selectionChanged();
        onChange(value);
      }

      // Если подошли к краю копий — мгновенно переносим на ту же цифру
      // в центральную копию. Пользователь этого не замечает.
      if (index < count * 2 || index >= count * (copies - 2)) {
        correcting = true;
        container.scrollTo({ top: centered * CELL_H, behavior: "auto" });
        paint(centered);
        correcting = false;
      }
    }

    container.addEventListener("scroll", () => {
      if (correcting) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 180);

      // Во время прокрутки сразу показываем ближайшее значение, но НЕ
      // вмешиваемся в позицию scrollTop. Это устраняет эффект «35 → 36».
      const index = Math.max(0, Math.min(cells.length - 1,
        Math.round(container.scrollTop / CELL_H)));
      const value = ((index % count) + count) % count;
      paint(index);
      if (value !== current) {
        current = value;
        tg?.HapticFeedback?.selectionChanged();
        onChange(value);
      }
    }, { passive: true });

    const initialIndex = middleIndex(initial);
    container.scrollTo({ top: initialIndex * CELL_H, behavior: "auto" });
    paint(initialIndex);

    return {
      scrollTo(value, smooth = true) {
        const index = middleIndex(value);
        current = Number(value);
        moveToIndex(index, smooth);
      },
      get value() { return current; },
    };
  }

  // ==================================================================
  // Текст задачи
  // ==================================================================
  const taskText = document.getElementById("taskText");
    taskText.addEventListener("input", validate);

  // ==================================================================
  // Режим повтора
  // ==================================================================
  const segButtons = Array.from(document.querySelectorAll(".seg-btn"));
  const panes = {
    once: document.getElementById("paneOnce"),
    weekly: document.getElementById("paneWeekly"),
    interval: document.getElementById("paneInterval"),
  };
  let currentMode = "once";

  function setMode(mode) {
    currentMode = mode;
    segButtons.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    Object.entries(panes).forEach(([key, el]) => el.classList.toggle("hidden", key !== mode));
    validate();
  }

  segButtons.forEach((btn) => btn.addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("light");
    setMode(btn.dataset.mode);
  }));

  const onceDate = document.getElementById("onceDate");
  const todayStr = localDateStr();
  onceDate.min = todayStr;
  onceDate.value = todayStr;
  onceDate.addEventListener("input", validate);

  const dayPills = Array.from(document.querySelectorAll(".day-pill"));
  const selectedDays = new Set();
  dayPills.forEach((pill) => {
    const day = parseInt(pill.dataset.day, 10);
    pill.addEventListener("click", () => {
      tg?.HapticFeedback?.selectionChanged();
      if (selectedDays.has(day)) selectedDays.delete(day); else selectedDays.add(day);
      pill.classList.toggle("active");
      validate();
    });
  });

  const intervalValueEl = document.getElementById("intervalValue");
  const intervalUnitEl = document.getElementById("intervalUnit");
  const startDate = document.getElementById("startDate");
  startDate.min = todayStr;
  startDate.value = todayStr;
  startDate.addEventListener("input", validate);

  let intervalDays = 1;

  function pluralDays(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "день";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "дня";
    return "дней";
  }

  function renderInterval() {
    intervalValueEl.textContent = String(intervalDays);
    intervalUnitEl.textContent = pluralDays(intervalDays);
  }
  renderInterval();

  document.getElementById("intervalMinus").addEventListener("click", () => {
    intervalDays = Math.max(1, intervalDays - 1);
    tg?.HapticFeedback?.selectionChanged();
    renderInterval();
  });
  document.getElementById("intervalPlus").addEventListener("click", () => {
    intervalDays = Math.min(365, intervalDays + 1);
    tg?.HapticFeedback?.selectionChanged();
    renderInterval();
  });

  setMode(currentMode);

  // ==================================================================
  // Инициализация колёсика времени
  // В v6 контроллер был объявлен, но сами колёса не создавались —
  // поэтому в интерфейсе оставался только двоеточие.
  // ==================================================================
  const wheelHoursEl = document.getElementById("wheelHours");
  const wheelMinutesEl = document.getElementById("wheelMinutes");

  let selectedHour = 0;
  let selectedMinute = 0;
  let hoursWheel = null;
  let minutesWheel = null;

  function setWheelsTime(h, m) {
    selectedHour = h;
    selectedMinute = m;
    // Колёса можно создавать/двигать только когда экран виден.
    if (!hoursWheel) {
      hoursWheel = wheelController(wheelHoursEl, 23, h, (v) => { selectedHour = v; });
      minutesWheel = wheelController(wheelMinutesEl, 59, m, (v) => { selectedMinute = v; });
    } else {
      hoursWheel.scrollTo(h, false);
      minutesWheel.scrollTo(m, false);
    }
  }

  // ==================================================================
  // Валидация + кнопка сохранения
  // ==================================================================
  const ACCENT = getComputedStyle(root).getPropertyValue("--accent").trim() || "#8C7CF0";

  function validate() {
    let ok = taskText.value.trim().length > 0;
    if (ok && currentMode === "once") ok = !!onceDate.value;
    if (ok && currentMode === "weekly") ok = selectedDays.size > 0;
    if (ok && currentMode === "interval") ok = !!startDate.value;

    if (tg?.MainButton) {
      if (ok) tg.MainButton.enable(); else tg.MainButton.disable();
      tg.MainButton.setParams({
        color: ok ? ACCENT : "#5B5E82",
        text_color: "#FFFFFF",
      });
    }
    const fb = document.getElementById("saveFallback");
    if (fb) fb.disabled = !ok;
    return ok;
  }

  function buildPayload() {
    // Расписание бота работает в одном заданном часовом поясе.
    // Не берём часовой пояс устройства: иначе один и тот же будильник
    // мог сдвигаться на другом телефоне/компьютере.
    const timezone = "Europe/Moscow";
    const payload = {
      text: taskText.value.trim(),
      time: `${String(selectedHour).padStart(2, "0")}:${String(selectedMinute).padStart(2, "0")}`,
      mode: currentMode,
      timezone,
      theme: localStorage.getItem("rem_theme") || "classic",
    };
    if (editing && prefill?.id) payload.id = prefill.id;
    if (currentMode === "once") payload.date = onceDate.value;
    if (currentMode === "weekly") payload.weekdays = Array.from(selectedDays).sort((a, b) => a - b);
    if (currentMode === "interval") {
      payload.interval_days = intervalDays;
      payload.start_date = startDate.value;
    }
    return payload;
  }

  let saving = false;
  let saveTimer = null;

  function resetSaveState() {
    saving = false;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (tg?.MainButton) {
      tg.MainButton.hideProgress();
      validate();
    }
    const fb = document.getElementById("saveFallback");
    if (fb) {
      fb.disabled = !validate();
      fb.textContent = editing ? "Сохранить изменения" : "Сохранить";
    }
  }

  async function saveViaApi(payload) {
    const initData = tg?.initData || "";
    const launchToken = getLaunchToken();
    if (!initData && !launchToken) throw new Error("Mini App открыт вне Telegram. Откройте его через кнопку бота.");
    const response = await fetch("/.netlify/functions/reminders", {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `API ${response.status}`);
    }
    return data.item;
  }

  function showHome() {
    editing = false;
    prefill = null;
    viewEditor.classList.add("hidden");
    viewHome.classList.remove("hidden");
    fabAdd.classList.remove("hidden");
    backBtn.classList.add("hidden");
    headLogo.classList.remove("hidden");
    headLogo.textContent = "⏰";
    headTitle.textContent = "Напоминалки";
    headSub.textContent = "Активные напоминалки";
    try { tg?.BackButton?.hide(); } catch (_) {}
    if (location.search) history.replaceState(null, "", location.pathname);
    renderReminderCache();
    window.scrollTo({ top: 0 });
  }

  function openEditor(item) {
    editing = !!item;
    prefill = item || null;
    const today = localDateStr();

    taskText.value = item?.text || "";
    selectedDays.clear();
    (item?.weekdays || []).forEach((d) => selectedDays.add(Number(d)));
    dayPills.forEach((p) =>
      p.classList.toggle("active", selectedDays.has(parseInt(p.dataset.day, 10))));
    intervalDays = Number(item?.interval_days) || 1;
    renderInterval();
    onceDate.value = item?.date || today;
    startDate.value = item?.start_date || today;
    setMode(item?.mode || "once");

    viewHome.classList.add("hidden");
    viewEditor.classList.remove("hidden");
    fabAdd.classList.add("hidden");
    backBtn.classList.remove("hidden");
    headLogo.classList.add("hidden");
    headTitle.textContent = editing ? "Изменить" : "Новая напоминалка";
    headSub.textContent = "Во сколько напомнить?";
    try { tg?.BackButton?.show(); } catch (_) {}
    window.scrollTo({ top: 0 });

    const m = String(item?.time || "").match(/^(\d{1,2}):(\d{2})$/);
    const d = new Date();
    setWheelsTime(
      m ? Math.min(23, Number(m[1])) : d.getHours(),
      m ? Math.min(59, Number(m[2])) : d.getMinutes()
    );

    const saveButton = document.getElementById("saveFallback");
    if (saveButton) saveButton.textContent = editing ? "Сохранить изменения" : "Сохранить";
    resetSaveState();
  }

  backBtn.addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("light");
    showHome();
  });
  try { tg?.BackButton?.onClick(showHome); } catch (_) {}

  async function handleSave() {
    if (saving) return;
    if (!validate()) {
      tg?.HapticFeedback?.notificationOccurred("error");
      return;
    }

    const payload = buildPayload();
    saving = true;

    if (tg?.MainButton) {
      tg.MainButton.showProgress();
      tg.MainButton.disable();
    }

    const fb = document.getElementById("saveFallback");
    if (fb) {
      fb.disabled = true;
      fb.textContent = "Сохраняем…";
    }

    // Единственный путь сохранения: Mini App → Netlify Function → Blobs.
    // sendData здесь намеренно НЕ используется: при запуске через Menu/Open
    // Telegram не обязан передавать web_app_data обратно боту.
    try {
      const saved = await saveViaApi(payload);
      currentTelegramUserId = currentTelegramUserId || String(tg?.initDataUnsafe?.user?.id || "");
      cacheReminder(saved || payload);
      renderReminderCache();
      setSyncStatus("ok", "Сохранено на сервере");
      tg?.HapticFeedback?.notificationOccurred("success");
      if (tg?.MainButton) tg.MainButton.hideProgress();
      if (fb) fb.textContent = editing ? "Изменения сохранены ✓" : "Сохранено ✓";
      setTimeout(() => { showHome(); loadRemoteReminders(); }, 450);
      return;
    } catch (apiError) {
      console.error("Mini App API save failed", apiError);
      resetSaveState();
      tg?.HapticFeedback?.notificationOccurred("error");
      alert(`Не удалось сохранить напоминание.\n\n${apiError?.message || "Ошибка API"}`);
    }
  }

  // Видимая кнопка сохранения находится внутри Mini App, поэтому она
  // одинаково доступна при Open/Menu, на iOS/Android и в режиме редактирования.
  const fb = document.getElementById("saveFallback");
  if (fb) {
    fb.textContent = editing ? "Сохранить изменения" : "Сохранить";
    fb.addEventListener("click", handleSave);
  }
  // Нативную MainButton Telegram скрываем, чтобы не было двух одинаковых
  // кнопок и чтобы логика сохранения была единой.
  tg?.MainButton?.hide();

  applyTheme();
  currentTelegramUserId = String(tg?.initDataUnsafe?.user?.id || "");
  renderReminderCache();
  loadRemoteReminders();

  // Refresh when Telegram brings the Mini App back to the foreground and
  // periodically while the home screen is open. This keeps phone/PC views
  // aligned without relying on a manual reload.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !viewEditor.classList.contains("hidden")) return;
    if (!document.hidden) loadRemoteReminders();
  });
  setInterval(() => {
    if (!document.hidden && !viewHome.classList.contains("hidden")) loadRemoteReminders();
  }, 15000);

  if (urlEditing && urlPrefill) openEditor(urlPrefill); else showHome();
})();
