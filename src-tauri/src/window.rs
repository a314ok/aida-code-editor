use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn open_floating_window(
    app: AppHandle,
    title: String,
    url: String,
) -> Result<(), String> {
    WebviewWindowBuilder::new(&app, "floating", WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(400.0, 300.0)
        .decorations(true)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
