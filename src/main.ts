import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { TEXTS, ADDONS } from "./config";

window.addEventListener("DOMContentLoaded", async () => {
  const pathDisplay = document.querySelector("#path-display") as HTMLElement;
  const tokenInput = document.querySelector("#token-input") as HTMLInputElement;
  const checkTokenBtn = document.querySelector("#check-token-btn") as HTMLButtonElement;
  const tokenAlert = document.querySelector("#token-alert") as HTMLElement;
  const addonList = document.querySelector("#addon-list") as HTMLElement;
  const statusArea = document.querySelector("#status-text") as HTMLElement;
  const refreshBtn = document.querySelector("#refresh-btn") as HTMLButtonElement;
  const updateAllBtn = document.querySelector("#update-all-btn") as HTMLButtonElement;
  const deleteBtn = document.querySelector("#delete-btn") as HTMLButtonElement;
  const pathBtn = document.querySelector("#change-path-btn") as HTMLButtonElement;

  refreshBtn.textContent = "🔄"; 
  pathBtn.textContent = TEXTS.buttons.pathBtn; 
  checkTokenBtn.textContent = TEXTS.buttons.check;
  tokenAlert.textContent = TEXTS.alerts.noToken;

  let currentWowPath = localStorage.getItem("moonup_wow_path") || "";
  let isTokenValid = false;

  async function checkTokenOnline() {
    const token = tokenInput.value.trim();
    if(document.activeElement === checkTokenBtn) {
        checkTokenBtn.disabled = true;
        checkTokenBtn.textContent = TEXTS.buttons.checking;
    }
    if (!token) {
        setTokenStatus(false, TEXTS.alerts.noToken);
        resetCheckBtn();
        return;
    }
    try {
        const isValid = await invoke("validate_token", { token });
        if (isValid) setTokenStatus(true);
        else setTokenStatus(false, TEXTS.versions.tokenError);
    } catch (e) {
        setTokenStatus(false, "Verbindungsfehler");
    }
    resetCheckBtn();
  }

  function resetCheckBtn() {
    checkTokenBtn.disabled = false;
    if (isTokenValid) {
        checkTokenBtn.textContent = TEXTS.buttons.keyOk; 
        checkTokenBtn.classList.add("valid-status");
    } else {
        checkTokenBtn.textContent = TEXTS.buttons.check;
        checkTokenBtn.classList.remove("valid-status");
    }
  }

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

  async function updateUI() {
    let updatesAvailableCount = 0;
    
    const mainAddons = ADDONS.filter(a => !(a as any).isOptional);
    const optionalAddons = ADDONS.filter(a => (a as any).isOptional);

    const renderAddon = (addon: any) => {
      const rawLocal = localStorage.getItem(`version_${addon.folder}`) || TEXTS.versions.checking;
      const rawRemote = localStorage.getItem(`latest_${addon.folder}`) || TEXTS.versions.missing;
      const isInstalled = !["Ordner fehlt", "TOC fehlt", "Prüfen...", "Pfad ungültig", "Fehler", "Version unbekannt"].includes(rawLocal);
      const localNum = parseInt(rawLocal.replace(/\D/g, "")) || 0;
      const remoteNum = parseInt(rawRemote.replace(/\D/g, "")) || 0;
      const canUpdate = isInstalled && isTokenValid && rawRemote !== "AUTH_ERROR" && (remoteNum > localNum);
      
      if (canUpdate) updatesAvailableCount++;

      let actionHtml = '';
      if (!isInstalled) {
        actionHtml = `<button class="btn-primary install-btn" data-repo="${addon.repo}" data-folder="${addon.folder}" ${!isTokenValid ? 'disabled' : ''}>${TEXTS.buttons.install}</button>`;
      } else if (canUpdate) {
        actionHtml = `<button class="btn-update install-btn" data-repo="${addon.repo}" data-folder="${addon.folder}" ${!isTokenValid ? 'disabled' : ''}>${TEXTS.buttons.update}</button>`;
      } else {
        actionHtml = !isTokenValid ? `<span style="font-size: 1.2em">🔒</span>` : `<span class="status-ok">${TEXTS.buttons.current}</span>`;
      }

      const displayLocal = rawLocal === "Ordner fehlt" ? TEXTS.versions.folderMissing : (rawLocal === "TOC fehlt" ? TEXTS.versions.tocMissing : rawLocal);
      const displayRemote = rawRemote === "AUTH_ERROR" ? `<span style="color:#ff4444">${TEXTS.versions.tokenError}</span>` : rawRemote;

      return `
        <div class="addon-item">
          <div><span class="addon-name">${addon.label}</span><div class="version-row">${TEXTS.versions.localLabel} ${displayLocal} | ${TEXTS.versions.remoteLabel} ${displayRemote}</div></div>
          <div class="addon-actions">${actionHtml}${isInstalled ? `<button class="btn-delete delete-btn" data-folder="${addon.folder}" data-label="${addon.label}">🗑️</button>` : ''}</div>
        </div>`;
    };

    let html = mainAddons.map(renderAddon).join('');
    
    if (optionalAddons.length > 0) {
        html += `<div class="optional-separator"><span>${TEXTS.versions.optionalHeader}</span></div>`;
        html += optionalAddons.map(renderAddon).join('');
    }

    addonList.innerHTML = html;

    if (updateAllBtn) {
        updateAllBtn.disabled = !(updatesAvailableCount > 0 && isTokenValid);
        updateAllBtn.textContent = updatesAvailableCount > 0 ? `Alle aktualisieren (${updatesAvailableCount}) 🚀` : "Alles aktuell ✨";
    }
    
    document.querySelectorAll(".install-btn").forEach(btn => btn.addEventListener("click", (e) => install(e.target as HTMLButtonElement)));
    document.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", (e) => uninstall(e.currentTarget as HTMLButtonElement)));
    updateMainButton();
  }

  async function updateAll() {
      if (!isTokenValid || !currentWowPath) return;
      updateAllBtn.disabled = true;
      updateAllBtn.textContent = "Arbeite...";
      for (const addon of ADDONS) {
          const rawLocal = localStorage.getItem(`version_${addon.folder}`) || "";
          const rawRemote = localStorage.getItem(`latest_${addon.folder}`) || "";
          const localNum = parseInt(rawLocal.replace(/\D/g, "")) || 0;
          const remoteNum = parseInt(rawRemote.replace(/\D/g, "")) || 0;
          if (!["Ordner fehlt", "TOC fehlt"].includes(rawLocal) && remoteNum > localNum) {
              statusArea.textContent = `Aktualisiere ${addon.label}...`;
              try { await invoke("install_addon", { token: tokenInput.value, repo: addon.repo, name: addon.folder, path: currentWowPath }); }
              catch (e) { statusArea.textContent = `Fehler: ${e}`; }
          }
      }
      statusArea.textContent = "Alle Updates fertig!";
      await checkUpdates();
  }

  async function checkUpdates() {
    if (!currentWowPath || !isTokenValid) return;
    statusArea.textContent = TEXTS.status.searching;
    updateUI();
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
    const { repo, folder } = btn.dataset;
    btn.disabled = true; btn.textContent = TEXTS.buttons.wait;
    try {
      await invoke("install_addon", { token: tokenInput.value, repo, name: folder, path: currentWowPath });
      await checkUpdates();
    } catch (e) { 
        statusArea.textContent = `Fehler: ${e}`; 
        btn.disabled = false;
        btn.textContent = "Fehler";
    }
  }

  async function uninstall(btn: HTMLButtonElement) {
    const folderName = btn.dataset.folder;
    const label = btn.dataset.label;
    const yes = await ask(TEXTS.dialogs.deleteConfirm(label || ""), { title: TEXTS.dialogs.deleteTitle, kind: 'warning' });
    if (!yes) return;
    try {
      await invoke("uninstall_addon", { path: currentWowPath, name: folderName });
      localStorage.setItem(`version_${folderName}`, "Ordner fehlt");
      updateUI();
    } catch (e) { statusArea.textContent = `Fehler: ${e}`; }
  }

  async function selectPath() {
    const selected = await open({ directory: true });
    if (selected && typeof selected === 'string') {
      currentWowPath = selected;
      localStorage.setItem("moonup_wow_path", selected);
      pathDisplay.textContent = selected;
      updateMainButton();
      if(isTokenValid) checkUpdates();
    }
  }

  tokenInput.addEventListener("input", () => {
    localStorage.setItem("moonup_token", tokenInput.value);
    isTokenValid = false;
    updateUI(); 
  });

  checkTokenBtn.addEventListener("click", checkTokenOnline);
  refreshBtn.addEventListener("click", checkUpdates);
  updateAllBtn.addEventListener("click", updateAll);
  pathBtn.addEventListener("click", selectPath);
  pathDisplay.addEventListener("click", selectPath);

  deleteBtn.addEventListener("click", async () => {
      const confirmAll = await ask("Möchtest du wirklich ALLE Addons löschen?", { title: "Alle Addons löschen", kind: 'warning' });
      if (confirmAll) {
          statusArea.textContent = "Lösche alle Addons...";
          for (const addon of ADDONS) {
              await invoke("uninstall_addon", { path: currentWowPath, name: addon.folder });
              localStorage.setItem(`version_${addon.folder}`, "Ordner fehlt");
          }
          statusArea.textContent = "Alle Addons gelöscht.";
          updateUI();
      }
  });

  tokenInput.value = localStorage.getItem("moonup_token") || "";
  if (currentWowPath) pathDisplay.textContent = currentWowPath;
  updateUI();

  if(tokenInput.value) {
      await checkTokenOnline();
      if(isTokenValid && currentWowPath) checkUpdates();
  }
  setInterval(() => { if (tokenInput.value) checkTokenOnline(); }, 30 * 60 * 1000);
});