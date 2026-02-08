// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use reqwest::blocking::Client;

// --- HILFSFUNKTION: PFAD KORRIGIEREN ---
fn resolve_addon_path(user_path: &str) -> PathBuf {
    let path = Path::new(user_path);
    if path.ends_with("AddOns") { return path.to_path_buf(); }
    if path.ends_with("Interface") { return path.join("AddOns"); }
    path.join("Interface").join("AddOns")
}

// --- HILFSFUNKTION: WOW FARBCODES ENTFERNEN ---
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
fn validate_token(token: String) -> bool {
    let client = Client::new();
    let res = client.get("https://api.github.com/user")
        .header("User-Agent", "Moonup-App")
        .header("Authorization", format!("token {}", token))
        .send();

    match res {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false
    }
}

#[tauri::command]
fn get_installed_version(path: String, folder: String, _search: String) -> String {
    let addon_root = resolve_addon_path(&path);
    let full_addon_path = addon_root.join(&folder);
    
    if folder == "TimelineReminders" {
        for fname in ["CHANGELOG.md", "Changelog.md", "changelog.md"] {
            let c_path = full_addon_path.join(fname);
            if c_path.exists() {
                if let Ok(content) = fs::read_to_string(&c_path) {
                    for line in content.lines() {
                        let trimmed = line.trim();
                        if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.find(']')) {
                            let v = &trimmed[start+1..end];
                            if v.chars().any(|c| c.is_numeric()) {
                                return v.trim_start_matches(|c| c == 'v' || c == 'V').to_string();
                            }
                        }
                    }
                }
            }
        }
        return "Keine Version".to_string();
    }

    let toc_path = full_addon_path.join(format!("{}.toc", folder));
    if !full_addon_path.exists() { return "Ordner fehlt".to_string(); }
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
        return "Installiert (No Ver)".to_string();
    }
    "TOC fehlt".to_string()
}

#[tauri::command]
fn check_for_updates(token: String, repo: String) -> String {
    let client = Client::new();
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let res = client.get(&url)
        .header("User-Agent", "Moonup-App")
        .header("Authorization", format!("token {}", token))
        .send();

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>() {
                    return json["tag_name"].as_str().unwrap_or("Fehler").to_string();
                }
            }
            "AUTH_ERROR".to_string()
        },
        Err(_) => "Netzwerkfehler".to_string()
    }
}

// GEÄNDERT: 'async' entfernt, um Konflikt mit blocking client zu lösen
#[tauri::command]
fn install_addon(token: String, repo: String, _name: String, path: String) -> Result<(), String> {
    let client = Client::new();
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let resp = client.get(&url)
        .header("User-Agent", "Moonup-App")
        .header("Authorization", format!("token {}", token))
        .send().map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let assets = json["assets"].as_array().ok_or("Keine Assets gefunden")?;
    let zip_url = assets.iter()
        .find(|a| a["name"].as_str().unwrap_or("").ends_with(".zip"))
        .ok_or("Keine ZIP gefunden")?["url"].as_str().ok_or("URL fehlt")?;

    let zip_resp = client.get(zip_url)
        .header("User-Agent", "Moonup-App")
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/octet-stream")
        .send().map_err(|e| e.to_string())?;

    let bytes = zip_resp.bytes().map_err(|e| e.to_string())?;
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
        if file.name().ends_with('/') { fs::create_dir_all(&outpath).map_err(|e| e.to_string())?; }
        else {
            if let Some(p) = outpath.parent() { if !p.exists() { fs::create_dir_all(&p).map_err(|e| e.to_string())?; } }
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
        .invoke_handler(tauri::generate_handler![
            validate_token, 
            check_for_updates, 
            install_addon, 
            get_installed_version, 
            uninstall_addon
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}