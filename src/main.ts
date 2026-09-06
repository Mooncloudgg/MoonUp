import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, ask, message } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { TEXTS, ADDONS, API_CONFIG, AddonItem } from "./config";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { v4 as uuidv4 } from "uuid";

/* ── Helpers ──────────────────────────── */

interface VerifyResult {
  valid: boolean;
  status: number;
  message: string;
}

const DISCORD_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;
const EYE_OPEN_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_OFF_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
const TRASH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

function cleanVersion(v: string): string {
  if (!v) return "";
  return v.replace(/[^0-9.]/g, "").trim();
}

function isNewerVersion(local: string, remote: string): boolean {
  if (!remote || remote === "-" || remote === "Fehler" || remote === "Unknown") return false;
  if (!local || local === "Nicht installiert" || local.includes("fehlt")) return true;
  const l = cleanVersion(local);
  const r = cleanVersion(remote);
  if (!l || !r || l === r) return false;
  const lp = l.split(".").map(n => parseInt(n, 10) || 0);
  const rp = r.split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(lp.length, rp.length);
  for (let i = 0; i < len; i++) {
    if ((rp[i] || 0) > (lp[i] || 0)) return true;
    if ((rp[i] || 0) < (lp[i] || 0)) return false;
  }
  return false;
}

/* ── App Init ─────────────────────────── */

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const appWindow = getCurrentWindow();

    // Frameless window dragging
    const appHeader = document.querySelector(".app-header");
    if (appHeader) {
      appHeader.addEventListener("mousedown", async (e: Event) => {
        const me = e as MouseEvent;
        if (me.button === 0) {
          const target = me.target as HTMLElement;
          if (target.closest("button") || target.closest("input")) {
            return;
          }
          try {
            await appWindow.startDragging();
          } catch (err) {
            console.warn("startDragging error:", err);
          }
        }
      });
    }

    // DOM
    const pathDisplay        = document.getElementById("path-display")!;
    const changePathBtn      = document.getElementById("change-path-btn") as HTMLButtonElement;
    const openExplorerBtn    = document.getElementById("open-explorer-btn") as HTMLButtonElement;

    const loginView          = document.getElementById("login-view")!;
    const userView           = document.getElementById("user-view")!;
    const loginBtn           = document.getElementById("login-btn") as HTMLButtonElement;
    const loginStatus        = document.getElementById("login-status")!;
    const usernameLabel      = document.getElementById("username-label")!;
    const userAvatar         = document.getElementById("user-avatar")!;
    const logoutBtn          = document.getElementById("logout-btn") as HTMLButtonElement;

    const readinessCard      = document.getElementById("readiness-card")!;
    const readinessTitle     = document.getElementById("readiness-title")!;
    const readinessDesc      = document.getElementById("readiness-desc")!;

    const addonList          = document.getElementById("addon-list")!;
    const refreshBtn         = document.getElementById("refresh-btn") as HTMLButtonElement;
    const updateAllBtn       = document.getElementById("update-all-btn") as HTMLButtonElement;
    const statusArea         = document.getElementById("status-text")!;
    const bgUpdateStatusText = document.getElementById("bg-update-status-text");

    const openSettingsBtn    = document.getElementById("open-settings-btn") as HTMLButtonElement;
    const closeSettingsBtn   = document.getElementById("close-settings-btn")!;
    const settingsModal      = document.getElementById("settings-modal")!;
    const autostartCb        = document.getElementById("autostart-cb") as HTMLInputElement;
    const closeToTrayCb      = document.getElementById("close-to-tray-cb") as HTMLInputElement;
    const autoBgUpdateCb     = document.getElementById("auto-bg-update-cb") as HTMLInputElement;
    const autoBgSublist      = document.getElementById("auto-bg-sublist");
    const autoBgHint         = document.getElementById("auto-bg-hint");
    const appVersionLabel    = document.getElementById("app-version-label")!;
    const checkAppUpdateBtn  = document.getElementById("check-app-update-btn") as HTMLButtonElement;
    const deleteAllBtn       = document.getElementById("delete-all-addons-btn") as HTMLButtonElement;
    const windowMinimizeBtn  = document.getElementById("window-minimize-btn") as HTMLButtonElement;
    const windowCloseBtn     = document.getElementById("window-close-btn") as HTMLButtonElement;
    const notificationsCb   = document.getElementById("notifications-cb") as HTMLInputElement;

    // State
    let wowPath    = localStorage.getItem("moonup_wow_path") || "";
    let authToken  = localStorage.getItem("moonup_auth_token") || "";
    let authUser   = localStorage.getItem("moonup_auth_user") || "";
    let autoBgUpdate = localStorage.getItem("moonup_auto_bg_update") !== "false";
    let closeToTray  = localStorage.getItem("moonup_close_to_tray") !== "false";
    let notificationsEnabled = localStorage.getItem("moonup_notifications_enabled") !== "false";
    let loginPoll: number | null = null;
    let isChecking = false;

    // Anti-spam notification sets (per session)
    const notifiedAddonVersions = new Set<string>();
    let notifiedAppUpdate = "";

    async function notifyUser(title: string, body: string) {
      if (!notificationsEnabled) return;
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === "granted";
        }
        if (granted) {
          sendNotification({ title, body });
        }
      } catch (err) {
        console.warn("Notification failed:", err);
      }
    }

    // Addons, die automatisch im Hintergrund aktualisiert werden sollen
    let autoUpdateAddons: string[] = [];
    try {
      const saved = localStorage.getItem("moonup_auto_update_addons");
      if (saved) {
        autoUpdateAddons = JSON.parse(saved);
      } else {
        autoUpdateAddons = ["mooncloud-tools"];
      }
    } catch (_) {
      autoUpdateAddons = ["mooncloud-tools"];
    }

    // Sync initial close-to-tray state with backend
    try {
      await invoke("set_close_to_tray", { enabled: closeToTray });
    } catch (_) {}

    function updateBgStatus() {
      if (bgUpdateStatusText) {
        bgUpdateStatusText.textContent = autoBgUpdate ? "Addon-Auto-Update aktiv" : "Auto-Update inaktiv";
      }
    }
    updateBgStatus();

    async function syncBridge(enabled: boolean) {
      if (!wowPath) return;
      try {
        const mct = ADDONS.find(a => a.id === "mooncloud-tools");
        let isDev = false;
        if (mct) {
          const local = localStorage.getItem(`version_${mct.folder}`) || "";
          const remote = localStorage.getItem(`latest_${mct.folder}`) || "";
          if (local && remote && isNewerVersion(remote, local)) {
            isDev = true;
          }
        }
        await invoke("sync_addon_bridge", {
          path: wowPath,
          autoUpdateEnabled: enabled,
          isDevVersion: isDev,
        });
      } catch (err) {
        console.warn("sync_addon_bridge failed:", err);
      }
    }

    function renderAutoBgSublist() {
      if (autoBgSublist) {
        autoBgSublist.style.display = autoBgUpdate ? "flex" : "none";
      }
      if (autoBgHint) {
        autoBgHint.style.display = autoBgUpdate ? "block" : "none";
      }
      if (!autoBgUpdate || !autoBgSublist) return;

      autoBgSublist.innerHTML = ADDONS.map(addon => {
        const isChecked = autoUpdateAddons.includes(addon.id);
        return `
          <label class="sublist-item" title="Automatisch im Hintergrund aktualisieren, wenn ein Update vorliegt">
            <span>${addon.label}</span>
            <input type="checkbox" class="addon-auto-cb" data-id="${addon.id}" ${isChecked ? "checked" : ""}>
          </label>
        `;
      }).join("");

      autoBgSublist.querySelectorAll(".addon-auto-cb").forEach(cb => {
        cb.addEventListener("change", async e => {
          const target = e.target as HTMLInputElement;
          const id = target.dataset.id;
          if (!id) return;
          if (target.checked) {
            if (!autoUpdateAddons.includes(id)) autoUpdateAddons.push(id);
          } else {
            autoUpdateAddons = autoUpdateAddons.filter(x => x !== id);
          }
          localStorage.setItem("moonup_auto_update_addons", JSON.stringify(autoUpdateAddons));
          const isMctAuto = autoBgUpdate && autoUpdateAddons.includes("mooncloud-tools");
          await syncBridge(isMctAuto);
        });
      });
    }
    renderAutoBgSublist();
    syncBridge(autoBgUpdate && autoUpdateAddons.includes("mooncloud-tools"));

  // Ignorierte Addons (persistent in localStorage)
  let ignoredAddons: string[] = [];
  try {
    ignoredAddons = JSON.parse(localStorage.getItem("moonup_ignored_addons") || "[]");
  } catch (_) { ignoredAddons = []; }

  function isAddonIgnored(id: string): boolean {
    return ignoredAddons.includes(id);
  }

  function toggleIgnoreAddon(id: string) {
    if (ignoredAddons.includes(id)) {
      ignoredAddons = ignoredAddons.filter(x => x !== id);
    } else {
      ignoredAddons.push(id);
    }
    localStorage.setItem("moonup_ignored_addons", JSON.stringify(ignoredAddons));
    renderAddons();
  }

  /* ── Settings ─────────────────────── */

  if (windowMinimizeBtn) {
    windowMinimizeBtn.addEventListener("click", async () => {
      try { await invoke("minimize_window"); } catch (e) { console.error(e); }
    });
  }

  if (windowCloseBtn) {
    windowCloseBtn.addEventListener("click", async () => {
      try { await invoke("close_window"); } catch (e) { console.error(e); }
    });
  }

  openSettingsBtn.addEventListener("click", () => { settingsModal.style.display = "flex"; });
  closeSettingsBtn.addEventListener("click", () => { settingsModal.style.display = "none"; });
  window.addEventListener("click", e => { if (e.target === settingsModal) settingsModal.style.display = "none"; });

  try { autostartCb.checked = await isEnabled(); } catch (_) {}
  autostartCb.addEventListener("change", async () => {
    try { if (autostartCb.checked) await enable(); else await disable(); }
    catch (e) { autostartCb.checked = !autostartCb.checked; alert("Autostart-Fehler: " + e); }
  });

  closeToTrayCb.checked = closeToTray;
  closeToTrayCb.addEventListener("change", async () => {
    closeToTray = closeToTrayCb.checked;
    localStorage.setItem("moonup_close_to_tray", String(closeToTray));
    try {
      await invoke("set_close_to_tray", { enabled: closeToTray });
    } catch (err) {
      console.error("Set close to tray error:", err);
    }
  });

  if (notificationsCb) {
    notificationsCb.checked = notificationsEnabled;
    notificationsCb.addEventListener("change", () => {
      notificationsEnabled = notificationsCb.checked;
      localStorage.setItem("moonup_notifications_enabled", String(notificationsEnabled));
    });
  }

  autoBgUpdateCb.checked = autoBgUpdate;
  autoBgUpdateCb.addEventListener("change", async () => {
    autoBgUpdate = autoBgUpdateCb.checked;
    localStorage.setItem("moonup_auto_bg_update", String(autoBgUpdate));
    updateBgStatus();
    renderAutoBgSublist();
    const isMctAuto = autoBgUpdate && autoUpdateAddons.includes("mooncloud-tools");
    await syncBridge(isMctAuto);
    if (autoBgUpdate) {
      statusArea.textContent = "Auto-Update aktiv (in WoW /reload empfohlen).";
    }
  });

    if (appVersionLabel) {
      appVersionLabel.textContent = TEXTS.app.version;
    }

    if (checkAppUpdateBtn) {
      checkAppUpdateBtn.addEventListener("click", async () => {
        checkAppUpdateBtn.disabled = true;
        const origText = checkAppUpdateBtn.textContent;
        checkAppUpdateBtn.textContent = "...";
        try {
          await checkForAppUpdates(true);
        } finally {
          checkAppUpdateBtn.disabled = false;
          checkAppUpdateBtn.textContent = origText;
        }
      });
    }

    /* ── Session ──────────────────────── */

    async function validateSession(): Promise<boolean> {
      if (!authToken) return false;
      try {
        const res: VerifyResult = await invoke("verify_session", { token: authToken });
        if (!res.valid) { logout(true, res.message); return false; }
        return true;
      } catch (_) { return false; }
    }

    function logout(kicked = false, reason?: string) {
      if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
      authToken = "";
      authUser = "";
      localStorage.removeItem("moonup_auth_token");
      localStorage.removeItem("moonup_auth_user");
      ADDONS.forEach(a => localStorage.removeItem(`latest_${a.folder}`));
      updateAuthUI();
      if (kicked) {
        statusArea.textContent = reason || TEXTS.status.denied;
        alert(reason || "Sitzung beendet: Discord-Rolle fehlt.");
      }
    }

    /* ── Login ────────────────────────── */

    function setLoginBtnDefault() {
      loginBtn.disabled = false;
      loginBtn.innerHTML = `${DISCORD_SVG}<span>Login</span>`;
      loginStatus.style.display = "none";
    }

    async function startLogin() {
      loginBtn.disabled = true;
      loginBtn.innerHTML = `<span class="loader"></span><span>Warten...</span>`;

      loginStatus.style.display = "block";
      loginStatus.innerHTML = `Im Browser bestätigen... <span id="cancel-login" style="color:var(--danger); cursor:pointer; text-decoration:underline; margin-left:4px;">Abbrechen</span>`;

      const deviceId = uuidv4();

      try {
        await shellOpen(`${API_CONFIG.authLoginUrl}?device_id=${deviceId}`);
      } catch (err) {
        console.error("Browser open failed:", err);
        statusArea.textContent = "Browser konnte nicht geöffnet werden.";
        setLoginBtnDefault();
        return;
      }

      // Cancel-Link handler
      setTimeout(() => {
        document.getElementById("cancel-login")?.addEventListener("click", () => {
          if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
          setLoginBtnDefault();
        });
      }, 150);

      // Poll for auth result
      loginPoll = window.setInterval(async () => {
        try {
          const res = await fetch(`${API_CONFIG.authCheckUrl}?device_id=${deviceId}`);
          if (!res.ok) return;
          const data = await res.json();

          if (data.status === "success") {
            if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
            authToken = data.token;
            authUser = data.username || "Mitglied";
            localStorage.setItem("moonup_auth_token", authToken);
            localStorage.setItem("moonup_auth_user", authUser);
            setLoginBtnDefault();
            updateAuthUI();
          } else if (data.status === "denied") {
            if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
            alert("Zugriff verweigert: Dir fehlt die erforderliche Discord-Rolle.");
            setLoginBtnDefault();
          }
        } catch (_) { /* still polling */ }
      }, 2000);
    }

    /* ── App Updater ──────────────────── */

    async function checkForAppUpdates(manual = false) {
      try {
        console.log("[Updater] Checking for Moonup updates...");
        const update = await check();
        console.log("[Updater] Check result:", update);
        if (update) {
          if (notifiedAppUpdate !== update.version) {
            notifiedAppUpdate = update.version;
            await notifyUser(
              "Moonup • Update verfügbar",
              `Moonup v${update.version} ist verfügbar! Klicke zum Installieren.`
            );
          }
          const yes = await ask(
            `Eine neue Version (${update.version}) von Moonup ist verfügbar!\n\nMöchtest du das Update jetzt installieren?`,
            { title: 'Update verfügbar', kind: 'info' }
          );
          if (yes) {
            statusArea.textContent = "Lade Moonup Update...";
            let downloaded = 0;
            let contentLength = 0;
            await update.downloadAndInstall((event) => {
              switch (event.event) {
                case 'Started':
                  contentLength = event.data.contentLength || 0;
                  statusArea.textContent = `Lade Update (0%)`;
                  break;
                case 'Progress':
                  downloaded += event.data.chunkLength;
                  if (contentLength > 0) {
                     const pct = Math.round((downloaded / contentLength) * 100);
                     statusArea.textContent = `Lade Update (${pct}%)`;
                  }
                  break;
                case 'Finished':
                  statusArea.textContent = "Update wird installiert...";
                  break;
              }
            });
            statusArea.textContent = "Update abgeschlossen. Neustart...";
            await relaunch();
          }
        } else if (manual) {
          await message("Moonup ist auf dem neuesten Stand (" + TEXTS.app.version + ") ✓", {
            title: "Kein Update verfügbar",
            kind: "info",
          });
        }
      } catch (err) {
        console.error("App Update Check fehlgeschlagen:", err);
        if (manual) {
          await message("Fehler beim Prüfen auf Updates: " + err, {
            title: "Fehler",
            kind: "error",
          });
        }
      }
    }

    /* ── WoW Path ─────────────────────── */

    function renderPath() {
      if (!wowPath) {
        pathDisplay.innerHTML = `<span class="path-flavor-tag missing">!</span><span class="path-text">WoW-Pfad auswählen...</span>`;
        pathDisplay.title = "Klicken, um deinen WoW-Ordner auszuwählen";
        return;
      }
      let flavor = "WoW";
      const p = wowPath.replace(/\\/g, "/");
      if (p.includes("/_retail_")) flavor = "_retail_";
      else if (p.includes("/_classic_era_")) flavor = "_classic_era_";
      else if (p.includes("/_classic_")) flavor = "_classic_";
      else if (p.includes("/_ptr_")) flavor = "_ptr_";

      const parts = wowPath.split(/[\\/]/).filter(Boolean);
      const displayPath = parts.length > 3 ? ".../" + parts.slice(-3).join("/") : wowPath;

      pathDisplay.innerHTML = `<span class="path-flavor-tag">${flavor}</span><span class="path-text">${displayPath}</span>`;
      pathDisplay.title = wowPath;
    }

    async function initPath() {
      if (!wowPath) {
        renderPath();
        statusArea.textContent = "Bitte WoW-Pfad manuell auswählen.";

        setTimeout(async () => {
          if (!wowPath) {
            await message(
              "Willkommen bei Moonup!\n\nBitte wähle im nächsten Schritt deinen World of Warcraft Ordner aus (z.B. World of Warcraft/_retail_ oder Interface/AddOns).",
              { title: "WoW-Pfad auswählen", kind: "info" }
            );
            await selectPath();
          }
        }, 300);
      } else {
        renderPath();
      }
    }

    async function selectPath() {
      try {
        const sel = await open({
          directory: true,
          title: "World of Warcraft Ordner auswählen (_retail_ oder Interface/AddOns)"
        });
        if (sel && typeof sel === "string") {
          wowPath = sel;
          localStorage.setItem("moonup_wow_path", sel);
          renderPath();
          statusArea.textContent = "WoW-Pfad festgelegt.";
          await checkUpdates();
        }
      } catch (err) {
        console.error("Path selection error:", err);
      }
    }

    async function openExplorer() {
      if (!wowPath) { alert("Bitte zuerst WoW-Pfad auswählen."); return; }
      try { await invoke("open_in_explorer", { path: wowPath }); } catch (e) { alert("Fehler: " + e); }
    }

    /* ── Update Check ─────────────────── */

    let updateTimer: number | null = null;
    function resetAutoUpdateTimer() {
      if (updateTimer) window.clearInterval(updateTimer);
      updateTimer = window.setInterval(() => {
        if (!isChecking && wowPath) {
          checkUpdates();
        }
      }, 3 * 60 * 1000); // Alle 3 Minuten prüfen
    }

    async function checkUpdates() {
      if (isChecking || !wowPath) return;
      isChecking = true;
      statusArea.textContent = TEXTS.status.searching;
      resetAutoUpdateTimer();

      try {
        await Promise.all(ADDONS.map(async (addon) => {
          try {
            // IMMER die lokal installierte Version ermitteln (auch ohne Auth)
            const localVer: string = await invoke("get_installed_version", {
              path: wowPath, folder: addon.folder, search: addon.search,
            });
            localStorage.setItem(`version_${addon.folder}`, String(localVer));

            // Nur wenn eingeloggt remote nach Updates suchen
            if (authToken) {
              const remoteVer: string = await invoke("check_for_updates", {
                token: authToken, repo: addon.repo, provider: addon.provider,
              });

              if (remoteVer === "AUTH_ERROR") throw new Error("AUTH_ERROR");
              localStorage.setItem(`latest_${addon.folder}`, remoteVer);
            }
          } catch (e: any) {
            console.error(`Check ${addon.label}:`, e);
            if (String(e).includes("AUTH_ERROR") || String(e).includes("403")) {
              throw new Error("AUTH_ERROR");
            }
          }
        }));
      } catch (e: any) {
        if (e.message === "AUTH_ERROR") {
          logout(true);
          isChecking = false;
          return;
        }
      }

      isChecking = false;
      statusArea.textContent = TEXTS.status.ready;
      renderAddons();

      // 1. Silent background auto-update für ausgewählte Addons (nur wenn eingeloggt)
      if (autoBgUpdate && authToken && wowPath) {
        const targets = ADDONS.filter(a => autoUpdateAddons.includes(a.id) && !isAddonIgnored(a.id));
        let anyUpdated = false;
        for (const addon of targets) {
          const local = localStorage.getItem(`version_${addon.folder}`);
          const remote = localStorage.getItem(`latest_${addon.folder}`);
          const installed = local && !["Nicht installiert", "Unbekannt", "-"].includes(local);
          if (installed && remote && isNewerVersion(local, remote)) {
            try {
              console.log(`[AutoUpdate] Starting background update for ${addon.label}...`);
              await invoke("install_addon", {
                token: authToken,
                repo: addon.repo,
                name: addon.folder,
                path: wowPath,
                provider: addon.provider,
                directUrl: addon.directUrl || null,
              });
              const newLocal: string = await invoke("get_installed_version", {
                path: wowPath,
                folder: addon.folder,
                search: addon.search,
              });
              localStorage.setItem(`version_${addon.folder}`, String(newLocal));
              console.log(`[AutoUpdate] ${addon.label} updated to ${newLocal}`);
              anyUpdated = true;

              // Notification Logik bei Auto-Update:
              const isWoW = await invoke<boolean>("is_wow_running");
              if (isWoW) {
                // Fall 1: Auto Update aktiv & WoW läuft -> Gib /reload im Spiel ein
                await notifyUser(
                  "Moonup • Addon aktualisiert",
                  `${addon.label} wurde im Hintergrund aktualisiert. Gib bitte /reload im Spiel ein.`
                );
              }
              // Fall 2: Auto Update aktiv & WoW läuft NICHT -> Kein Hinweis (stilles Update!)
            } catch (err) {
              console.warn(`[AutoUpdate] Background update for ${addon.label} failed:`, err);
            }
          }
        }
        if (anyUpdated) {
          renderAddons();
        }
      }

      // 2. Notification Logik für Addons OHNE Auto-Update (oder ausgeloggt)
      const manualTargets = ADDONS.filter(a => {
        const isAuto = autoBgUpdate && autoUpdateAddons.includes(a.id) && !isAddonIgnored(a.id) && !!authToken;
        return !isAuto;
      });

      for (const addon of manualTargets) {
        const local = localStorage.getItem(`version_${addon.folder}`);
        const remote = localStorage.getItem(`latest_${addon.folder}`);
        const installed = local && !["Nicht installiert", "Unbekannt", "-"].includes(local);
        if (installed && remote && isNewerVersion(local, remote)) {
          const notifyKey = `${addon.id}@${remote}`;
          if (!notifiedAddonVersions.has(notifyKey)) {
            notifiedAddonVersions.add(notifyKey);
            const isWoW = await invoke<boolean>("is_wow_running");
            if (isWoW) {
              // Fall 3: Kein Auto Update & WoW läuft -> Bitte Update herunterladen und /reload
              await notifyUser(
                "Moonup • Update verfügbar",
                `Bitte Update für ${addon.label} (v${remote}) herunterladen und /reload eingeben.`
              );
            } else {
              // Fall 4: Kein Auto Update & WoW läuft NICHT -> Eine neue Version ist verfügbar!
              await notifyUser(
                "Moonup • Update verfügbar",
                `Eine neue Version von ${addon.label} (v${remote}) ist verfügbar!`
              );
            }
          }
        }
      }

      // Bridge synchronisieren (aktualisiert auch Entwickler-Status)
      await syncBridge(autoBgUpdate && autoUpdateAddons.includes("mooncloud-tools"));
    }

    /* ── Install / Update ─────────────── */

    async function installAddon(addon: AddonItem, btn: HTMLButtonElement) {
      if (!authToken) { alert("Bitte zuerst einloggen."); return; }
      if (!wowPath) { alert("Bitte WoW-Pfad wählen."); return; }

      const ok = await validateSession();
      if (!ok) return;

      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="loader"></span>`;
      statusArea.textContent = `${TEXTS.status.installing}${addon.label}`;

      try {
        await invoke("install_addon", {
          token: authToken, repo: addon.repo, name: addon.folder,
          path: wowPath, provider: addon.provider, directUrl: addon.directUrl || null,
        });
        statusArea.textContent = `${addon.label} ${TEXTS.status.done}`;
        await checkUpdates();
      } catch (e: any) {
        if (String(e).includes("AUTH_ERROR") || String(e).includes("403")) { logout(true); }
        else { alert(`Fehler bei ${addon.label}: ${e}`); }
        btn.disabled = false;
        btn.innerHTML = origHtml;
        statusArea.textContent = TEXTS.status.checkError;
      }
    }

    /* ── Uninstall (Funktioniert auch ohne Auth/Logged out!) ── */

    async function uninstallAddon(addon: AddonItem) {
      if (!wowPath) return;
      if (await ask(TEXTS.dialogs.deleteConfirm(addon.label), { kind: "warning" })) {
        try {
          await invoke("uninstall_addon", { path: wowPath, name: addon.folder });
          localStorage.setItem(`version_${addon.folder}`, "Nicht installiert");
          statusArea.textContent = `${addon.label} ${TEXTS.status.deleted}`;
          renderAddons();
        } catch (e) { alert("Fehler: " + e); }
      }
    }

    /* ── Render ────────────────────────── */

    function renderAddons() {
      let pendingCount = 0;
      let missingCount = 0;

      const html = ADDONS.map(addon => {
        let local = localStorage.getItem(`version_${addon.folder}`);
        if (!local || local === "Ordner fehlt") local = "Nicht installiert";

        const remote = localStorage.getItem(`latest_${addon.folder}`) || "-";
        const installed = !["Nicht installiert", "Unbekannt", "-"].includes(local);
        const hasUpdate = installed && !!authToken && isNewerVersion(local, remote);
        const ignored = isAddonIgnored(addon.id);

        if (!ignored) {
          if (hasUpdate) pendingCount++;
          if (!installed) missingCount++;
        }

        // Action button
        let action = "";
        if (!authToken) {
          action = `<span class="badge-locked" title="Login erforderlich für Updates">🔒</span>`;
        } else if (ignored) {
          action = `<button class="btn-ignored-pill unignore-btn" data-id="${addon.id}" title="Addon ist ignoriert. Klicken zum Aktivieren.">Ignoriert</button>`;
        } else if (!installed) {
          action = `<button class="btn-install-card install-btn" data-id="${addon.id}">Installieren</button>`;
        } else if (hasUpdate) {
          action = `<button class="btn-update-card install-btn" data-id="${addon.id}">Update</button>`;
        } else {
          action = `<span class="badge-ok">Aktuell</span>`;
        }

        // Version display
        let versionHtml = "";
        if (!installed) {
          versionHtml = `<span class="v-missing">Nicht installiert</span>`;
        } else if (hasUpdate) {
          versionHtml = `<span class="v-cur">${local}</span><span class="v-arrow">→</span><span class="v-next">${remote}</span>`;
        } else if (ignored) {
          versionHtml = `<span class="v-cur">${local} (Ignoriert)</span>`;
        } else {
          versionHtml = `<span class="v-cur">${local}</span>`;
        }

        // Icon with fallback
        const icon = addon.icon
          ? `<img src="${addon.icon}" class="addon-logo-img" alt="" onerror="this.outerHTML='<div class=\\'addon-logo\\'>${addon.fallbackInitials || "?"}</div>'">`
          : `<div class="addon-logo">${addon.fallbackInitials || "?"}</div>`;

        // Ignore/Pause button (nur wenn eingeloggt)
        const ignoreBtn = authToken
          ? `<button class="btn-card-action ignore-btn ${ignored ? "is-ignored is-paused" : ""}" data-id="${addon.id}" title="${ignored ? "Ignorieren aufheben (Addon wieder verwalten)" : "Addon ignorieren"}">${ignored ? EYE_OFF_SVG : EYE_OPEN_SVG}</button>`
          : "";

        // Löschen-Button (WICHTIG: Immer verfügbar, wenn Addon installiert ist, auch ausgeloggt!)
        const deleteBtn = installed
          ? `<button class="btn-card-action btn-delete del-btn" data-id="${addon.id}" title="${addon.label} deinstallieren">${TRASH_SVG}</button>`
          : "";

        return `
          <div class="addon-card ${ignored ? "is-paused" : ""}">
            <div class="card-left">
              ${icon}
              <div class="card-info">
                <span class="card-name">${addon.label}</span>
                <div class="card-version-row">
                  ${versionHtml}
                </div>
              </div>
            </div>
            <div class="card-right">
              ${action}
              ${ignoreBtn}
              ${deleteBtn}
            </div>
          </div>`;
      }).join("");

      addonList.innerHTML = html;

      // Addon Count Label
      const countLabel = document.getElementById("addon-count-label");
      if (countLabel) countLabel.textContent = `${ADDONS.length} Addons`;

      // Batch button
      if (!authToken) {
        updateAllBtn.disabled = true;
        updateAllBtn.innerHTML = `<span>Login erforderlich</span>`;
      } else if (!wowPath) {
        updateAllBtn.disabled = true;
        updateAllBtn.innerHTML = `<span>Bitte WoW-Pfad wählen</span>`;
      } else if (pendingCount > 0) {
        updateAllBtn.disabled = false;
        updateAllBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 11 12 6 17 11"></polyline><polyline points="7 17 12 12 17 17"></polyline></svg><span>${pendingCount} Update(s) installieren</span>`;
      } else if (missingCount > 0) {
        updateAllBtn.disabled = false;
        updateAllBtn.innerHTML = `<span>Alle installieren (${missingCount})</span>`;
      } else {
        updateAllBtn.disabled = true;
        updateAllBtn.innerHTML = `<span>Alle Addons aktuell ✓</span>`;
      }

      // Status mini bar
      if (!authToken) {
        readinessCard.className = "status-mini-bar noauth";
        readinessTitle.textContent = "Login erforderlich";
        readinessDesc.textContent = "Für Updates anmelden";
      } else if (!wowPath) {
        readinessCard.className = "status-mini-bar missing";
        readinessTitle.textContent = "WoW-Pfad fehlt";
        readinessDesc.textContent = "Pfad auswählen";
      } else if (missingCount > 0) {
        readinessCard.className = "status-mini-bar missing";
        readinessTitle.textContent = `${missingCount} Addon(s) fehlen`;
        readinessDesc.textContent = "Installation empfohlen";
      } else if (pendingCount > 0) {
        readinessCard.className = "status-mini-bar updates";
        readinessTitle.textContent = `${pendingCount} Update(s) verfügbar`;
        readinessDesc.textContent = "Bereit zum Aktualisieren";
      } else {
        readinessCard.className = "status-mini-bar ready";
        readinessTitle.textContent = "Alles aktuell";
        readinessDesc.textContent = "Bereit für WoW";
      }

      // Dynamic event listeners
      document.querySelectorAll(".install-btn").forEach(btn => {
        btn.addEventListener("click", e => {
          const t = e.currentTarget as HTMLButtonElement;
          const a = ADDONS.find(x => x.id === t.dataset.id);
          if (a) installAddon(a, t);
        });
      });
      document.querySelectorAll(".ignore-btn").forEach(btn => {
        btn.addEventListener("click", e => {
          const t = e.currentTarget as HTMLButtonElement;
          const id = t.dataset.id;
          if (id) toggleIgnoreAddon(id);
        });
      });
      document.querySelectorAll(".unignore-btn").forEach(btn => {
        btn.addEventListener("click", e => {
          const t = e.currentTarget as HTMLButtonElement;
          const id = t.dataset.id;
          if (id) toggleIgnoreAddon(id);
        });
      });
      document.querySelectorAll(".del-btn").forEach(btn => {
        btn.addEventListener("click", e => {
          const t = e.currentTarget as HTMLButtonElement;
          const a = ADDONS.find(x => x.id === t.dataset.id);
          if (a) uninstallAddon(a);
        });
      });
    }

    /* ── Auth UI ──────────────────────── */

    function updateAuthUI() {
      if (authToken) {
        loginView.style.display = "none";
        userView.style.display = "flex";
        usernameLabel.textContent = authUser || "Mitglied";
        userAvatar.textContent = (authUser || "M").charAt(0).toUpperCase();
      } else {
        loginView.style.display = "flex";
        userView.style.display = "none";
      }
      renderAddons();
      if (wowPath) checkUpdates();
    }

    /* ── Events ───────────────────────── */

    loginBtn.addEventListener("click", startLogin);
    logoutBtn.addEventListener("click", () => logout(false));
    refreshBtn.addEventListener("click", checkUpdates);
    changePathBtn.addEventListener("click", selectPath);
    pathDisplay.addEventListener("click", selectPath);
    openExplorerBtn.addEventListener("click", openExplorer);

    updateAllBtn.addEventListener("click", async () => {
      if (!authToken || !wowPath) return;
      const ok = await validateSession();
      if (!ok) return;

      updateAllBtn.disabled = true;
      updateAllBtn.innerHTML = `<span class="loader"></span> Aktualisiere...`;

      for (const addon of ADDONS) {
        if (isAddonIgnored(addon.id)) continue;

        const local = localStorage.getItem(`version_${addon.folder}`) || "";
        const remote = localStorage.getItem(`latest_${addon.folder}`) || "";
        const inst = !["Nicht installiert", "Unbekannt", "-"].includes(local);

        if (!inst || isNewerVersion(local, remote)) {
          statusArea.textContent = `${TEXTS.status.installing}${addon.label}...`;
          try {
            await invoke("install_addon", {
              token: authToken, repo: addon.repo, name: addon.folder,
              path: wowPath, provider: addon.provider, directUrl: addon.directUrl || null,
            });
          } catch (e) { console.error(`Batch: ${addon.label}`, e); }
        }
      }

      await checkUpdates();
      statusArea.textContent = TEXTS.status.done;
    });

    deleteAllBtn.addEventListener("click", async () => {
      if (!wowPath) { alert("Bitte WoW-Pfad wählen."); return; }
      if (await ask(TEXTS.dialogs.deleteAllConfirm, { kind: "warning" })) {
        for (const addon of ADDONS) {
          try {
            await invoke("uninstall_addon", { path: wowPath, name: addon.folder });
            localStorage.setItem(`version_${addon.folder}`, "Nicht installiert");
          } catch (_) {}
        }
        renderAddons();
        settingsModal.style.display = "none";
        statusArea.textContent = "Alle Addons deinstalliert.";
      }
    });

    /* ── Boot ─────────────────────────── */

    await initPath();
    updateAuthUI();
    checkForAppUpdates();

  } catch (err) {
    console.error("Init error:", err);
  }
});