import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { TEXTS, ADDONS } from "./config";

window.addEventListener("DOMContentLoaded", async () => {
  const pathDisplay = document.querySelector("#path-display") as HTMLElement;
  const tokenInput = document.querySelector("#token-input") as HTMLInputElement;
  const tokenAlert = document.querySelector("#token-alert") as HTMLElement;
  const addonList = document.querySelector("#addon-list") as HTMLElement;
  const statusArea = document.querySelector("#status-area") as HTMLElement;
  const refreshBtn = document.querySelector("#refresh-btn") as HTMLButtonElement;
  const pathBtn = document.querySelector("#change-path-btn") as HTMLButtonElement;

  refreshBtn.textContent = TEXTS.buttons.refresh;
  pathBtn.textContent = TEXTS.buttons.pathBtn;
  tokenAlert.textContent = TEXTS.alerts.noToken;

  let currentWowPath = localStorage.getItem("moonup_wow_path") || "";

  function validateToken() {
    const hasToken = tokenInput.value.trim().length > 0;
    tokenAlert.style.display = hasToken ? "none" : "block";
    refreshBtn.disabled = !currentWowPath;
    return hasToken;
  }

  function formatLocalStatus(rawStatus: string): string {
    if (rawStatus === "Ordner fehlt") return TEXTS.versions.folderMissing;
    if (rawStatus === "TOC fehlt") return TEXTS.versions.tocMissing;
    return rawStatus;
  }

  // NEU: Hilfsfunktion für Remote-Status
  function formatRemoteStatus(rawStatus: string): string {
    if (rawStatus === "AUTH_ERROR") return `<span style="color:#ff4444">${TEXTS.versions.tokenError}</span>`;
    return rawStatus;
  }

  async function updateUI() {
    const hasToken = tokenInput.value.trim().length > 0;
    
    addonList.innerHTML = ADDONS.map(addon => {
      const rawLocal = localStorage.getItem(`version_${addon.folder}`) || TEXTS.versions.checking;
      const rawRemote = localStorage.getItem(`latest_${addon.folder}`) || TEXTS.versions.missing;
      
      const displayLocal = formatLocalStatus(rawLocal);
      const displayRemote = formatRemoteStatus(rawRemote); // <-- Hier formatieren wir "AUTH_ERROR"

      const isInstalled = !["Ordner fehlt", "TOC fehlt", "Prüfen...", "Pfad ungültig", "Fehler"].includes(rawLocal);
      
      const localNum = parseInt(rawLocal.replace(/\D/g, "")) || 0;
      const remoteNum = parseInt(rawRemote.replace(/\D/g, "")) || 0;
      
      // Update Logik: Wenn AUTH_ERROR vorliegt, natürlich kein Update möglich
      const canUpdate = isInstalled && rawRemote !== "AUTH_ERROR" && (remoteNum > localNum || (rawRemote === "Main" && localNum === 0));

      let actionHtml = '';
      if (!isInstalled) {
        actionHtml = `
          <button class="btn-primary install-btn" 
                  data-repo="${addon.repo}" 
                  data-folder="${addon.folder}" 
                  ${!hasToken || rawRemote === "AUTH_ERROR" ? 'disabled' : ''}>
            ${TEXTS.buttons.install}
          </button>`;
      } else if (canUpdate) {
        actionHtml = `
          <button class="btn-update install-btn" 
                  data-repo="${addon.repo}" 
                  data-folder="${addon.folder}"
                  ${!hasToken || rawRemote === "AUTH_ERROR" ? 'disabled' : ''}>
            ${TEXTS.buttons.update}
          </button>`;
      } else {
        actionHtml = `<span class="status-ok">${TEXTS.buttons.current}</span>`;
      }

      const deleteHtml = isInstalled ? `
        <button class="btn-delete delete-btn" 
                data-folder="${addon.folder}" 
                data-label="${addon.label}"
                title="${TEXTS.buttons.deleteTitle}">
          🗑️
        </button>` : '';

      return `
        <div class="addon-item">
          <div>
            <span style="font-weight: bold;">${addon.label}</span>
            <div class="version-row">
                ${TEXTS.versions.localLabel} ${displayLocal} | ${TEXTS.versions.remoteLabel} ${displayRemote}
            </div>
          </div>
          <div class="addon-actions">
            ${actionHtml}
            ${deleteHtml}
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll(".install-btn").forEach(btn => btn.addEventListener("click", (e) => install(e.target as HTMLButtonElement)));
    document.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", (e) => uninstall(e.currentTarget as HTMLButtonElement)));
  }

  async function checkUpdates() {
    if (!currentWowPath) return;
    const hasToken = validateToken();
    statusArea.textContent = TEXTS.status.searching;
    
    for (const addon of ADDONS) {
      try {
        const v = await invoke("get_installed_version", { 
          path: currentWowPath, 
          folder: addon.folder, 
          search: addon.search 
        });
        localStorage.setItem(`version_${addon.folder}`, String(v));
        
        if (hasToken) {
          const rv = await invoke("check_for_updates", { token: tokenInput.value, repo: addon.repo });
          localStorage.setItem(`latest_${addon.folder}`, String(rv));
        } else {
          localStorage.setItem(`latest_${addon.folder}`, "?");
        }
      } catch (e) {
        localStorage.setItem(`version_${addon.folder}`, "Fehler");
      }
    }
    statusArea.textContent = TEXTS.status.ready;
    updateUI();
  }

  async function install(btn: HTMLButtonElement) {
    const token = tokenInput.value.trim();
    const { repo, folder } = btn.dataset;
    if (!token || !currentWowPath || !repo || !folder) return;
    
    btn.disabled = true; 
    btn.textContent = TEXTS.buttons.wait;
    statusArea.textContent = `${TEXTS.status.installing} ${folder}...`;

    try {
      await invoke("install_addon", { token, repo, name: folder, path: currentWowPath });
      statusArea.textContent = TEXTS.status.done;
      await checkUpdates();
    } catch (e) { 
      console.error(e);
      statusArea.textContent = `Fehler: ${e}`; 
      btn.disabled = false;
      btn.textContent = TEXTS.buttons.error;
    }
  }

  async function uninstall(btn: HTMLButtonElement) {
    const folderName = btn.dataset.folder;
    const label = btn.dataset.label;
    if (!currentWowPath || !folderName) return;

    const yes = await ask(TEXTS.dialogs.deleteConfirm(label || ""), { 
      title: TEXTS.dialogs.deleteTitle, 
      kind: 'warning', 
      okLabel: TEXTS.dialogs.deleteOk, 
      cancelLabel: TEXTS.dialogs.deleteCancel 
    });
    
    if (!yes) return;

    try {
      await invoke("uninstall_addon", { path: currentWowPath, name: folderName });
      localStorage.setItem(`version_${folderName}`, "Ordner fehlt");
      updateUI();
      statusArea.textContent = `${label} ${TEXTS.status.deleted}`;
    } catch (e) {
      statusArea.textContent = `Fehler: ${e}`;
    }
  }

  tokenInput.addEventListener("input", () => {
    localStorage.setItem("moonup_token", tokenInput.value);
    validateToken();
    updateUI(); 
  });

  refreshBtn.addEventListener("click", checkUpdates);

  document.querySelector("#change-path-btn")?.addEventListener("click", async () => {
    const selected = await open({ directory: true });
    if (selected && typeof selected === 'string') {
      currentWowPath = selected;
      localStorage.setItem("moonup_wow_path", selected);
      pathDisplay.textContent = selected;
      checkUpdates();
    }
  });

  tokenInput.value = localStorage.getItem("moonup_token") || "";
  if (currentWowPath) pathDisplay.textContent = currentWowPath;
  validateToken();
  updateUI();
  if (tokenInput.value && currentWowPath) checkUpdates();
});