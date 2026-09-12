import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save, ask, message } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { TEXTS, ADDONS, API_CONFIG, AddonItem } from "./config";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { v4 as uuidv4 } from "uuid";
// @ts-ignore
import moonupLogoUrl from "./assets/Moonup_logo.png";
// @ts-ignore
import timelineLogoUrl from "./assets/timeline_reminders.png";

/* ── Self-Healing Icon Handler ────────── */
(window as any).healAddonIcon = async (addonId: string, repo: string, imgEl: HTMLImageElement, fallbackInitials: string) => {
  if (imgEl.dataset.healingAttempted) {
    imgEl.outerHTML = `<div class="addon-logo">${fallbackInitials || "?"}</div>`;
    return;
  }
  imgEl.dataset.healingAttempted = "true";

  const addon = ADDONS.find(a => a.id === addonId);
  if (!addon || addon.provider !== "curseforge") {
    imgEl.outerHTML = `<div class="addon-logo">${fallbackInitials || "?"}</div>`;
    return;
  }

  try {
    console.log(`[SelfHealing] Attempting to heal icon for ${addonId} (repo: ${repo})...`);
    const res = await fetch(`https://api.curse.tools/v1/cf/mods/${repo}`);
    if (res.ok) {
      const data = await res.json();
      const newUrl = data?.data?.logo?.thumbnailUrl || data?.data?.logo?.url;
      if (newUrl) {
        console.log(`[SelfHealing] Healed icon for ${addonId}: ${newUrl}`);
        localStorage.setItem(`healed_icon_${addonId}`, newUrl);
        imgEl.src = newUrl;
        return;
      }
    }
  } catch (e) {
    console.warn(`[SelfHealing] Failed to resolve icon for ${addonId}:`, e);
  }

  imgEl.outerHTML = `<div class="addon-logo">${fallbackInitials || "?"}</div>`;
};

/* ── Helpers ──────────────────────────── */

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

interface VerifyResult {
  valid: boolean;
  status: number;
  message: string;
}

interface AddonProgressPayload {
  id: string;
  stage: string;
  downloaded: number;
  total: number;
  percent: number;
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

function formatLastUpdated(timestampStr: string | null): string {
  if (!timestampStr) return "";
  const ts = parseInt(timestampStr, 10);
  if (isNaN(ts) || ts <= 0) return "";

  const date = new Date(ts);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes} Uhr`;

  if (isToday) {
    return `Heute, ${timeStr}`;
  } else if (isYesterday) {
    return `Gestern, ${timeStr}`;
  } else {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}.${date.getFullYear()}`;
  }
}

/* ── App Init ─────────────────────────── */

window.addEventListener("DOMContentLoaded", async () => {
  try {


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
    const startMinimizedItem = document.getElementById("start-minimized-item") as HTMLDivElement;
    const startMinimizedCb   = document.getElementById("start-minimized-cb") as HTMLInputElement;
    const exportBackupBtn    = document.getElementById("export-backup-btn") as HTMLButtonElement;
    const importBackupBtn    = document.getElementById("import-backup-btn") as HTMLButtonElement;

    // Top-Bar In-App Update Banner
    const topAppUpdateBanner       = document.getElementById("top-app-update-banner") as HTMLDivElement;
    const topAppUpdateMsg          = document.getElementById("top-app-update-msg") as HTMLSpanElement;
    const topAppUpdateBadge        = document.getElementById("top-app-update-badge") as HTMLSpanElement;
    const topAppUpdateBtn          = document.getElementById("top-app-update-btn") as HTMLButtonElement;
    const topAppUpdateBtnText      = document.getElementById("top-app-update-btn-text") as HTMLSpanElement;
    const topAppUpdateDismiss      = document.getElementById("top-app-update-dismiss") as HTMLButtonElement;
    const settingsGearBadge        = document.getElementById("settings-gear-badge") as HTMLSpanElement;

    // Settings Inline Version Update Elements
    const settingsInlineUpdatePill = document.getElementById("settings-inline-update-pill") as HTMLSpanElement;
    const settingsInlineUpdateText = document.getElementById("settings-inline-update-text") as HTMLSpanElement;
    const settingsInstallUpdateBtn = document.getElementById("settings-install-update-btn") as HTMLButtonElement;

    // Context Menu DOM
    const contextMenu    = document.getElementById("addon-context-menu") as HTMLDivElement;
    const ctxExplorer    = document.getElementById("ctx-explorer") as HTMLDivElement;
    const ctxReinstall   = document.getElementById("ctx-reinstall") as HTMLDivElement;
    const ctxIgnore      = document.getElementById("ctx-ignore") as HTMLDivElement;
    const ctxIgnoreLabel = document.getElementById("ctx-ignore-label") as HTMLSpanElement;
    const ctxDelete      = document.getElementById("ctx-delete") as HTMLDivElement;
    let activeContextAddon: AddonItem | null = null;

    function hideContextMenu() {
      if (contextMenu) {
        contextMenu.style.display = "none";
        activeContextAddon = null;
      }
    }

    // State
    let wowPath    = localStorage.getItem("moonup_wow_path") || "";
    let authToken  = localStorage.getItem("moonup_auth_token") || "";
    let authUser   = localStorage.getItem("moonup_auth_user") || "";
    let autoBgUpdate = localStorage.getItem("moonup_auto_bg_update") !== "false";
    let closeToTray  = localStorage.getItem("moonup_close_to_tray") !== "false";
    let startMinimized = localStorage.getItem("moonup_start_minimized") === "true";
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

    // Sync initial close-to-tray & start-minimized state with backend
    try {
      await invoke("set_close_to_tray", { enabled: closeToTray });
      await invoke("set_start_minimized", { enabled: startMinimized });
    } catch (_) {}

    // Listen to real-time Addon Download & Unpack progress
    await listen<AddonProgressPayload>("addon-progress", (event) => {
      const payload = event.payload;
      const card = addonList.querySelector(`.addon-card[data-id="${payload.id}"]`);
      const btn = card?.querySelector(".install-btn") as HTMLButtonElement | null;
      if (!btn) return;

      if (payload.stage === "downloading") {
        btn.textContent = `Lade ${payload.percent}%`;
        statusArea.textContent = `Lade ${payload.id} herunter (${payload.percent}%)...`;
      } else if (payload.stage === "unpacking") {
        btn.textContent = "Entpacken...";
        statusArea.textContent = `Entpacke ${payload.id}...`;
      }
    });

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

  const updateAutostartSublist = () => {
    if (startMinimizedItem) {
      startMinimizedItem.style.display = autostartCb.checked ? "flex" : "none";
    }
  };

  try {
    autostartCb.checked = await isEnabled();
    updateAutostartSublist();
  } catch (_) {}

  autostartCb.addEventListener("change", async () => {
    try {
      if (autostartCb.checked) await enable(); else await disable();
      updateAutostartSublist();
    } catch (e) {
      autostartCb.checked = !autostartCb.checked;
      alert("Autostart-Fehler: " + e);
      updateAutostartSublist();
    }
  });

  if (startMinimizedCb) {
    startMinimizedCb.checked = startMinimized;
    startMinimizedCb.addEventListener("change", async () => {
      startMinimized = startMinimizedCb.checked;
      localStorage.setItem("moonup_start_minimized", String(startMinimized));
      try {
        await invoke("set_start_minimized", { enabled: startMinimized });
      } catch (err) {
        console.error("Set start minimized error:", err);
      }
    });
  }

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

  if (exportBackupBtn) {
    exportBackupBtn.addEventListener("click", async () => {
      if (!wowPath) {
        await message("Bitte wähle zuerst deinen WoW-Pfad aus.", { title: "Moonup", kind: "warning" });
        return;
      }

    function showWowRunningDialog(): Promise<boolean> {
      return new Promise((resolve) => {
        const modal = document.getElementById("wow-running-modal");
        const cancelBtn = document.getElementById("wow-running-cancel");
        const proceedBtn = document.getElementById("wow-running-proceed");
        if (!modal || !cancelBtn || !proceedBtn) {
          resolve(true);
          return;
        }

        modal.style.display = "flex";

        const cleanup = (result: boolean) => {
          modal.style.display = "none";
          cancelBtn.removeEventListener("click", onCancel);
          proceedBtn.removeEventListener("click", onProceed);
          modal.removeEventListener("click", onBackdrop);
          resolve(result);
        };

        const onCancel = () => cleanup(false);
        const onProceed = () => cleanup(true);
        const onBackdrop = (e: MouseEvent) => {
          if (e.target === modal) cleanup(false);
        };

        cancelBtn.addEventListener("click", onCancel);
        proceedBtn.addEventListener("click", onProceed);
        modal.addEventListener("click", onBackdrop);
      });
    }

    // Prüfen, ob WoW noch läuft (Warnung vor ungespeicherten SavedVariables im App-Design)
    try {
      const isWoW = await invoke<boolean>("is_wow_running");
      if (isWoW) {
        const proceed = await showWowRunningDialog();
        if (!proceed) return;
      }
    } catch (e) {
      console.warn("is_wow_running check failed:", e);
    }


      const dateStr = new Date().toISOString().slice(0, 10);
      const defaultName = `Moonup_WoW_Backup_${dateStr}.zip`;

      try {
        const filePath = await save({
          title: "WoW Interface & WTF Backup speichern",
          defaultPath: defaultName,
          filters: [{ name: "ZIP-Archiv", extensions: ["zip"] }]
        });

        if (!filePath) return;

        exportBackupBtn.disabled = true;
        exportBackupBtn.textContent = "Erstelle ZIP...";
        statusArea.textContent = "Erstelle Backup von Interface und WTF...";

        const bytes: number = await invoke("export_wow_backup", {
          wowPath: wowPath,
          targetZipPath: filePath
        });
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        statusArea.textContent = `Backup erfolgreich erstellt (${mb} MB) ✓`;
        await message(`Backup erfolgreich gespeichert!\n\nDatei: ${filePath}\nGröße: ${mb} MB`, { title: "Moonup Backup", kind: "info" });
      } catch (err: any) {
        console.error("Backup Fehler:", err);
        await message("Fehler beim Erstellen des Backups: " + err, { title: "Moonup Backup Fehler", kind: "error" });
        statusArea.textContent = "Backup fehlgeschlagen.";
      } finally {
        exportBackupBtn.disabled = false;
        exportBackupBtn.textContent = "Exportieren";
      }
    });
  }

  if (importBackupBtn) {
    importBackupBtn.addEventListener("click", async () => {
      if (!wowPath) {
        await message("Bitte wähle zuerst deinen WoW-Pfad aus.", { title: "Moonup", kind: "warning" });
        return;
      }

      function showWowRunningDialog(): Promise<boolean> {
        return new Promise((resolve) => {
          const modal = document.getElementById("wow-running-modal");
          const cancelBtn = document.getElementById("wow-running-cancel");
          const proceedBtn = document.getElementById("wow-running-proceed");
          if (!modal || !cancelBtn || !proceedBtn) {
            resolve(true);
            return;
          }

          modal.style.display = "flex";

          const cleanup = (result: boolean) => {
            modal.style.display = "none";
            cancelBtn.removeEventListener("click", onCancel);
            proceedBtn.removeEventListener("click", onProceed);
            modal.removeEventListener("click", onBackdrop);
            resolve(result);
          };

          const onCancel = () => cleanup(false);
          const onProceed = () => cleanup(true);
          const onBackdrop = (e: MouseEvent) => {
            if (e.target === modal) cleanup(false);
          };

          cancelBtn.addEventListener("click", onCancel);
          proceedBtn.addEventListener("click", onProceed);
          modal.addEventListener("click", onBackdrop);
        });
      }

      // Prüfen, ob WoW noch läuft
      try {
        const isWoW = await invoke<boolean>("is_wow_running");
        if (isWoW) {
          const proceed = await showWowRunningDialog();
          if (!proceed) return;
        }
      } catch (e) {
        console.warn("is_wow_running check failed:", e);
      }

      try {
        const selected = await open({
          title: "WoW UI-Backup ZIP-Archiv auswählen",
          multiple: false,
          directory: false,
          filters: [{ name: "ZIP-Archiv", extensions: ["zip"] }]
        });

        if (!selected) return;
        const zipPath = typeof selected === "string" ? selected : (selected as any).path;
        if (!zipPath) return;

        const confirmed = await ask(
          "Möchtest du dieses Backup wirklich wiederherstellen?\n\nBestehende Addons und WTF-Einstellungen im gewählten WoW-Ordner werden dabei überschrieben bzw. aktualisiert.",
          { title: "WoW UI-Backup wiederherstellen", kind: "warning" }
        );
        if (!confirmed) return;

        importBackupBtn.disabled = true;
        importBackupBtn.textContent = "Entpacke...";
        statusArea.textContent = "Stelle WoW UI-Backup wieder her...";

        const result: { files_restored: number; total_bytes: number } = await invoke("restore_wow_backup", {
          wowPath: wowPath,
          zipPath: zipPath,
        });

        const mb = (result.total_bytes / (1024 * 1024)).toFixed(1);
        statusArea.textContent = `Backup erfolgreich wiederhergestellt (${result.files_restored} Dateien, ${mb} MB) ✓`;
        await message(
          `Backup erfolgreich wiederhergestellt!\n\nDateien: ${result.files_restored}\nEntpackt: ${mb} MB`,
          { title: "Moonup Backup", kind: "info" }
        );
        await checkUpdates();
      } catch (err: any) {
        console.error("Restore Fehler:", err);
        await message("Fehler beim Wiederherstellen des Backups:\n" + err, { title: "Moonup Backup Fehler", kind: "error" });
        statusArea.textContent = "Wiederherstellung fehlgeschlagen.";
      } finally {
        importBackupBtn.disabled = false;
        importBackupBtn.textContent = "Wiederherstellen";
      }
    });
  }


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
        const origHtml = "Prüfen";
        checkAppUpdateBtn.innerHTML = "...";
        try {
          const update = await checkForAppUpdates(true);
          if (update) {
            return;
          } else {
            checkAppUpdateBtn.innerHTML = `<span style="display:inline-flex; align-items:center; gap:4px; line-height:1;">Aktuell <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg></span>`;
          }
        } catch (_) {
          checkAppUpdateBtn.innerHTML = "Fehler";
        }
        setTimeout(() => {
          if (!pendingAppUpdate) {
            checkAppUpdateBtn.disabled = false;
            checkAppUpdateBtn.innerHTML = origHtml;
          }
        }, 2000);
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

    async function logout(kicked = false, reason?: string) {
      if (loginPoll) { clearInterval(loginPoll); loginPoll = null; }
      authToken = "";
      authUser = "";
      localStorage.removeItem("moonup_auth_token");
      localStorage.removeItem("moonup_auth_user");
      ADDONS.forEach(a => localStorage.removeItem(`latest_${a.folder}`));
      updateAuthUI();
      if (kicked) {
        statusArea.textContent = reason || TEXTS.status.denied;
        await message(reason || "Sitzung beendet: Discord-Rolle fehlt.", { title: "Moonup", kind: "warning" });
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
            await message("Zugriff verweigert: Dir fehlt die erforderliche Discord-Rolle.", { title: "Moonup Login", kind: "error" });
            setLoginBtnDefault();
          }
        } catch (_) { /* still polling */ }
      }, 2000);
    }

    /* ── App Updater (Pill, Settings Banner & User-Triggered Install) ── */

    let pendingAppUpdate: Update | null = null;
    let isInstallingAppUpdate = false;
    let isUpdateDownloaded = false;

    async function triggerAppUpdate() {
      if (isInstallingAppUpdate || !pendingAppUpdate) return;

      isInstallingAppUpdate = true;
      if (topAppUpdateBtn) topAppUpdateBtn.disabled = true;
      if (settingsInstallUpdateBtn) settingsInstallUpdateBtn.disabled = true;

      const setBtnText = (txt: string) => {
        if (topAppUpdateBtnText) topAppUpdateBtnText.textContent = txt;
        if (settingsInstallUpdateBtn) settingsInstallUpdateBtn.textContent = txt;
      };

      const updateToInstall = pendingAppUpdate;
      if (!updateToInstall) return;

      try {
        let installed = false;

        // Falls im Hintergrund vorab geladen und Bytes noch in dieser Instanz vorhanden:
        if (isUpdateDownloaded && (updateToInstall as any).downloadedBytes) {
          try {
            setBtnText("Installiere...");
            await updateToInstall.install();
            installed = true;
          } catch (instErr) {
            console.warn("Direct install failed, falling back to downloadAndInstall:", instErr);
          }
        }

        // Falls noch nicht geladen oder install() fehlschlug:
        if (!installed) {
          setBtnText("Lade 0%...");
          let downloaded = 0;
          let contentLength = 0;

          await updateToInstall.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                contentLength = event.data.contentLength || 0;
                setBtnText("Lade 0%...");
                break;
              case 'Progress':
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  const pct = Math.round((downloaded / contentLength) * 100);
                  setBtnText(`Lade ${pct}%...`);
                }
                break;
              case 'Finished':
                setBtnText("Neustart...");
                break;
            }
          });
        }

        setBtnText("Neustart...");
        await relaunch();
      } catch (err) {
        console.error("Update Installation fehlgeschlagen:", err);
        setBtnText("Fehler");
        if (topAppUpdateBtn) topAppUpdateBtn.disabled = false;
        if (settingsInstallUpdateBtn) settingsInstallUpdateBtn.disabled = false;
        isInstallingAppUpdate = false;
        setTimeout(() => {
          if (pendingAppUpdate) {
            if (topAppUpdateBtnText) topAppUpdateBtnText.textContent = isUpdateDownloaded ? "Jetzt neu starten" : "Aktualisieren";
            if (settingsInstallUpdateBtn) settingsInstallUpdateBtn.textContent = isUpdateDownloaded ? "Neu starten" : "Aktualisieren";
          }
        }, 3000);
      }
    }

    if (topAppUpdateBtn) {
      topAppUpdateBtn.addEventListener("click", triggerAppUpdate);
    }
    if (topAppUpdateDismiss) {
      topAppUpdateDismiss.addEventListener("click", () => {
        if (topAppUpdateBanner) topAppUpdateBanner.style.display = "none";
      });
    }
    if (settingsInstallUpdateBtn) {
      settingsInstallUpdateBtn.addEventListener("click", triggerAppUpdate);
    }

    async function checkForAppUpdates(manual = false): Promise<Update | null> {
      if (isInstallingAppUpdate) return pendingAppUpdate;

      try {
        console.log(`[Updater] Checking for Moonup updates (manual=${manual})...`);
        const update = await check();
        console.log("[Updater] Check result:", update);

        if (update) {
          pendingAppUpdate = update;
          const newVer = update.version;

          if (topAppUpdateBanner) {
            topAppUpdateBanner.style.display = "flex";
            if (topAppUpdateBadge) topAppUpdateBadge.textContent = `v${newVer}`;
            if (topAppUpdateMsg) topAppUpdateMsg.textContent = isUpdateDownloaded ? "Update fertig geladen:" : "Moonup Update bereit:";
            if (topAppUpdateBtn) topAppUpdateBtn.disabled = false;
            if (topAppUpdateBtnText) topAppUpdateBtnText.textContent = isUpdateDownloaded ? "Jetzt neu starten" : "Aktualisieren";
          }

          if (settingsGearBadge) {
            settingsGearBadge.style.display = "block";
          }

          if (settingsInlineUpdatePill && settingsInlineUpdateText) {
            settingsInlineUpdatePill.style.display = "inline-flex";
            settingsInlineUpdateText.textContent = `v${newVer}`;
          }

          if (checkAppUpdateBtn && settingsInstallUpdateBtn) {
            checkAppUpdateBtn.style.display = "none";
            settingsInstallUpdateBtn.style.display = "inline-flex";
            settingsInstallUpdateBtn.disabled = false;
            settingsInstallUpdateBtn.textContent = isUpdateDownloaded ? "Neu starten" : "Aktualisieren";
          }

          if (notifiedAppUpdate !== newVer) {
            notifiedAppUpdate = newVer;
            await notifyUser(
              "Moonup • Update verfügbar",
              `Moonup v${newVer} steht bereit. Klicke auf "Aktualisieren" zum Installieren.`
            );
          }

          // Im Hintergrund geräuschlos vorab herunterladen (ohne Installer auszuführen)
          if (!isUpdateDownloaded) {
            update.download().then(() => {
              isUpdateDownloaded = true;
              if (topAppUpdateMsg && !isInstallingAppUpdate) {
                topAppUpdateMsg.textContent = "Update fertig geladen:";
              }
              if (topAppUpdateBtnText && !isInstallingAppUpdate) {
                topAppUpdateBtnText.textContent = "Jetzt neu starten";
              }
              if (settingsInstallUpdateBtn && !isInstallingAppUpdate) {
                settingsInstallUpdateBtn.textContent = "Neu starten";
              }
            }).catch(err => {
              console.warn("Background pre-download note:", err);
            });
          }

          return update;
        } else {
          pendingAppUpdate = null;
          isUpdateDownloaded = false;
          if (topAppUpdateBanner) topAppUpdateBanner.style.display = "none";
          if (settingsGearBadge) settingsGearBadge.style.display = "none";
          if (settingsInlineUpdatePill) settingsInlineUpdatePill.style.display = "none";
          if (checkAppUpdateBtn) checkAppUpdateBtn.style.display = "";
          if (settingsInstallUpdateBtn) settingsInstallUpdateBtn.style.display = "none";
          return null;
        }
      } catch (err) {
        console.error("App Update Check fehlgeschlagen:", err);
        if (!pendingAppUpdate) {
          if (topAppUpdateBanner) topAppUpdateBanner.style.display = "none";
          if (settingsGearBadge) settingsGearBadge.style.display = "none";
          if (settingsInlineUpdatePill) settingsInlineUpdatePill.style.display = "none";
          if (checkAppUpdateBtn) checkAppUpdateBtn.style.display = "";
          if (settingsInstallUpdateBtn) settingsInstallUpdateBtn.style.display = "none";
        }
        return null;
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

    async function openExplorer(folder?: string) {
      if (!wowPath) { alert("Bitte zuerst WoW-Pfad auswählen."); return; }
      try { await invoke("open_in_explorer", { path: wowPath, folder: folder || null }); } catch (e) { alert("Fehler: " + e); }
    }

    /* ── Update Check ─────────────────── */

    let updateTimer: number | null = null;
    function resetAutoUpdateTimer() {
      if (updateTimer) window.clearInterval(updateTimer);
      updateTimer = window.setInterval(() => {
        if (!isChecking && wowPath) {
          checkUpdates();
        }
        // Moonup alle 2 Minuten geräuschlos im Hintergrund auf neue App-Releases prüfen
        checkForAppUpdates(false);
      }, 2 * 60 * 1000); // Alle 2 Minuten prüfen (Schnell & Ressourcen-schonend)
    }


    async function checkUpdates() {
      if (isChecking || !wowPath) return;
      isChecking = true;
      statusArea.textContent = TEXTS.status.searching;
      resetAutoUpdateTimer();

      let hasAnyVersionChanged = false;
      let authFailed = false;

      try {
        // Parallel in echten Background-Worker-Threads prüfen (blockiert die UI 0 Millisekunden)
        await Promise.all(ADDONS.map(async (addon) => {
          try {
            // IMMER die lokal installierte Version ermitteln (auch ohne Auth)
            const localVer = await withTimeout<string>(
              invoke("get_installed_version", {
                path: wowPath, folder: addon.folder, search: addon.search,
              }),
              3000,
              "Unbekannt"
            );
            const prevLocal = localStorage.getItem(`version_${addon.folder}`);
            if (prevLocal !== String(localVer)) {
              hasAnyVersionChanged = true;
            }
            localStorage.setItem(`version_${addon.folder}`, String(localVer));

            // Nur wenn eingeloggt remote nach Updates suchen
            if (authToken) {
              const remoteVer = await withTimeout<string>(
                invoke("check_for_updates", {
                  token: authToken, repo: addon.repo, provider: addon.provider,
                }),
                4000,
                ""
              );

              if (remoteVer === "AUTH_ERROR") {
                if (addon.provider === "mooncloud") {
                  authFailed = true;
                }
              } else if (remoteVer) {
                const prevRemote = localStorage.getItem(`latest_${addon.folder}`);
                if (prevRemote !== remoteVer) {
                  hasAnyVersionChanged = true;
                }
                localStorage.setItem(`latest_${addon.folder}`, remoteVer);
              }
            }
          } catch (e: any) {
            console.error(`Check ${addon.label}:`, e);
            if (addon.provider === "mooncloud" && String(e).includes("AUTH_ERROR")) {
              authFailed = true;
            }
          }
        }));

        if (authFailed) {
          await logout(true, "Sitzung abgelaufen oder Zugriff verweigert.");
          return;
        }

        // DOM nur neu aufbauen, wenn sich tatsächlich ein Versionsstand geändert hat (0% CPU Idle)
        if (hasAnyVersionChanged || !addonList.hasChildNodes()) {
          renderAddons();
        }

        // 1. Silent background auto-update für ausgewählte Addons (nur wenn eingeloggt)
        if (autoBgUpdate && authToken && wowPath) {
          const targets = ADDONS.filter(a => autoUpdateAddons.includes(a.id) && !isAddonIgnored(a.id));
          let anyUpdated = false;
          for (const addon of targets) {
            const local = localStorage.getItem(`version_${addon.folder}`);
            const remote = localStorage.getItem(`latest_${addon.folder}`);
            const installed = local && !["Nicht installiert", "Unbekannt", "-"].includes(local);
            if (installed && remote && isNewerVersion(local, remote)) {
              const card = addonList.querySelector(`.addon-card[data-id="${addon.id}"]`) as HTMLElement | null;
              card?.classList.add("is-updating");
              statusArea.textContent = `Auto-Update: ${addon.label}...`;

              try {
                console.log(`[AutoUpdate] Starting background update for ${addon.label}...`);
                await invoke("install_addon", {
                  token: authToken,
                  repo: addon.repo,
                  name: addon.folder,
                  path: wowPath,
                  provider: addon.provider,
                  directUrl: addon.directUrl || null,
                  addonId: addon.id,
                });
                const newLocal: string = await invoke("get_installed_version", {
                  path: wowPath,
                  folder: addon.folder,
                  search: addon.search,
                });
                localStorage.setItem(`version_${addon.folder}`, String(newLocal));
                localStorage.setItem(`updated_at_${addon.folder}`, String(Date.now()));
                console.log(`[AutoUpdate] ${addon.label} updated to ${newLocal}`);
                anyUpdated = true;

                // Notification Logik bei Auto-Update:
                const isWoW = await invoke<boolean>("is_wow_running");
                if (isWoW) {
                  await notifyUser(
                    "Moonup • Addon aktualisiert",
                    `${addon.label} wurde im Hintergrund aktualisiert. Gib bitte /reload im Spiel ein.`
                  );
                }
              } catch (err) {
                console.warn(`[AutoUpdate] Background update for ${addon.label} failed:`, err);
              } finally {
                card?.classList.remove("is-updating");
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
                await notifyUser(
                  "Moonup • Update verfügbar",
                  `Bitte Update für ${addon.label} (v${remote}) herunterladen und /reload eingeben.`
                );
              } else {
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
      } catch (err) {
        console.error("Update check error:", err);
      } finally {
        isChecking = false;
        if (statusArea.textContent === TEXTS.status.searching || statusArea.textContent?.startsWith("Auto-Update")) {
          statusArea.textContent = TEXTS.status.ready;
        }
      }
    }

    /* ── Install / Update ─────────────── */

    async function installAddon(addon: AddonItem, btn: HTMLButtonElement) {
      if (!authToken) { alert("Bitte zuerst einloggen."); return; }
      if (!wowPath) { alert("Bitte WoW-Pfad wählen."); return; }

      // Check dependencies
      if (addon.dependencies && addon.dependencies.length > 0) {
        for (const depId of addon.dependencies) {
          const depAddon = ADDONS.find(a => a.id === depId);
          if (depAddon) {
            let depLocal = localStorage.getItem(`version_${depAddon.folder}`);
            if (!depLocal || depLocal === "Ordner fehlt" || depLocal === "Nicht installiert") {
              const installDep = await ask(
                `"${addon.label}" benötigt "${depAddon.label}".\n\nMöchtest du "${depAddon.label}" jetzt zuerst installieren?`,
                { title: "Benötigte Abhängigkeit", kind: "info" }
              );
              if (installDep) {
                const depCard = addonList.querySelector(`.addon-card[data-id="${depId}"]`);
                const depBtn = depCard?.querySelector(".install-btn") as HTMLButtonElement | null;
                if (depBtn) {
                  await installAddon(depAddon, depBtn);
                } else {
                  // Direct install without button
                  try {
                    await invoke("install_addon", {
                      token: authToken, repo: depAddon.repo, name: depAddon.folder,
                      path: wowPath, provider: depAddon.provider, directUrl: depAddon.directUrl || null,
                      addonId: depAddon.id,
                    });
                    localStorage.setItem(`updated_at_${depAddon.folder}`, String(Date.now()));
                  } catch (e) {
                    alert(`Konnte Abhängigkeit ${depAddon.label} nicht installieren: ${e}`);
                    return;
                  }
                }
              }
            }
          }
        }
      }

      const ok = await validateSession();
      if (!ok) return;

      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="loader"></span>`;
      statusArea.textContent = `${TEXTS.status.installing}${addon.label}`;
      const card = btn.closest(".addon-card") as HTMLElement | null;
      card?.classList.add("is-updating");

      try {
        await invoke("install_addon", {
          token: authToken, repo: addon.repo, name: addon.folder,
          path: wowPath, provider: addon.provider, directUrl: addon.directUrl || null,
          addonId: addon.id,
        });
        localStorage.setItem(`updated_at_${addon.folder}`, String(Date.now()));
        statusArea.textContent = `${addon.label} ${TEXTS.status.done}`;
        await checkUpdates();
      } catch (e: any) {
        if (String(e).includes("AUTH_ERROR") || String(e).includes("403")) { logout(true); }
        else { alert(`Fehler bei ${addon.label}: ${e}`); }
        btn.disabled = false;
        btn.innerHTML = origHtml;
        statusArea.textContent = TEXTS.status.checkError;
      } finally {
        card?.classList.remove("is-updating");
      }
    }


    /* ── Uninstall (Funktioniert auch ohne Auth/Logged out!) ── */

    async function uninstallAddon(addon: AddonItem) {
      if (!wowPath) return;

      // Check if any installed addon depends on this addon
      const dependentAddons = ADDONS.filter(a => {
        if (!a.dependencies || !a.dependencies.includes(addon.id)) return false;
        let local = localStorage.getItem(`version_${a.folder}`);
        return local && !["Nicht installiert", "Unbekannt", "-", "Ordner fehlt"].includes(local);
      });

      if (dependentAddons.length > 0) {
        const names = dependentAddons.map(a => a.label).join(", ");
        const proceed = await ask(
          `Achtung: "${names}" benötigt "${addon.label}".\n\nWenn du "${addon.label}" löschst, funktioniert "${names}" möglicherweise nicht mehr ordnungsgemäß.\n\nTrotzdem löschen?`,
          { title: "Abhängigkeit erkannt", kind: "warning" }
        );
        if (!proceed) return;
      } else {
        if (!await ask(TEXTS.dialogs.deleteConfirm(addon.label), { kind: "warning" })) {
          return;
        }
      }

      try {
        await invoke("uninstall_addon", { path: wowPath, name: addon.folder });
        localStorage.setItem(`version_${addon.folder}`, "Nicht installiert");
        localStorage.removeItem(`updated_at_${addon.folder}`);
        statusArea.textContent = `${addon.label} ${TEXTS.status.deleted}`;
        renderAddons();
      } catch (e) { alert("Fehler: " + e); }
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

        // Icon with fallback & self-healing
        const healed = localStorage.getItem(`healed_icon_${addon.id}`);
        let iconSrc = healed || addon.icon;
        if (addon.id === "mooncloud-tools" || addon.icon === "/src/assets/Moonup_logo.png") {
          iconSrc = moonupLogoUrl;
        } else if (addon.id === "timeline-reminders" || addon.icon === "/src/assets/timeline_reminders.png") {
          iconSrc = timelineLogoUrl;
        }

        const icon = iconSrc
          ? `<img src="${iconSrc}" class="addon-logo-img" alt="" onerror="window.healAddonIcon('${addon.id}', '${addon.repo}', this, '${addon.fallbackInitials || "?"}')">`
          : `<div class="addon-logo">${addon.fallbackInitials || "?"}</div>`;


        // Ignore/Pause button (nur wenn eingeloggt)
        const ignoreBtn = authToken
          ? `<button class="btn-card-action ignore-btn ${ignored ? "is-ignored is-paused" : ""}" data-id="${addon.id}" title="${ignored ? "Ignorieren aufheben (Addon wieder verwalten)" : "Addon ignorieren"}">${ignored ? EYE_OFF_SVG : EYE_OPEN_SVG}</button>`
          : "";

        // Löschen-Button (WICHTIG: Immer verfügbar, wenn Addon installiert ist, auch ausgeloggt!)
        const deleteBtn = installed
          ? `<button class="btn-card-action btn-delete del-btn" data-id="${addon.id}" title="${addon.label} deinstallieren">${TRASH_SVG}</button>`
          : "";

        // Last updated time
        const updatedAtRaw = localStorage.getItem(`updated_at_${addon.folder}`);
        const updatedAtFormatted = formatLastUpdated(updatedAtRaw);
        const updatedHtml = (installed && updatedAtFormatted)
          ? `<div class="card-updated-at">
               <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
               <span>Aktualisiert: ${updatedAtFormatted}</span>
             </div>`
          : "";

        // Dependency label
        let depHtml = "";
        if (addon.dependencies && addon.dependencies.length > 0) {
          const depLabels = addon.dependencies
            .map(depId => ADDONS.find(a => a.id === depId)?.label || depId)
            .join(", ");
          depHtml = `<div class="addon-dep-badge" title="Benötigt ${depLabels}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> Benötigt: ${depLabels}</div>`;
        }

        return `
          <div class="addon-card ${ignored ? "is-paused" : ""}" data-id="${addon.id}">
            <div class="card-left">
              ${icon}
              <div class="card-info">
                <span class="card-name">${addon.label}</span>
                <div class="card-version-row">
                  ${versionHtml}
                </div>
                ${depHtml}
                ${updatedHtml}
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
        readinessDesc.textContent = "";
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

      // Context Menu on Addon Cards
      document.querySelectorAll(".addon-card").forEach(cardEl => {
        cardEl.addEventListener("contextmenu", (e: Event) => {
          const me = e as MouseEvent;
          me.preventDefault();
          me.stopPropagation();

          const id = (cardEl as HTMLElement).dataset.id;
          const addon = ADDONS.find(x => x.id === id);
          if (!addon || !contextMenu) return;

          activeContextAddon = addon;

          let local = localStorage.getItem(`version_${addon.folder}`);
          if (!local || local === "Ordner fehlt") local = "Nicht installiert";
          const installed = !["Nicht installiert", "Unbekannt", "-"].includes(local);
          const ignored = isAddonIgnored(addon.id);

          // 1. Explorer (nur wenn installiert und WoW-Pfad gewählt)
          if (installed && wowPath) {
            ctxExplorer.classList.remove("disabled");
            ctxExplorer.title = `${addon.label} im Explorer anzeigen`;
          } else {
            ctxExplorer.classList.add("disabled");
            ctxExplorer.title = "Addon ist nicht auf der Festplatte installiert";
          }

          // 2. Reinstall (NUR wenn eingeloggt & installiert & WoW-Pfad gewählt)
          if (authToken && installed && wowPath) {
            ctxReinstall.classList.remove("disabled");
            ctxReinstall.title = `${addon.label} neu herunterladen und installieren`;
          } else {
            ctxReinstall.classList.add("disabled");
            ctxReinstall.title = !authToken ? "Login erforderlich" : "Addon ist nicht installiert";
          }

          // 3. Ignorieren (NUR wenn eingeloggt)
          if (authToken) {
            ctxIgnore.classList.remove("disabled");
            ctxIgnoreLabel.textContent = ignored ? "Wieder verwalten" : "Ignorieren";
            ctxIgnore.title = ignored ? "Ignorieren aufheben" : "Addon ignorieren (keine Auto-Updates)";
          } else {
            ctxIgnore.classList.add("disabled");
            ctxIgnoreLabel.textContent = "Ignorieren";
            ctxIgnore.title = "Login erforderlich";
          }

          // 4. Deinstallieren (wenn installiert & WoW-Pfad gewählt)
          if (installed && wowPath) {
            ctxDelete.classList.remove("disabled");
            ctxDelete.title = `${addon.label} deinstallieren`;
          } else {
            ctxDelete.classList.add("disabled");
            ctxDelete.title = "Addon ist nicht installiert";
          }

          // Position menu clamped to window boundaries (430x720)
          contextMenu.style.display = "block";
          const menuWidth = contextMenu.offsetWidth || 185;
          const menuHeight = contextMenu.offsetHeight || 150;

          let posX = me.clientX;
          let posY = me.clientY;

          if (posX + menuWidth > window.innerWidth - 8) {
            posX = window.innerWidth - menuWidth - 8;
          }
          if (posY + menuHeight > window.innerHeight - 8) {
            posY = window.innerHeight - menuHeight - 8;
          }

          contextMenu.style.left = `${Math.max(8, posX)}px`;
          contextMenu.style.top = `${Math.max(8, posY)}px`;
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
    refreshBtn.addEventListener("click", () => {
      checkUpdates();
      checkForAppUpdates(false);
    });
    changePathBtn.addEventListener("click", selectPath);
    pathDisplay.addEventListener("click", selectPath);
    openExplorerBtn.addEventListener("click", () => openExplorer());

    // Prüfe beim Fokus / Wiederherstellen aus dem Tray (max. alle 30s)
    let lastFocusAppCheck = 0;
    window.addEventListener("focus", () => {
      const now = Date.now();
      if (now - lastFocusAppCheck > 30 * 1000) {
        lastFocusAppCheck = now;
        checkForAppUpdates(false);
      }
    });

    /* ── Context Menu Actions ─────────── */
    window.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    window.addEventListener("click", hideContextMenu);
    window.addEventListener("resize", hideContextMenu);
    document.addEventListener("scroll", hideContextMenu, true);

    ctxExplorer?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!activeContextAddon || ctxExplorer.classList.contains("disabled")) return;
      const folder = activeContextAddon.folder;
      hideContextMenu();
      await openExplorer(folder);
    });

    ctxReinstall?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!activeContextAddon || ctxReinstall.classList.contains("disabled") || !authToken || !wowPath) return;
      const targetAddon = activeContextAddon;
      hideContextMenu();
      statusArea.textContent = `Installiere ${targetAddon.label} neu...`;
      try {
        await invoke("install_addon", {
          token: authToken,
          repo: targetAddon.repo,
          name: targetAddon.folder,
          path: wowPath,
          provider: targetAddon.provider,
          directUrl: targetAddon.directUrl || null,
          addonId: targetAddon.id,
        });
        statusArea.textContent = `${targetAddon.label} erfolgreich neu installiert ✓`;
        await checkUpdates();
      } catch (err) {
        statusArea.textContent = `Fehler: ${err}`;
      }
    });

    ctxIgnore?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!activeContextAddon || ctxIgnore.classList.contains("disabled") || !authToken) return;
      const id = activeContextAddon.id;
      hideContextMenu();
      toggleIgnoreAddon(id);
    });

    ctxDelete?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!activeContextAddon || ctxDelete.classList.contains("disabled")) return;
      const targetAddon = activeContextAddon;
      hideContextMenu();
      await uninstallAddon(targetAddon);
    });

    updateAllBtn.addEventListener("click", async () => {
      if (!authToken || !wowPath) return;
      const ok = await validateSession();
      if (!ok) return;

      const targets = ADDONS.filter(addon => {
        if (isAddonIgnored(addon.id)) return false;
        const local = localStorage.getItem(`version_${addon.folder}`) || "";
        const remote = localStorage.getItem(`latest_${addon.folder}`) || "";
        const inst = !["Nicht installiert", "Unbekannt", "-"].includes(local);
        return !inst || isNewerVersion(local, remote);
      });

      if (targets.length === 0) return;

      const total = targets.length;
      updateAllBtn.disabled = true;

      for (let i = 0; i < total; i++) {
        const addon = targets[i];
        const currentNum = i + 1;

        updateAllBtn.innerHTML = `<span class="loader"></span> (${currentNum}/${total}) ${addon.label}...`;
        statusArea.textContent = `${TEXTS.status.installing}${addon.label} (${currentNum}/${total})...`;

        const card = addonList.querySelector(`.addon-card[data-id="${addon.id}"]`) as HTMLElement | null;
        card?.classList.add("is-updating");

        try {
          await invoke("install_addon", {
            token: authToken, repo: addon.repo, name: addon.folder,
            path: wowPath, provider: addon.provider, directUrl: addon.directUrl || null,
            addonId: addon.id,
          });
          localStorage.setItem(`updated_at_${addon.folder}`, String(Date.now()));
        } catch (e) {
          console.error(`Batch: ${addon.label}`, e);
        } finally {
          card?.classList.remove("is-updating");
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