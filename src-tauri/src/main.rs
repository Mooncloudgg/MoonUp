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
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

use std::sync::Mutex;
use std::collections::HashMap;
use std::time::{Instant, Duration};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    start_minimized: bool,
}

fn get_config_path() -> PathBuf {
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        PathBuf::from(local_app_data).join("Moonup").join("config.json")
    } else {
        PathBuf::from("moonup_config.json")
    }
}

fn load_app_config() -> AppConfig {
    let p = get_config_path();
    if let Ok(content) = fs::read_to_string(&p) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppConfig { start_minimized: false }
    }
}

fn save_app_config(cfg: &AppConfig) {
    let p = get_config_path();
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(cfg) {
        let _ = fs::write(&p, json);
    }
}

#[tauri::command]
fn set_start_minimized(enabled: bool) {
    let mut cfg = load_app_config();
    cfg.start_minimized = enabled;
    save_app_config(&cfg);
}

fn force_bring_to_front(w: &tauri::WebviewWindow) {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetForegroundWindow, ShowWindow, SW_RESTORE,
        };
        if let Ok(hwnd) = w.hwnd() {
            unsafe {
                let raw_hwnd = hwnd.0 as _;
                ShowWindow(raw_hwnd, SW_RESTORE);
                SetForegroundWindow(raw_hwnd);
            }
        }
    }
}

struct GithubCacheEntry {
    tag: String,
    etag: Option<String>,
    cached_at: Instant,
}

static GITHUB_RELEASE_CACHE: Mutex<Option<HashMap<String, GithubCacheEntry>>> = Mutex::new(None);

const API_BASE: &str = "https://mooncloud.team";
const APP_USER_AGENT: &str = "Moonup-App/2.0";
const CF_API_KEY: &str = "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm";

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyResult {
    pub valid: bool,
    pub status: u16,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AddonProgressPayload {
    pub id: String,
    pub stage: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreStats {
    pub files_restored: usize,
    pub total_bytes: u64,
}

fn get_api_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn get_download_client() -> Client {
    Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(60))
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
async fn detect_wow_path() -> Option<String> {
    tauri::async_runtime::spawn_blocking(detect_wow_path_sync).await.unwrap_or(None)
}

fn detect_wow_path_sync() -> Option<String> {
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
async fn verify_session(token: String) -> VerifyResult {
    tauri::async_runtime::spawn_blocking(move || verify_session_sync(token))
        .await
        .unwrap_or_else(|_| VerifyResult {
            valid: false,
            status: 0,
            message: "Interner Task-Fehler".to_string(),
        })
}

fn verify_session_sync(token: String) -> VerifyResult {
    if token.trim().is_empty() {
        return VerifyResult {
            valid: false,
            status: 401,
            message: "Kein Token vorhanden".to_string(),
        };
    }

    let client = get_api_client();
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
async fn get_installed_version(path: String, folder: String, search: String) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        get_installed_version_sync(path, folder, search)
    })
    .await
    .unwrap_or_else(|_| "Unbekannt".to_string())
}

fn get_installed_version_sync(path: String, folder: String, _search: String) -> String {
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
async fn check_for_updates(token: String, repo: String, provider: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_for_updates_sync(token, repo, provider)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn check_for_updates_sync(token: String, repo: String, provider: Option<String>) -> Result<String, String> {
    let client = get_api_client();
    let prov = provider.unwrap_or_else(|| "mooncloud".to_string());

    if prov == "curseforge" {
        // 1. Check curse.tools mirror first (fast & reliable)
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
                            if let Some(file_name) = first_file["fileName"].as_str() {
                                return Ok(file_name.replace(".zip", ""));
                            }
                        }
                    }
                }
            }
        }

        // 2. Fallback: CurseForge API directly
        let url = format!("https://api.curseforge.com/v1/mods/{}/files?pageSize=10", repo);
        if let Ok(resp) = client.get(&url).header(USER_AGENT, APP_USER_AGENT).header("x-api-key", CF_API_KEY).send() {
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

        return Ok("v1.0.0".to_string());
    }

    if prov == "github" {
        // 1. Check in-memory cache (30 second fast cache against spamming)
        let cached_etag = {
            let mut cache_lock = GITHUB_RELEASE_CACHE.lock().unwrap();
            let cache = cache_lock.get_or_insert_with(HashMap::new);
            if let Some(entry) = cache.get(&repo) {
                if entry.cached_at.elapsed() < Duration::from_secs(30) {
                    return Ok(entry.tag.clone());
                }
                entry.etag.clone()
            } else {
                None
            }
        };

        let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
        let mut req = client.get(&url).header(USER_AGENT, APP_USER_AGENT);
        if let Some(etag) = &cached_etag {
            req = req.header("If-None-Match", etag);
        }

        let res = req.send().map_err(|e| format!("Netzwerkfehler: {}", e))?;
        let status = res.status();

        if status.as_u16() == 304 {
            // Not Modified -> reuse cached tag and extend validity
            let mut cache_lock = GITHUB_RELEASE_CACHE.lock().unwrap();
            let cache = cache_lock.get_or_insert_with(HashMap::new);
            if let Some(entry) = cache.get_mut(&repo) {
                entry.cached_at = Instant::now();
                return Ok(entry.tag.clone());
            }
        }

        if status.is_success() {
            let new_etag = res.headers().get("etag").and_then(|h| h.to_str().ok()).map(|s| s.to_string());
            let json: serde_json::Value = res.json().map_err(|e| e.to_string())?;
            let tag = json["tag_name"].as_str().unwrap_or("").to_string();
            if !tag.is_empty() {
                let mut cache_lock = GITHUB_RELEASE_CACHE.lock().unwrap();
                let cache = cache_lock.get_or_insert_with(HashMap::new);
                cache.insert(repo.clone(), GithubCacheEntry {
                    tag: tag.clone(),
                    etag: new_etag,
                    cached_at: Instant::now(),
                });
                return Ok(tag);
            }
        }

        // Fallback: If GitHub rate limited (403), return cached version if available
        if status.as_u16() == 403 {
            let mut cache_lock = GITHUB_RELEASE_CACHE.lock().unwrap();
            let cache = cache_lock.get_or_insert_with(HashMap::new);
            if let Some(entry) = cache.get(&repo) {
                return Ok(entry.tag.clone());
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
async fn install_addon(app: tauri::AppHandle, token: String, repo: String, name: String, path: String, provider: Option<String>, direct_url: Option<String>, addon_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        install_addon_sync(app, token, repo, name, path, provider, direct_url, addon_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn install_addon_sync(app: tauri::AppHandle, token: String, repo: String, _name: String, path: String, provider: Option<String>, direct_url: Option<String>, addon_id: Option<String>) -> Result<(), String> {
    use std::io::Read;

    if token.trim().is_empty() {
        return Err("Login erforderlich. Bitte zuerst mit Discord anmelden.".to_string());
    }
    let client = get_download_client();
    let prov = provider.unwrap_or_else(|| "mooncloud".to_string());
    let aid = addon_id.unwrap_or_else(|| repo.clone());

    let mut resp = if let Some(url) = direct_url {
        client.get(&url)
            .header(USER_AGENT, APP_USER_AGENT)
            .send()
            .map_err(|e| format!("Download-Fehler: {}", e))?
    } else if prov == "curseforge" {
        let mut dl_url = String::new();

        // 1. Try curse.tools mirror first (fast & reliable)
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
                            } else if let (Some(file_id), Some(file_name)) = (first_file["id"].as_u64(), first_file["fileName"].as_str()) {
                                dl_url = format!("https://edge.forgecdn.net/files/{}/{}/{}", file_id / 1000, file_id % 1000, file_name);
                            }
                        }
                    }
                }
            }
        }

        // 2. Fallback to CurseForge official API
        if dl_url.is_empty() {
            let url = format!("https://api.curseforge.com/v1/mods/{}/files?pageSize=10", repo);
            if let Ok(cf_res) = client.get(&url).header(USER_AGENT, APP_USER_AGENT).header("x-api-key", CF_API_KEY).send() {
                if cf_res.status().is_success() {
                    if let Ok(json) = cf_res.json::<serde_json::Value>() {
                        if let Some(files) = json["data"].as_array() {
                            let target = files.iter().find(|f| f["releaseType"].as_u64() == Some(1))
                                .or_else(|| files.first());
                            if let Some(first_file) = target {
                                if let Some(url_str) = first_file["downloadUrl"].as_str() {
                                    dl_url = url_str.to_string();
                                } else if let (Some(file_id), Some(file_name)) = (first_file["id"].as_u64(), first_file["fileName"].as_str()) {
                                    dl_url = format!("https://edge.forgecdn.net/files/{}/{}/{}", file_id / 1000, file_id % 1000, file_name);
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

    let total_size = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::with_capacity(if total_size > 0 { total_size as usize } else { 1024 * 1024 });
    let mut chunk = [0u8; 32 * 1024];
    let mut last_emit = Instant::now();

    // Initial progress event
    let _ = app.emit("addon-progress", AddonProgressPayload {
        id: aid.clone(),
        stage: "downloading".to_string(),
        downloaded: 0,
        total: total_size,
        percent: 0,
    });

    loop {
        let n = resp.read(&mut chunk).map_err(|e| format!("Download-Lesefehler: {}", e))?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        downloaded += n as u64;

        if last_emit.elapsed() >= Duration::from_millis(80) || downloaded == total_size {
            let percent = if total_size > 0 {
                ((downloaded as f64 / total_size as f64) * 100.0).clamp(0.0, 100.0) as u8
            } else {
                0
            };
            let _ = app.emit("addon-progress", AddonProgressPayload {
                id: aid.clone(),
                stage: "downloading".to_string(),
                downloaded,
                total: total_size,
                percent,
            });
            last_emit = Instant::now();
        }
    }

    // Emit unpacking stage
    let _ = app.emit("addon-progress", AddonProgressPayload {
        id: aid.clone(),
        stage: "unpacking".to_string(),
        downloaded,
        total: total_size,
        percent: 100,
    });

    let addon_dir = resolve_addon_path(&path);
    if !addon_dir.exists() { 
        fs::create_dir_all(&addon_dir).map_err(|e| format!("Konnte Addon-Verzeichnis nicht erstellen: {}", e))?; 
    }

    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("ZIP-Archiv beschädigt: {}", e))?;

    // Canonicalize addon_dir for rock-solid boundary check
    let canonical_addon_dir = addon_dir.canonicalize().unwrap_or_else(|_| addon_dir.clone());

    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;

        // 1. Skip unix symlinks
        #[cfg(unix)]
        if let Some(mode) = file.unix_mode() {
            if (mode & 0o170000) == 0o120000 {
                continue; // Skip symlink
            }
        }

        // 2. Strict Zip-Slip Prevention
        let enclosed = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue, // Reject any path containing .. or root components
        };

        let outpath = addon_dir.join(&enclosed);

        // Verify that the resulting target is strictly inside addon_dir
        if let Ok(normalized) = outpath.canonicalize() {
            if !normalized.starts_with(&canonical_addon_dir) {
                return Err("Sicherheitsfehler: Ungültiger Dateipfad im Archiv (Zip-Slip)".to_string());
            }
        } else {
            // Path doesn't exist yet: check its ancestors
            let mut check_ancestor = outpath.as_path();
            while let Some(parent) = check_ancestor.parent() {
                if let Ok(canon_parent) = parent.canonicalize() {
                    if !canon_parent.starts_with(&canonical_addon_dir) {
                        return Err("Sicherheitsfehler: Zielverzeichnis außerhalb des Addon-Ordners".to_string());
                    }
                    break;
                }
                check_ancestor = parent;
            }
        }

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
async fn uninstall_addon(path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstall_addon_sync(path, name)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn uninstall_addon_sync(path: String, name: String) -> Result<(), String> {
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
async fn sync_addon_bridge(path: String, auto_update_enabled: bool, is_dev_version: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_addon_bridge_sync(path, auto_update_enabled, is_dev_version)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn sync_addon_bridge_sync(path: String, auto_update_enabled: bool, is_dev_version: bool) -> Result<(), String> {
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
async fn is_wow_running() -> bool {
    tauri::async_runtime::spawn_blocking(is_wow_running_sync)
        .await
        .unwrap_or(false)
}

fn is_wow_running_sync() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
        };

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return false;
            }

            let mut entry: PROCESSENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;

            let mut found = false;
            if Process32First(snapshot, &mut entry) != 0 {
                loop {
                    let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let exe_bytes: Vec<u8> = entry.szExeFile[..len].iter().map(|&c| c as u8).collect();
                    let exe_name = String::from_utf8_lossy(&exe_bytes).to_lowercase();

                    if exe_name == "wow.exe"
                        || exe_name == "wowclassic.exe"
                        || exe_name == "wow_classic.exe"
                        || exe_name == "wowt.exe"
                        || exe_name == "wowb.exe"
                    {
                        found = true;
                        break;
                    }

                    if Process32Next(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }

            CloseHandle(snapshot);
            return found;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ps")
            .args(["-A", "-c", "-o", "command"])
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            return text.contains("world of warcraft") 
                || text.contains("wow") 
                || text.contains("wowclassic");
        }
        false
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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

#[tauri::command]
async fn export_wow_backup(wow_path: String, target_zip_path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_wow_backup_sync(wow_path, target_zip_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn export_wow_backup_sync(wow_path: String, target_zip_path: String) -> Result<u64, String> {
    use std::fs::File;
    use std::io::{Read, Write};
    use walkdir::WalkDir;
    use zip::write::FileOptions;
    use zip::CompressionMethod;

    let addon_dir = resolve_addon_path(&wow_path);
    let interface_dir = if addon_dir.file_name().map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case("addons")) {
        addon_dir.parent().unwrap_or(&addon_dir).to_path_buf()
    } else {
        addon_dir.clone()
    };
    let retail_dir = interface_dir.parent().unwrap_or(&interface_dir).to_path_buf();
    let wtf_dir = retail_dir.join("WTF");

    if !interface_dir.exists() && !wtf_dir.exists() {
        return Err("Weder Interface- noch WTF-Ordner im angegebenen WoW-Pfad gefunden.".to_string());
    }

    let file = File::create(&target_zip_path).map_err(|e| format!("Konnte ZIP-Datei nicht erstellen: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let mut buffer = vec![0u8; 64 * 1024];
    let mut total_bytes_read: u64 = 0;

    let folders_to_zip = [("Interface", interface_dir), ("WTF", wtf_dir)];

    for (prefix, folder_path) in folders_to_zip {
        if !folder_path.exists() {
            continue;
        }

        for entry in WalkDir::new(&folder_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            let relative_path = match path.strip_prefix(&folder_path) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let relative_str = relative_path.to_string_lossy().replace('\\', "/");
            let zip_entry_name = if relative_str.is_empty() {
                format!("{}/", prefix)
            } else {
                format!("{}/{}", prefix, relative_str)
            };

            if path.is_dir() {
                let dir_name = if zip_entry_name.ends_with('/') {
                    zip_entry_name
                } else {
                    format!("{}/", zip_entry_name)
                };
                let _ = zip.add_directory(dir_name, options);
            } else if path.is_file() {
                let file_name = path.file_name().map_or("", |n| n.to_str().unwrap_or(""));
                if file_name.ends_with(".lock") || file_name.ends_with(".tmp") {
                    continue;
                }

                if let Ok(mut f) = File::open(path) {
                    if zip.start_file(zip_entry_name, options).is_ok() {
                        loop {
                            match f.read(&mut buffer) {
                                Ok(0) => break,
                                Ok(n) => {
                                    total_bytes_read += n as u64;
                                    if zip.write_all(&buffer[..n]).is_err() {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                }
            }
        }
    }

    zip.finish().map_err(|e| format!("Fehler beim Fertigstellen des ZIPs: {}", e))?;

    let final_size = fs::metadata(&target_zip_path).map(|m| m.len()).unwrap_or(total_bytes_read);
    Ok(final_size)
}

#[tauri::command]
async fn restore_wow_backup(wow_path: String, zip_path: String) -> Result<RestoreStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        restore_wow_backup_sync(wow_path, zip_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn restore_wow_backup_sync(wow_path: String, zip_path: String) -> Result<RestoreStats, String> {
    use std::fs::File;
    use std::io::Read;

    let addon_dir = resolve_addon_path(&wow_path);
    let interface_dir = if addon_dir.file_name().map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case("addons")) {
        addon_dir.parent().unwrap_or(&addon_dir).to_path_buf()
    } else {
        addon_dir.clone()
    };
    let retail_dir = interface_dir.parent().unwrap_or(&interface_dir).to_path_buf();
    let canonical_retail = retail_dir.canonicalize().unwrap_or_else(|_| retail_dir.clone());

    let zip_file = File::open(&zip_path).map_err(|e| format!("Konnte ZIP-Datei nicht öffnen: {}", e))?;
    let mut zip = zip::ZipArchive::new(zip_file).map_err(|e| format!("Ungültiges oder beschädigtes ZIP-Archiv: {}", e))?;

    // Validate that archive looks like a WoW UI Backup (contains interface/ or wtf/)
    let mut contains_wow_folders = false;
    for i in 0..zip.len() {
        if let Ok(entry) = zip.by_index(i) {
            let name_lower = entry.name().to_lowercase();
            if name_lower.starts_with("interface/") || name_lower.starts_with("wtf/") || name_lower.starts_with("interface\\") || name_lower.starts_with("wtf\\") {
                contains_wow_folders = true;
                break;
            }
        }
    }

    if !contains_wow_folders {
        return Err("Das Archiv enthält weder einen 'Interface'- noch einen 'WTF'-Ordner.".to_string());
    }

    let mut files_restored = 0usize;
    let mut total_bytes = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];

    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;

        // Skip unix symlinks
        #[cfg(unix)]
        if let Some(mode) = file.unix_mode() {
            if (mode & 0o170000) == 0o120000 {
                continue;
            }
        }

        // Strict Zip-Slip Prevention
        let enclosed = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };

        let outpath = retail_dir.join(&enclosed);

        if let Ok(normalized) = outpath.canonicalize() {
            if !normalized.starts_with(&canonical_retail) {
                return Err("Sicherheitsfehler: Ungültiger Dateipfad im Archiv (Zip-Slip)".to_string());
            }
        } else {
            let mut check_ancestor = outpath.as_path();
            while let Some(parent) = check_ancestor.parent() {
                if let Ok(canon_parent) = parent.canonicalize() {
                    if !canon_parent.starts_with(&canonical_retail) {
                        return Err("Sicherheitsfehler: Zielverzeichnis liegt außerhalb des WoW-Ordners".to_string());
                    }
                    break;
                }
                check_ancestor = parent;
            }
        }

        if file.name().ends_with('/') || file.name().ends_with('\\') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }

            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            loop {
                match file.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        use std::io::Write;
                        outfile.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
                        total_bytes += n as u64;
                    }
                    Err(e) => return Err(format!("Fehler beim Entpacken: {}", e)),
                }
            }
            files_restored += 1;
        }
    }

    Ok(RestoreStats {
        files_restored,
        total_bytes,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                force_bring_to_front(&w);
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let is_minimized_arg = args.iter().any(|a| a == "--minimized");
            let cfg = load_app_config();

            if let Some(w) = app.get_webview_window("main") {
                if is_minimized_arg && cfg.start_minimized {
                    let _ = w.hide();
                } else {
                    let _ = w.show();
                    let _ = w.unminimize();
                }
            }

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
                            force_bring_to_front(&w);
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
                                    force_bring_to_front(&w);
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
            set_start_minimized,
            sync_addon_bridge,
            is_wow_running,
            minimize_window,
            close_window,
            export_wow_backup,
            restore_wow_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}