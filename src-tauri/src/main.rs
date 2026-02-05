#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::fs;

// --- COMMANDS ---

#[tauri::command]
async fn get_installed_version(path: String, folder: String, search: String) -> String {
    let base_path = Path::new(&path);
    if !base_path.exists() { return "Pfad ungültig".to_string(); }

    let target_path = base_path.join(&folder);
    if !target_path.exists() || !target_path.is_dir() {
        return "Ordner fehlt".to_string();
    }

    let mut found_toc: Option<PathBuf> = None;
    
    if let Ok(entries) = fs::read_dir(&target_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().map_or(false, |ext| ext == "toc") {
                let stem = p.file_stem().unwrap_or_default().to_string_lossy().to_lowercase();
                if stem.contains(&search.to_lowercase()) {
                    found_toc = Some(p);
                    break;
                }
            }
        }
    }

    let toc_path = match found_toc {
        Some(t) => t,
        None => return "TOC fehlt".to_string(),
    };

    let changelog_path = target_path.join("CHANGELOG.md");
    if let Ok(content) = fs::read_to_string(changelog_path) {
        if let Some(start) = content.find("[v") {
            let sub = &content[start + 2..];
            if let Some(end) = sub.find(']') {
                return sub[..end].to_string();
            }
        }
    }

    if let Ok(file) = fs::File::open(&toc_path) {
        let reader = BufReader::new(file);
        for line in reader.lines().flatten() {
            if line.to_lowercase().contains("## version:") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() > 1 {
                    return parts[1].trim().to_string();
                }
            }
        }
    }

    "Installiert".to_string()
}

#[tauri::command]
async fn check_for_updates(token: String, repo: String) -> Result<String, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    
    let res = client.get(&url)
        .header("Authorization", format!("token {}", token.trim()))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Moonup")
        .send().await.map_err(|e| e.to_string())?;

    let status = res.status();

    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Ok("AUTH_ERROR".to_string());
    }

    if !status.is_success() {
        return Ok("Main".to_string());
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json["tag_name"].as_str().unwrap_or("Main").to_string())
}

#[tauri::command]
async fn install_addon(token: String, repo: String, name: String, path: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Client Fehler: {}", e))?;
    
    let release_url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    let res = client.get(&release_url)
        .header("Authorization", format!("token {}", token.trim()))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Moonup")
        .send().await;

    let mut download_url = String::new();
    let mut is_binary_asset = false;

    match res {
        Ok(response) if response.status().is_success() => {
            let json: serde_json::Value = response.json().await.unwrap_or_default();
            if let Some(assets) = json["assets"].as_array() {
                if !assets.is_empty() {
                    download_url = format!("https://api.github.com/repos/{}/releases/assets/{}", repo, assets[0]["id"]);
                    is_binary_asset = true; 
                } else {
                    let tag = json["tag_name"].as_str().unwrap_or("main");
                    download_url = format!("https://api.github.com/repos/{}/zipball/{}", repo, tag);
                }
            }
        },
        _ => {
            download_url = format!("https://api.github.com/repos/{}/zipball/main", repo);
        }
    }

    let mut request = client.get(&download_url)
        .header("Authorization", format!("token {}", token.trim()))
        .header("User-Agent", "Moonup");
    
    if is_binary_asset {
        request = request.header("Accept", "application/octet-stream");
    }

    let file_res = request.send().await.map_err(|e| format!("Download fehlgeschlagen: {}", e))?;
    let content = file_res.bytes().await.map_err(|e| format!("Bytes Fehler: {}", e))?;
    
    let target_dir = Path::new(&path).join(&name);
    if target_dir.exists() { fs::remove_dir_all(&target_dir).ok(); }
    fs::create_dir_all(&target_dir).map_err(|e| format!("Ordner Fehler: {}", e))?;
    
    #[allow(deprecated)]
    zip_extract::extract(Cursor::new(content), &target_dir, false).map_err(|e| format!("Entpacken Fehler: {}", e))?;

    if let Ok(entries) = fs::read_dir(&target_dir) {
        let items: Vec<_> = entries.flatten().collect();
        if items.len() == 1 && items[0].path().is_dir() {
            let nested_dir = items[0].path();
            if let Ok(sub_items) = fs::read_dir(&nested_dir) {
                for sub_item in sub_items.flatten() {
                    let from = sub_item.path();
                    let to = target_dir.join(from.file_name().unwrap());
                    fs::rename(from, to).ok();
                }
            }
            let _ = fs::remove_dir(nested_dir);
        }
    }
    
    Ok("OK".to_string())
}

#[tauri::command]
async fn uninstall_addon(path: String, name: String) -> Result<(), String> {
    let p = Path::new(&path).join(&name);
    if p.exists() { fs::remove_dir_all(p).map_err(|e| e.to_string())?; }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // --- NEU: Updater und Process Plugins aktiviert ---
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // --------------------------------------------------
        .invoke_handler(tauri::generate_handler![check_for_updates, install_addon, get_installed_version, uninstall_addon])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}