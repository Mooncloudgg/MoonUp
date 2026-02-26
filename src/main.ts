import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { TEXTS, ADDONS, API_CONFIG } from "./config";
import { v4 as uuidv4 } from "uuid";

// Hilfsfunktion: Vergleicht Versionen vernünftig statt nur per parseInt
function isNewerVersion(local: string, remote: string): boolean {
    if (!remote || remote === TEXTS.versions.missing) return false;
    if (!local || local === TEXTS.versions.folderMissing || local.includes("fehlt")) return true;
    
    // Bereinige z.B. "v1.0" zu "1.0"
    const clean = (v: string) => v.replace(/^[vV]/, '').trim();
    const l = clean(local);
    const r = clean(remote);
    
    if (l === r) return false;
    
    // Splittet "1.0.0" in [1, 0, 0] und vergleicht Segment für Segment
    const lParts = l.split(/[\.-]/).map(p => parseInt(p) || 0);
    const rParts = r.split(/[\.-]/).map(p => parseInt(p) || 0);
    
    const len = Math.max(lParts.length, rParts.length);
    for (let i = 0; i < len; i++) {
        const lp = lParts[i] || 0;
        const rp = rParts[i] || 0;
        if (rp > lp) return true;
        if (rp < lp) return false;
    }
    return false;
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
      const pathDisplay = document.querySelector("#path-display") as HTMLElement;
      const loginBtn = document.querySelector("#login-btn") as HTMLButtonElement;
      const loginSection = document.querySelector("#login-section") as HTMLElement;
      const userDisplay = document.querySelector("#user-display") as HTMLElement;
      const usernameLabel = document.querySelector("#username-label") as HTMLElement;
      const logoutBtn = document.querySelector("#logout-btn") as HTMLElement;
      const loginStatus = document.querySelector("#login-status") as HTMLElement;
      const addonList = document.querySelector("#addon-list") as HTMLElement;
      const refreshBtn = document.querySelector("#refresh-btn") as HTMLButtonElement;
      const updateAllBtn = document.querySelector("#update-all-btn") as HTMLButtonElement;
      const deleteBtn = document.querySelector("#delete-btn") as HTMLButtonElement;
      const pathBtn = document.querySelector("#change-path-btn") as HTMLButtonElement;
      const statusArea = document.querySelector("#status-text") as HTMLElement;
      
      // Modal Elemente
      const openSettingsBtn = document.querySelector("#open-settings-btn") as HTMLButtonElement;
      const closeSettingsBtn = document.querySelector("#close-settings-btn") as HTMLElement;
      const settingsModal = document.querySelector("#settings-modal") as HTMLElement;
      const autostartCb = document.querySelector("#autostart-cb") as HTMLInputElement;

      let currentWowPath = localStorage.getItem("moonup_wow_path") || "";
      let authToken = localStorage.getItem("moonup_auth_token") || "";
      let authUser = localStorage.getItem("moonup_auth_user") || "";
      let loginInterval: number | null = null; 

      if (openSettingsBtn && settingsModal && closeSettingsBtn) {
          openSettingsBtn.addEventListener("click", () => {
              settingsModal.style.display = "flex"; 
          });
          closeSettingsBtn.addEventListener("click", () => {
              settingsModal.style.display = "none"; 
          });
          window.addEventListener("click", (e) => {
              if (e.target === settingsModal) {
                  settingsModal.style.display = "none";
              }
          });
      }

      if (autostartCb) {
          try {
            const active = await isEnabled();
            autostartCb.checked = active;
          } catch (e) { console.error("Autostart check failed:", e); }

          autostartCb.addEventListener("change", async () => {
              try {
                  if (autostartCb.checked) await enable();
                  else await disable();
              } catch (e) {
                  console.error("Autostart error:", e);
                  autostartCb.checked = !autostartCb.checked; 
                  alert("Fehler beim Autostart: " + e);
              }
          });
      }

      function updateAuthUI() {
        if (authToken) {
          loginSection.style.display = "none";
          userDisplay.style.display = "flex";
          if(updateAllBtn) updateAllBtn.style.display = "block";

          usernameLabel.textContent = authUser || "Mitglied";
          loginStatus.innerHTML = ""; // Komplette Leerung wichtig für CSS !empty Check
          updateUI(); 
          if(currentWowPath) checkUpdates();
        } else {
          loginSection.style.display = "block";
          userDisplay.style.display = "none";
          if(updateAllBtn) updateAllBtn.style.display = "none";

          ADDONS.forEach(a => localStorage.removeItem(`latest_${a.folder}`));
          updateUI(); 
        }
      }

      function logout() {
        if (loginInterval) clearInterval(loginInterval);
        authToken = "";
        authUser = "";
        localStorage.removeItem("moonup_auth_token");
        localStorage.removeItem("moonup_auth_user");
        ADDONS.forEach(a => localStorage.removeItem(`latest_${a.folder}`));
        updateAuthUI();
      }

      async function startDiscordLogin() {
        loginBtn.disabled = true;
        loginBtn.textContent = "Warte auf Browser...";
        
        loginStatus.innerHTML = `Bitte im Browser bestätigen...<br>
          <span id="cancel-login" style="color: #ef4444; text-decoration: underline; cursor: pointer; font-size: 0.75rem; margin-top: 5px; display: inline-block;">
            Vorgang abbrechen
          </span>`;

        const deviceId = uuidv4();
        const loginUrl = `${API_CONFIG.baseUrl}/auth/login?device_id=${deviceId}`;

        await shellOpen(loginUrl);

        setTimeout(() => {
            const cancelBtn = document.querySelector("#cancel-login");
            cancelBtn?.addEventListener("click", () => {
                if (loginInterval) clearInterval(loginInterval);
                loginBtn.disabled = false;
                loginBtn.textContent = "Login mit Discord";
                loginStatus.innerHTML = "";
            });
        }, 100);

        loginInterval = window.setInterval(async () => {
            try {
              const res = await fetch(`${API_CONFIG.baseUrl}/auth/check?device_id=${deviceId}`);
              if (!res.ok) return;
              const data = await res.json();
              
              if (data.status === "success") {
                if (loginInterval) clearInterval(loginInterval);
                authToken = data.token;
                authUser = data.username;
                localStorage.setItem("moonup_auth_token", authToken);
                localStorage.setItem("moonup_auth_user", authUser);
                updateAuthUI();
                loginBtn.disabled = false;
                loginBtn.textContent = "Login mit Discord";
              } else if (data.status === "denied") {
                if (loginInterval) clearInterval(loginInterval);
                alert("Zugriff verweigert: Die Discord Rolle fehlt.");
                loginBtn.disabled = false;
                loginBtn.textContent = "Login mit Discord";
                loginStatus.innerHTML = "";
              }
            } catch (e) { console.error("Polling...", e); }
        }, 2000);
      }

      async function checkUpdates() {
        if (!currentWowPath) return;
        statusArea.textContent = TEXTS.status.searching;
        
        for (const addon of ADDONS) {
          try {
            const v = await invoke("get_installed_version", { path: currentWowPath, folder: addon.folder, search: addon.search });
            localStorage.setItem(`version_${addon.folder}`, String(v));

            if(authToken) {
                const rv = await invoke("check_for_updates", { token: authToken, repo: addon.repo }) as string;
                if (rv === "AUTH_ERROR" || rv.includes("403")) { logout(); return; }
                localStorage.setItem(`latest_${addon.folder}`, rv);
            }
          } catch (e) { 
              console.error(e);
              if (String(e).includes("403")) { logout(); return; }
          }
        }
        statusArea.textContent = TEXTS.status.ready;
        updateUI();
      }

      async function install(btn: HTMLButtonElement) {
        if(!authToken || !currentWowPath) return;
        const { repo, folder } = btn.dataset;
        
        const ogText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="loader"></span> ${TEXTS.buttons.downloading}`;
        statusArea.textContent = TEXTS.status.installing + (btn.dataset.folder || "Addon");

        try {
          await invoke("install_addon", { token: authToken, repo, name: folder, path: currentWowPath });
          statusArea.textContent = TEXTS.status.done;
          await checkUpdates(); 
        } catch (e: any) { 
            if (String(e).includes("403")) logout();
            else alert("Fehler: " + e);
            btn.disabled = false;
            btn.innerHTML = ogText;
            statusArea.textContent = TEXTS.status.checkError;
        }
      }

      async function updateUI() {
        let updatesAvailableCount = 0;
        const mainAddons = ADDONS.filter(a => !(a as any).isOptional);
        const optionalAddons = ADDONS.filter(a => (a as any).isOptional);

        const renderAddon = (addon: any) => {
          let rawLocal = localStorage.getItem(`version_${addon.folder}`);
          
          if (!rawLocal || rawLocal === "Ordner fehlt") {
              rawLocal = TEXTS.versions.folderMissing;
          }

          const rawRemote = localStorage.getItem(`latest_${addon.folder}`) || TEXTS.versions.missing;
          const isInstalled = ![TEXTS.versions.folderMissing, "Ordner fehlt", "TOC fehlt"].includes(rawLocal);
          
          // NEUE VERSIONSPRÜFUNG
          const canUpdate = isInstalled && authToken && isNewerVersion(rawLocal, rawRemote);
          
          if (canUpdate) updatesAvailableCount++;

          let actionHtml = '';
          if (!isInstalled) {
            if (authToken && rawRemote !== TEXTS.versions.missing) {
                actionHtml = `<button class="btn-primary install-btn" data-repo="${addon.repo}" data-folder="${addon.folder}">${TEXTS.buttons.install}</button>`;
            } else {
                actionHtml = `🔒`;
            }
          } else if (canUpdate) {
            actionHtml = `<button class="btn-update install-btn" data-repo="${addon.repo}" data-folder="${addon.folder}">${TEXTS.buttons.update}</button>`;
          } else {
            actionHtml = !authToken ? `🔒` : `<span style="color:var(--success)">${TEXTS.buttons.current}</span>`;
          }

          return `
            <div class="addon-item">
              <div>
                  <span class="addon-name">${addon.label}</span>
                  <div class="version-row">${TEXTS.versions.localLabel} ${rawLocal} | ${TEXTS.versions.remoteLabel} ${rawRemote}</div>
              </div>
              <div class="addon-actions">
                  ${actionHtml}
                  ${isInstalled ? `<button class="btn-delete delete-btn" data-folder="${addon.folder}" data-label="${addon.label}">🗑️</button>` : ''}
              </div>
            </div>`;
        };

        addonList.innerHTML = mainAddons.map(renderAddon).join('') + 
          (optionalAddons.length ? `<div class="optional-separator"><span>${TEXTS.versions.optionalHeader}</span></div>` + optionalAddons.map(renderAddon).join('') : '');

        if (updateAllBtn) {
            updateAllBtn.disabled = !(updatesAvailableCount > 0 && authToken);
            updateAllBtn.textContent = updatesAvailableCount > 0 ? `Alles aktualisieren (${updatesAvailableCount}) 🚀` : "Alles aktuell ✨";
        }
        
        document.querySelectorAll(".install-btn").forEach(btn => btn.addEventListener("click", (e) => install(e.target as HTMLButtonElement)));
        document.querySelectorAll(".delete-btn").forEach(btn => btn.addEventListener("click", (e) => uninstall(e.currentTarget as HTMLButtonElement)));
      }

      async function uninstall(btn: HTMLButtonElement) {
        const folderName = btn.dataset.folder;
        if (await ask(TEXTS.dialogs.deleteConfirm(btn.dataset.label || ""), { kind: 'warning' })) {
          await invoke("uninstall_addon", { path: currentWowPath, name: folderName });
          localStorage.setItem(`version_${folderName}`, TEXTS.versions.folderMissing);
          updateUI();
        }
      }

      async function selectPath() {
        const selected = await open({ directory: true });
        if (selected && typeof selected === 'string') {
          currentWowPath = selected;
          localStorage.setItem("moonup_wow_path", selected);
          pathDisplay.textContent = selected;
          if(authToken) checkUpdates(); else updateUI();
        }
      }

      loginBtn.addEventListener("click", startDiscordLogin);
      logoutBtn.addEventListener("click", logout);
      refreshBtn.addEventListener("click", checkUpdates);
      
      updateAllBtn.addEventListener("click", async () => {
          updateAllBtn.disabled = true;
          // Variable komplett entfernt für sauberen Build!
          updateAllBtn.innerHTML = `<span class="loader"></span> ${TEXTS.buttons.downloading}`;
          
          for (const addon of ADDONS) {
              const rawLocal = localStorage.getItem(`version_${addon.folder}`) || "";
              const rawRemote = localStorage.getItem(`latest_${addon.folder}`) || "";
              
              if (rawLocal === TEXTS.versions.folderMissing || isNewerVersion(rawLocal, rawRemote)) {
                  statusArea.textContent = TEXTS.status.installing + addon.label;
                  try { await invoke("install_addon", { token: authToken, repo: addon.repo, name: addon.folder, path: currentWowPath }); }
                  catch (e) { console.error(e); }
              }
          }
          await checkUpdates();
      });
      
      pathBtn.addEventListener("click", selectPath);
      pathDisplay.addEventListener("click", selectPath);
      
      deleteBtn.addEventListener("click", async () => {
          if (await ask("Alle Mooncloud Addons löschen?", { kind: 'warning' })) {
              for (const addon of ADDONS) {
                  await invoke("uninstall_addon", { path: currentWowPath, name: addon.folder });
                  localStorage.setItem(`version_${addon.folder}`, TEXTS.versions.folderMissing);
              }
              updateUI();
          }
      });

      if (currentWowPath) pathDisplay.textContent = currentWowPath;
      updateAuthUI();

  } catch(err) { console.error(err); }
});