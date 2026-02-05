import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { TEXTS, ADDONS } from "./config";

window.addEventListener("DOMContentLoaded", async () => {
  const pathDisplay = document.querySelector("#path-display") as HTMLElement;
  const tokenInput = document.querySelector("#token-input") as HTMLInputElement;
  const checkTokenBtn = document.querySelector("#check-token-btn") as HTMLButtonElement;
  const tokenAlert = document.querySelector("#token-alert") as HTMLElement;
  const addonList = document.querySelector("#addon-list") as HTMLElement;
  const statusArea = document.querySelector("#status-text") as HTMLElement;
  const refreshBtn = document.querySelector("#refresh-btn") as HTMLButtonElement;
  const deleteBtn = document.querySelector("#delete-btn") as HTMLButtonElement;
  const pathBtn = document.querySelector("#change-path-btn") as HTMLButtonElement;

  refreshBtn.textContent = TEXTS.buttons.refresh;
  pathBtn.textContent = TEXTS.buttons.pathBtn; 
  checkTokenBtn.textContent = TEXTS.buttons.check;
  tokenAlert.textContent = TEXTS.alerts.noToken;

  let currentWowPath = localStorage.getItem("moonup_wow_path") || "";
  let isTokenValid = false;

  async function checkForAppUpdates() {
    try {
        const update = await check(); // Simulation entfernen, falls du fertig bist
        if (update && update.available) {
            console.log("Update gefunden:", update.version);
            const yes = await ask(`Eine neue Version (${update.version}) ist verfügbar!\nJetzt herunterladen und installieren?`, {
                title: 'Moonup Update',
                kind: 'info',
                okLabel: 'Ja, Update starten',
                cancelLabel: 'Später'
            });

            if (yes) {
                statusArea.textContent = `Lade App-Update v${update.version}...`;
                await update.downloadAndInstall();
                await relaunch();
            }
        }
    } catch (error) {
        console.error("App-Update Check fehlgeschlagen (im Dev-Modus normal):", error);
    }
  }

  async function checkTokenOnline() {
    const token = tokenInput.value.trim();
    checkTokenBtn.disabled = true;
    checkTokenBtn.textContent = TEXTS.buttons.checking;
    
    if (!token) {
        setTokenStatus(false, TEXTS.alerts.noToken);
        resetCheckBtn();
        return;
    }

    try {
        const response = await fetch("https://api.github.com/user", {
            headers: { Authorization: `token ${token}` },
        });

        if (response.status === 200) {
            setTokenStatus(true);
        } else {
            setTokenStatus(false, TEXTS.versions.tokenError);
        }
    } catch (e) {
        setTokenStatus(false, "Verbindungsfehler");
    }
    resetCheckBtn();
  }

  // --- HIER WURDE GEÄNDERT ---
  function resetCheckBtn() {
    checkTokenBtn.disabled = false;
    
    if (isTokenValid) {
        // Status OK: Wird zum Label
        checkTokenBtn.textContent = TEXTS.buttons.keyOk; // "OK"
        checkTokenBtn.classList.add("valid-status");
    } else {
        // Status nicht OK: Wird wieder zum Button
        checkTokenBtn.textContent = TEXTS.buttons.check; // "Prüfen"
        checkTokenBtn.classList.remove("valid-status");
    }
  }
  // ---------------------------

  function setTokenStatus(valid: boolean, msg: string = "") {
    isTokenValid = valid;
    
    if (valid) {
        tokenInput.classList.remove("invalid");
        tokenInput.classList.add("valid");
        tokenAlert.style.display = "none";
    } else {
        tokenInput.classList.remove("valid");
        tokenInput.classList.add("invalid");
        tokenAlert.textContent = msg;
        tokenAlert.style.display = "block";
    }
    
    updateMainButton();
    updateUI();
  }

  function updateMainButton() {
    refreshBtn.disabled = !currentWowPath || !isTokenValid;
  }

  function formatLocalStatus(rawStatus: string): string {
    if (rawStatus === "Ordner fehlt") return TEXTS.versions.folderMissing;
    if (rawStatus === "TOC fehlt") return TEXTS.versions.tocMissing;
    return rawStatus;
  }

  function formatRemoteStatus(rawStatus: string): string {
    if (rawStatus === "AUTH_ERROR") return `<span style="color:#ff4444">${TEXTS.versions.tokenError}</span>`;
    return rawStatus;
  }

  async function updateUI() {
    addonList.innerHTML = ADDONS.map(addon => {
      const rawLocal = localStorage.getItem(`version_${addon.folder}`) || TEXTS.versions.checking;
      const rawRemote = localStorage.getItem(`latest_${addon.folder}`) || TEXTS.versions.missing;
      const displayLocal = formatLocalStatus(rawLocal);
      const displayRemote = formatRemoteStatus(rawRemote);
      const isInstalled = !["Ordner fehlt", "TOC fehlt", "Prüfen...", "Pfad ungültig", "Fehler"].includes(rawLocal);
      const localNum = parseInt(rawLocal.replace(/\D/g, "")) || 0;
      const remoteNum = parseInt(rawRemote.replace(/\D/g, "")) || 0;
      const canUpdate = isInstalled && isTokenValid && rawRemote !== "AUTH_ERROR" && (remoteNum > localNum || (rawRemote === "Main" && localNum === 0));

      let actionHtml = '';
      if (!isInstalled) {
        actionHtml = `<button class="btn-primary install-btn" data-repo="${addon.repo}" data-folder="${addon.folder}" ${!isTokenValid ? 'disabled' : ''}>${TEXTS.buttons.install}</button>`;
      } else if (canUpdate) {
        actionHtml = `<button class="btn-update install-btn" data-repo="${addon.repo}" data-folder="${addon.folder}" ${!isTokenValid ? 'disabled' : ''}>${TEXTS.buttons.update}</button>`;
      } else {
        actionHtml = !isTokenValid ? `<span style="font-size: 1.2em">🔒</span>` : `<span class="status-ok">${TEXTS.buttons.current}</span>`;
      }

      const deleteHtml = isInstalled ? `<button class="btn-delete delete-btn" data-folder="${addon.folder}" data-label="${addon.label}" title="${TEXTS.buttons.deleteTitle}">🗑️</button>` : '';

      return `<div class="addon-item">
          <div><span style="font-weight: bold;">${addon.label}</span><div class="version-row">${TEXTS.versions.localLabel} ${displayLocal} | ${TEXTS.versions.remoteLabel} ${displayRemote}</div></div>
          <div class="addon-actions">${actionHtml}${deleteHtml}</div>
        </div>`;
    }).join('');

    document.querySelectorAll(".install-btn").forEach(btn => btn.addEventListener("click", (e) => install(e.target as HTMLButtonElement)));
    document.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", (e) => uninstall(e.currentTarget as HTMLButtonElement)));
    updateMainButton();
  }

  async function checkUpdates() {
    if (!currentWowPath || !isTokenValid) return;
    statusArea.textContent = TEXTS.status.searching;
    for (const addon of ADDONS) {
      try {
        const v = await invoke("get_installed_version", { path: currentWowPath, folder: addon.folder, search: addon.search });
        localStorage.setItem(`version_${addon.folder}`, String(v));
        const rv = await invoke("check_for_updates", { token: tokenInput.value, repo: addon.repo });
        localStorage.setItem(`latest_${addon.folder}`, String(rv));
      } catch (e) { localStorage.setItem(`version_${addon.folder}`, "Fehler"); }
    }
    statusArea.textContent = TEXTS.status.ready;
    updateUI();
  }

  async function install(btn: HTMLButtonElement) {
    if(!isTokenValid) return;
    const token = tokenInput.value.trim();
    const { repo, folder } = btn.dataset;
    if (!token || !currentWowPath || !repo || !folder) return;
    btn.disabled = true; btn.textContent = TEXTS.buttons.wait;
    statusArea.textContent = `${TEXTS.status.installing} ${folder}...`;
    try {
      await invoke("install_addon", { token, repo, name: folder, path: currentWowPath });
      statusArea.textContent = TEXTS.status.done;
      await checkUpdates();
    } catch (e) { statusArea.textContent = `Fehler: ${e}`; btn.disabled = false; btn.textContent = TEXTS.buttons.error; }
  }

  async function uninstall(btn: HTMLButtonElement) {
    const folderName = btn.dataset.folder;
    const label = btn.dataset.label;
    if (!currentWowPath || !folderName) return;
    const yes = await ask(TEXTS.dialogs.deleteConfirm(label || ""), { title: TEXTS.dialogs.deleteTitle, kind: 'warning', okLabel: TEXTS.dialogs.deleteOk, cancelLabel: TEXTS.dialogs.deleteCancel });
    if (!yes) return;
    try {
      await invoke("uninstall_addon", { path: currentWowPath, name: folderName });
      localStorage.setItem(`version_${folderName}`, "Ordner fehlt");
      updateUI();
      statusArea.textContent = `${label} ${TEXTS.status.deleted}`;
    } catch (e) { statusArea.textContent = `Fehler: ${e}`; }
  }

  // --- EVENTS ---
  tokenInput.addEventListener("input", () => {
    localStorage.setItem("moonup_token", tokenInput.value);
    
    tokenInput.classList.remove("valid", "invalid");
    tokenAlert.style.display = "none";
    
    isTokenValid = false;
    
    // SOFORT RESET: Button wird wieder normal
    checkTokenBtn.textContent = TEXTS.buttons.check;
    checkTokenBtn.classList.remove("valid-status");
    
    updateMainButton();
    updateUI(); 
  });

  checkTokenBtn.addEventListener("click", checkTokenOnline);
  refreshBtn.addEventListener("click", checkUpdates);
  pathBtn.addEventListener("click", async () => {
    const selected = await open({ directory: true });
    if (selected && typeof selected === 'string') {
      currentWowPath = selected;
      localStorage.setItem("moonup_wow_path", selected);
      pathDisplay.textContent = selected;
      updateMainButton();
      if(isTokenValid) checkUpdates();
    }
  });
  deleteBtn.addEventListener("click", async () => {
      if(confirm("Alles löschen?")) statusArea.textContent = "Gelöscht.";
  });

  tokenInput.value = localStorage.getItem("moonup_token") || "";
  if (currentWowPath) pathDisplay.textContent = currentWowPath;
  
  if(tokenInput.value) checkTokenOnline();
  else setTokenStatus(false, TEXTS.alerts.noToken);
  
  updateUI();
  checkForAppUpdates();
});