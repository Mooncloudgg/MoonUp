// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use reqwest::blocking::Client;
use reqwest::header::USER_AGENT;
// NEU: Autostart Import
use tauri_plugin_autostart::MacosLauncher;

// DEINE SERVER URL
const API_BASE: &str = "https://moonup-auth.duckdns.org:5000";

fn resolve_addon_path(user_path: &str) -> PathBuf {
    let path = Path::new(user_path);
    if path.ends_with("AddOns") { return path.to_path_buf(); }
    if path.ends_with("Interface") { return path.join("AddOns"); }
    path.join("Interface").join("AddOns")
}

fn clean_wow_string(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '|' {
            if let Some(&next) = chars.peek() {
                if next == 'c' { chars.next(); for _ in 0..8 { chars.next(); } continue; }
                else if next == 'r' { chars.next(); continue; }
            }
        }
        output.push(c);
    }
    output.trim().to_string()
}

#[tauri::command]
fn get_installed_version(path: String, folder: String, _search: String) -> String {
    let addon_root = resolve_addon_path(&path);
    let full_addon_path = addon_root.join(&folder);
    
    if !full_addon_path.exists() { return "Nicht installiert".to_string(); }
    
    // 1. VERSUCH: Changelog Parsing
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

    // 2. VERSUCH: TOC Parsing
    let toc_path = full_addon_path.join(format!("{}.toc", folder));
    if let Ok(content) = fs::read_to_string(&toc_path) {
        for line in content.lines() {
            let lower = line.to_lowercase();
            let trimmed = line.trim();
            if lower.starts_with("##") && lower.contains("version") {
                if let Some(idx) = trimmed.find(':') {
                    let raw_ver = &trimmed[idx+1..];
                    let clean = clean_wow_string(raw_ver);
                    if !clean.is_empty() { return clean; }
                }
            }
        }
    }
    "Unbekannt".to_string()
}

#[tauri::command]
fn check_for_updates(token: String, repo: String) -> String {
    let client = Client::new();
    let url = format!("{}/api/version?repo={}", API_BASE, repo);
    
    let res = client.get(&url)
        .header(USER_AGENT, "Moonup-App")
        .header("Authorization", token)
        .send();

    match res {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>() {
                    return json["tag_name"].as_str().unwrap_or("Fehler").to_string();
                }
            }
            if status.as_u16() == 401 || status.as_u16() == 403 { return "AUTH_ERROR".to_string(); }
            format!("Err: {}", status)
        },
        Err(_) => "Netzwerkfehler".to_string()
    }
}

#[tauri::command]
fn install_addon(token: String, repo: String, _name: String, path: String) -> Result<(), String> {
    let client = Client::new();
    let url = format!("{}/api/download?repo={}", API_BASE, repo);
    
    let resp = client.get(&url)
        .header(USER_AGENT, "Moonup-App")
        .header("Authorization", token)
        .send().map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Server Fehler: {}", resp.status()));
    }

    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    let addon_dir = resolve_addon_path(&path);
    if !addon_dir.exists() { fs::create_dir_all(&addon_dir).map_err(|e| e.to_string())?; }

    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

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
                if !p.exists() { fs::create_dir_all(&p).map_err(|e| e.to_string())?; } 
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
    if target.exists() { fs::remove_dir_all(target).map_err(|e| e.to_string())?; }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // NEU: Autostart Plugin Initialisierung
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![]))) 
        .invoke_handler(tauri::generate_handler![
            check_for_updates, 
            install_addon, 
            get_installed_version, 
            uninstall_addon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}