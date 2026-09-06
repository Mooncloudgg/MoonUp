// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use reqwest::blocking::Client;
use reqwest::header::{USER_AGENT, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

const API_BASE: &str = "https://mooncloud.team";
const APP_USER_AGENT: &str = "Moonup-App/2.0";
const CF_API_KEY: &str = "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm";

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyResult {
    pub valid: bool,
    pub status: u16,
    pub message: String,
}

fn get_http_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn resolve_addon_path(user_path: &str) -> PathBuf {
    let clean_str = user_path.trim_end_matches(['/', '\\']);
    let p = PathBuf::from(clean_str);
    let lower = clean_str.to_lowercase();

    // 1. Wenn der Pfad bereits auf addons/addon endet -> direkt nutzen
    if lower.ends_with("addons") || lower.ends_with("addon") {
        return p;
    }

    // 2. Wenn der Pfad auf interface endet -> nur AddOns anhängen
    if lower.ends_with("interface") {
        return p.join("AddOns");
    }

    // 3. Wenn der Pfad auf einen WoW-Flavor endet (_retail_, _classic_, etc.)
    if lower.ends_with("_retail_") || lower.ends_with("_classic_") || lower.ends_with("_ptr_") || lower.ends_with("_beta_") || lower.ends_with("_classic_era_") {
        return p.join("Interface").join("AddOns");
    }

    // 4. Wenn der Hauptordner gewählt wurde und _retail_ existiert
    if p.join("_retail_").join("Interface").join("AddOns").exists() {
        return p.join("_retail_").join("Interface").join("AddOns");
    }

    // 5. Wenn Interface/AddOns existiert
    if p.join("Interface").join("AddOns").exists() {
        return p.join("Interface").join("AddOns");
    }

    // 6. Fallback: Wenn irgendwo _retail_ vorkommt
    if lower.contains("_retail_") {
        return p.join("Interface").join("AddOns");
    }

    // Sicherer Standard: Wenn nichts zutrifft, aber _retail_ existieren könnte
    p.join("_retail_").join("Interface").join("AddOns")
}

fn clean_wow_string(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '|' {
            if let Some(&next) = chars.peek() {
                if next == 'c' || next == 'C' { 
                    chars.next(); 
                    for _ in 0..8 { chars.next(); } 
                    continue; 
                } else if next == 'r' || next == 'R' { 
                    chars.next(); 
                    continue; 
                }
            }
        }
        output.push(c);
    }
    output.trim().to_string()
}

#[tauri::command]
fn detect_wow_path() -> Option<String> {
    let candidate_paths = [
        r"C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns",
        r"C:\Program Files\World of Warcraft\_retail_\Interface\AddOns",
        r"D:\World of Warcraft\_retail_\Interface\AddOns",
        r"D:\Games\World of Warcraft\_retail_\Interface\AddOns",
        r"D:\Spiele\World of Warcraft\_retail_\Interface\AddOns",
        r"E:\World of Warcraft\_retail_\Interface\AddOns",
        r"E:\Games\World of Warcraft\_retail_\Interface\AddOns",
        r"F:\World of Warcraft\_retail_\Interface\AddOns",
        r"C:\World of Warcraft\_retail_\Interface\AddOns",
        // macOS
        "/Applications/World of Warcraft/_retail_/Interface/AddOns",
    ];

    for path_str in candidate_paths {
        let p = Path::new(path_str);
        if p.exists() && p.is_dir() {
            return Some(path_str.to_string());
        }
    }

    // Secondary check for root _retail_ folders
    let retail_candidates = [
        r"C:\Program Files (x86)\World of Warcraft\_retail_",
        r"C:\Program Files\World of Warcraft\_retail_",
        r"D:\World of Warcraft\_retail_",
        r"D:\Games\World of Warcraft\_retail_",
        r"E:\World of Warcraft\_retail_",
        r"C:\World of Warcraft\_retail_",
        "/Applications/World of Warcraft/_retail_",
    ];

    for path_str in retail_candidates {
        let p = Path::new(path_str);
        if p.exists() && p.is_dir() {
            let addons = p.join("Interface").join("AddOns");
            if addons.exists() {
                return Some(addons.to_string_lossy().to_string());
            }
        }
    }

    None
}

#[tauri::command]
fn verify_session(token: String) -> VerifyResult {
    if token.trim().is_empty() {
        return VerifyResult {
            valid: false,
            status: 401,
            message: "Kein Token vorhanden".to_string(),
        };
    }

    let client = get_http_client();
    let url = format!("{}/api/version?repo=Mooncloudgg/MooncloudTools", API_BASE);

    let res = client.get(&url)
        .header(USER_AGENT, APP_USER_AGENT)
        .header(AUTHORIZATION, &token)
        .send();

    match res {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if status == 200 {
                VerifyResult {
                    valid: true,
                    status: 200,
                    message: "Sitzung gültig".to_string(),
                }
            } else if status == 401 {
                VerifyResult {
                    valid: false,
                    status: 401,
                    message: "Sitzung abgelaufen. Bitte erneut einloggen.".to_string(),
                }
            } else if status == 403 {
                VerifyResult {
                    valid: false,
                    status: 403,
                    message: "Zugriff verweigert: Discord-Rolle fehlt oder wurde entzogen.".to_string(),
                }
            } else {
                VerifyResult {
                    valid: false,
                    status,
                    message: format!("Server antwortete mit Status {}", status),
                }
            }
        },
        Err(e) => VerifyResult {
            valid: false,
            status: 0,
            message: format!("Netzwerkfehler: {}", e),
        }
    }
}

#[tauri::command]
fn get_installed_version(path: String, folder: String, _search: String) -> String {
    let addon_root = resolve_addon_path(&path);
    let full_addon_path = addon_root.join(&folder);
    
    if !full_addon_path.exists() { 
        return "Nicht installiert".to_string(); 
    }
    
    // 1. VERSUCH: TOC Parsing (Primary for WoW Addons)
    let toc_names = [
        format!("{}.toc", folder),
        format!("{}_Mainline.toc", folder),
        format!("{}-Mainline.toc", folder),
    ];

    for toc_name in &toc_names {
        let toc_path = full_addon_path.join(toc_name);
        if toc_path.exists() {
            if let Ok(content) = fs::read_to_string(&toc_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    let lower = trimmed.to_lowercase();
                    if lower.starts_with("##") && lower.contains("version") {
                        if let Some(idx) = trimmed.find(':') {
                            let raw_ver = &trimmed[idx+1..];
                            let clean = clean_wow_string(raw_ver);
                            if !clean.is_empty() { 
                                return clean; 
                            }
                        }
                    }
                }
            }
        }
    }

    // Scan any .toc file in folder if specific name wasn't found
    if let Ok(entries) = fs::read_dir(&full_addon_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().map_or(false, |ext| ext == "toc") {
                if let Ok(content) = fs::read_to_string(&p) {
                    for line in content.lines() {
                        let trimmed = line.trim();
                        let lower = trimmed.to_lowercase();
                        if lower.starts_with("##") && lower.contains("version") {
                            if let Some(idx) = trimmed.find(':') {
                                let raw_ver = &trimmed[idx+1..];
                                let clean = clean_wow_string(raw_ver);
                                if !clean.is_empty() { 
                                    return clean; 
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. VERSUCH: Changelog / Readme Parsing
    let md_names = ["CHANGELOG.md", "Changelog.md", "changelog.md", "README.md", "Readme.md"];
    
    for md_name in md_names {
        let md_path = full_addon_path.join(md_name);
        if md_path.exists() {
            if let Ok(content) = fs::read_to_string(&md_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("##") && trimmed.contains('[') {
                        if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.find(']')) {
                            if end > start {
                                let ver_candidate = &trimmed[start+1..end];
                                if ver_candidate.starts_with('v') || ver_candidate.starts_with('V') || ver_candidate.chars().any(|c| c.is_numeric()) {
                                    return ver_candidate.to_string();
                                }
                            }
                        }
                    }
                    if trimmed.starts_with("# v") || trimmed.starts_with("# V") {
                         let clean = trimmed.trim_matches('#').trim();
                         if clean.len() < 15 { return clean.to_string(); }
                    }
                }
            }
        }
    }

    "Unbekannt".to_string()
}

#[tauri::command]
fn check_for_updates(token: String, repo: String, provider: Option<String>) -> Result<String, String> {
    let client = get_http_client();
    let prov = provider.unwrap_or_else(|| "mooncloud".to_string());

    if prov == "curseforge" {
        // Query CurseForge API - prefer stable releases (releaseType == 1)
        let url = format!("https://api.curseforge.com/v1/mods/{}/files?pageSize=10", repo);
        let res = client.get(&url)
            .header(USER_AGENT, APP_USER_AGENT)
            .header("x-api-key", CF_API_KEY)
            .send();

        if let Ok(resp) = res {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>() {
                    if let Some(files) = json["data"].as_array() {
                        let target = files.iter().find(|f| f["releaseType"].as_u64() == Some(1))
                            .or_else(|| files.first());
                        if let Some(first_file) = target {
                            if let Some(display_name) = first_file["displayName"].as_str() {
                                return Ok(display_name.to_string());
                            }
                            if let Some(file_name) = first_file["fileName"].as_str() {
                                return Ok(file_name.replace(".zip", ""));
                            }
                        }
                    }
                }
            }
        }

        // Fallback: Curse.tools mirror
        let fallback_url = format!("https://api.curse.tools/v1/cf/mods/{}/files", repo);
        if let Ok(f_resp) = client.get(&fallback_url).header(USER_AGENT, APP_USER_AGENT).send() {
            if f_resp.status().is_success() {
                if let Ok(json) = f_resp.json::<serde_json::Value>() {
                    if let Some(files) = json["data"].as_array() {
                        let target = files.iter().find(|f| f["releaseType"].as_u64() == Some(1))
                            .or_else(|| files.first());
                        if let Some(first_file) = target {
                            if let Some(display_name) = first_file["displayName"].as_str() {
                                return Ok(display_name.to_string());
                            }
                        }
                    }
                }
            }
        }

        return Ok("v1.0.0".to_string());
    }

    if prov == "github" {
        let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
        let res = client.get(&url)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .map_err(|e| format!("Netzwerkfehler: {}", e))?;

        let status = res.status();
        if status.is_success() {
            let json: serde_json::Value = res.json().map_err(|e| e.to_string())?;
            let tag = json["tag_name"].as_str().unwrap_or("").to_string();
            if !tag.is_empty() {
                return Ok(tag);
            }
        }
        return Err(format!("GitHub Fehler: Status {}", status));
    }

    // Default: Mooncloud Secured API
    let url = format!("{}/api/version?repo={}", API_BASE, repo);
    let mut req = client.get(&url).header(USER_AGENT, APP_USER_AGENT);
    if !token.is_empty() {
        req = req.header(AUTHORIZATION, &token);
    }
    
    let res = req.send().map_err(|e| format!("Netzwerkfehler: {}", e))?;
    let status = res.status();

    if status.is_success() {
        let json: serde_json::Value = res.json().map_err(|e| e.to_string())?;
        let tag = json["tag_name"].as_str().unwrap_or("").to_string();
        if !tag.is_empty() {
            return Ok(tag);
        }
        return Ok("v1.0.0".to_string());
    }

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("AUTH_ERROR".to_string());
    }

    Err(format!("Err: {}", status))
}

#[tauri::command]
fn install_addon(token: String, repo: String, _name: String, path: String, provider: Option<String>, direct_url: Option<String>) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Login erforderlich. Bitte zuerst mit Discord anmelden.".to_string());
    }
    let client = get_http_client();
    let prov = provider.unwrap_or_else(|| "mooncloud".to_string());

    let resp = if let Some(url) = direct_url {
        client.get(&url)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .map_err(|e| format!("Download-Fehler: {}", e))?
    } else if prov == "curseforge" {
        // Fetch latest stable release file info from CurseForge
        let url = format!("https://api.curseforge.com/v1/mods/{}/files?pageSize=10", repo);
        let cf_res = client.get(&url)
            .header(USER_AGENT, APP_USER_AGENT)
            .header("x-api-key", CF_API_KEY)
            .send()
            .map_err(|e| format!("CurseForge Abruf fehlgeschlagen: {}", e))?;

        let mut dl_url = String::new();
        if cf_res.status().is_success() {
            if let Ok(json) = cf_res.json::<serde_json::Value>() {
                if let Some(files) = json["data"].as_array() {
                    let target = files.iter().find(|f| f["releaseType"].as_u64() == Some(1))
                        .or_else(|| files.first());
                    if let Some(first_file) = target {
                        if let Some(url_str) = first_file["downloadUrl"].as_str() {
                            dl_url = url_str.to_string();
                        } else if let (Some(file_id), Some(file_name)) = (first_file["id"].as_u64(), first_file["fileName"].as_str()) {
                            // Construct standard Curse CDN Edge URL
                            dl_url = format!("https://edge.forgecdn.net/files/{}/{}/{}", file_id / 1000, file_id % 1000, file_name);
                        }
                    }
                }
            }
        }

        if dl_url.is_empty() {
            // Fallback to curse.tools
            let fallback_url = format!("https://api.curse.tools/v1/cf/mods/{}/files", repo);
            if let Ok(f_resp) = client.get(&fallback_url).header(USER_AGENT, APP_USER_AGENT).send() {
                if f_resp.status().is_success() {
                    if let Ok(json) = f_resp.json::<serde_json::Value>() {
                        if let Some(files) = json["data"].as_array() {
                            let target = files.iter().find(|f| f["releaseType"].as_u64() == Some(1))
                                .or_else(|| files.first());
                            if let Some(first_file) = target {
                                if let Some(url_str) = first_file["downloadUrl"].as_str() {
                                    dl_url = url_str.to_string();
                                }
                            }
                        }
                    }
                }
            }
        }

        if dl_url.is_empty() {
            return Err("Konnte keinen Download-Link von CurseForge abrufen.".to_string());
        }

        client.get(&dl_url)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .map_err(|e| format!("Download fehlgeschlagen: {}", e))?
    } else if prov == "github" {
        // Fetch latest release asset or zipball
        let release_url = format!("https://api.github.com/repos/{}/releases/latest", repo);
        let rel_resp = client.get(&release_url)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .map_err(|e| format!("Release-Abruf fehlgeschlagen: {}", e))?;

        if !rel_resp.status().is_success() {
            return Err(format!("GitHub Release Fehler: {}", rel_resp.status()));
        }

        let rel_json: serde_json::Value = rel_resp.json().map_err(|e| e.to_string())?;
        let mut download_target_url = String::new();

        if let Some(assets) = rel_json["assets"].as_array() {
            for asset in assets {
                if let Some(name) = asset["name"].as_str() {
                    if name.ends_with(".zip") {
                        if let Some(dl_url) = asset["browser_download_url"].as_str() {
                            download_target_url = dl_url.to_string();
                            break;
                        }
                    }
                }
            }
        }

        if download_target_url.is_empty() {
            if let Some(zipball) = rel_json["zipball_url"].as_str() {
                download_target_url = zipball.to_string();
            } else {
                return Err("Kein Download-Paket im GitHub Release gefunden".to_string());
            }
        }

        client.get(&download_target_url)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .map_err(|e| format!("Download fehlgeschlagen: {}", e))?
    } else {
        // Mooncloud API
        let url = format!("{}/api/download?repo={}", API_BASE, repo);
        client.get(&url)
            .header(USER_AGENT, APP_USER_AGENT)
            .header(AUTHORIZATION, &token)
            .send()
            .map_err(|e| format!("Download fehlgeschlagen: {}", e))?
    };

    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("AUTH_ERROR".to_string());
    }
    if !status.is_success() {
        return Err(format!("Download-Server Fehler: {}", status));
    }

    let bytes = resp.bytes().map_err(|e| format!("Fehler beim Lesen der Daten: {}", e))?;
    let addon_dir = resolve_addon_path(&path);
    if !addon_dir.exists() { 
        fs::create_dir_all(&addon_dir).map_err(|e| format!("Konnte Addon-Verzeichnis nicht erstellen: {}", e))?; 
    }

    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("ZIP-Archiv beschädigt: {}", e))?;

    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => addon_dir.join(path),
            None => continue, 
        };

        if file.name().ends_with('/') { 
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?; 
        } else {
            if let Some(p) = outpath.parent() { 
                if !p.exists() { 
                    fs::create_dir_all(&p).map_err(|e| e.to_string())?; 
                } 
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn uninstall_addon(path: String, name: String) -> Result<(), String> {
    let target = resolve_addon_path(&path).join(&name);
    if target.exists() { 
        fs::remove_dir_all(&target).map_err(|e| format!("Konnte Ordner nicht entfernen: {}", e))?; 
    }
    Ok(())
}

#[tauri::command]
fn open_in_explorer(path: String, folder: Option<String>) -> Result<(), String> {
    let mut resolved = resolve_addon_path(&path);
    if let Some(f) = folder {
        if !f.trim().is_empty() {
            let child = resolved.join(&f);
            if child.exists() {
                resolved = child;
            }
        }
    }
    if !resolved.exists() {
        return Err("Verzeichnis existiert nicht".to_string());
    }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn sync_addon_bridge(path: String, auto_update_enabled: bool, is_dev_version: bool) -> Result<(), String> {
    let addon_dir = resolve_addon_path(&path);
    let bridge_file = addon_dir.join("MooncloudTools").join("MoonupBridge.lua");
    if let Some(parent) = bridge_file.parent() {
        if parent.exists() {
            let content = format!(
                "-- Auto-generated by Moonup\nMOONUP_AUTO_UPDATE = {}\nMOONUP_DEV_VERSION = {}\n",
                auto_update_enabled, is_dev_version
            );
            let _ = fs::write(&bridge_file, content);
        }
    }
    Ok(())
}

#[tauri::command]
fn is_wow_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = std::process::Command::new("tasklist")
            .args(["/NH", "/FO", "CSV"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            return text.contains("wow.exe")
                || text.contains("wowclassic.exe")
                || text.contains("wow_classic.exe")
                || text.contains("wowt.exe")
                || text.contains("wowb.exe");
        }
    }
    false
}

#[tauri::command]
fn minimize_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn close_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .setup(|app| {
            // Context menu for System Tray
            let show_i = MenuItemBuilder::with_id("show", "Moonup öffnen").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Beenden").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_i)
                .separator()
                .item(&quit_i)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Moonup")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if let Ok(visible) = w.is_visible() {
                                if visible {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.unminimize();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            detect_wow_path,
            verify_session,
            check_for_updates, 
            install_addon, 
            get_installed_version, 
            uninstall_addon,
            open_in_explorer,
            set_close_to_tray,
            sync_addon_bridge,
            is_wow_running,
            minimize_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}