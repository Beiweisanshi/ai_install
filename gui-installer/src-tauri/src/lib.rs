mod backend;
mod commands;
mod config;
mod installer;
mod terminal;
mod types;
mod version;

use std::fs;

use serde_json::json;

fn autorun_tools() -> Option<Vec<String>> {
    let raw = std::env::var("GUI_INSTALLER_AUTORUN_TOOLS").ok()?;
    let tools = raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if tools.is_empty() { None } else { Some(tools) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let Some(tools) = autorun_tools() else {
                return Ok(());
            };

            let app_handle = app.handle().clone();
            let output_path = std::env::var("GUI_INSTALLER_AUTORUN_OUTPUT").ok();

            tauri::async_runtime::spawn(async move {
                let before = commands::detect_tools(app_handle.clone())
                    .await
                    .unwrap_or_default();
                let install = commands::install_tools(app_handle.clone(), tools.clone()).await;
                let after = commands::detect_tools(app_handle.clone())
                    .await
                    .unwrap_or_default();

                if let Some(path) = output_path {
                    let payload = json!({
                        "requested_tools": tools,
                        "detect_before": before,
                        "install": install,
                        "detect_after": after,
                    });

                    if let Ok(serialized) = serde_json::to_vec_pretty(&payload) {
                        let _ = fs::write(path, serialized);
                    }
                }

                let exit_code = match &install {
                    Ok(results) if results.iter().all(|result| result.success) => 0,
                    _ => 1,
                };
                app_handle.exit(exit_code);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_tools,
            commands::install_tools,
            commands::save_config,
            commands::get_app_version_info,
            commands::list_blocking_processes,
            commands::kill_blocking_processes,
            commands::launch_ai_tool,
            commands::backend_request,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
