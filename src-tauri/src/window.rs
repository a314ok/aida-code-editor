use serde::Deserialize;
use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
    WebviewWindowBuilder,
};

#[derive(Deserialize)]
pub struct BrowserViewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

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

#[tauri::command]
pub async fn open_embedded_browser_view(
    app: AppHandle,
    label: String,
    url: String,
    bounds: BrowserViewBounds,
) -> Result<(), String> {
    let label = sanitize_label(&label);
    if label.is_empty() {
        return Err("Invalid browser view label".into());
    }

    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if let Some(webview) = app.get_webview(&label) {
        webview.navigate(parsed).map_err(|e| e.to_string())?;
        apply_browser_view_bounds(&webview, &bounds)?;
        webview.show().map_err(|e| e.to_string())?;
        webview.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed));
    let webview = main
        .add_child(
            builder,
            LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0)),
            LogicalSize::new(bounds.width.max(80.0), bounds.height.max(80.0)),
        )
        .map_err(|e| e.to_string())?;
    webview.set_auto_resize(false).map_err(|e| e.to_string())?;
    webview.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_embedded_browser_view_bounds(
    app: AppHandle,
    label: String,
    bounds: BrowserViewBounds,
    visible: bool,
) -> Result<(), String> {
    let label = sanitize_label(&label);
    if let Some(webview) = app.get_webview(&label) {
        apply_browser_view_bounds(&webview, &bounds)?;
        if visible {
            webview.show().map_err(|e| e.to_string())?;
        } else {
            webview.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_embedded_browser_view(app: AppHandle, label: String) -> Result<(), String> {
    let label = sanitize_label(&label);
    if let Some(webview) = app.get_webview(&label) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn apply_browser_view_bounds<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    bounds: &BrowserViewBounds,
) -> Result<(), String> {
    webview
        .set_position(LogicalPosition::new(bounds.x.max(0.0), bounds.y.max(0.0)))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(
            bounds.width.max(80.0),
            bounds.height.max(80.0),
        ))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn sanitize_label(value: &str) -> String {
    value
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                Some(ch)
            } else {
                None
            }
        })
        .collect()
}
