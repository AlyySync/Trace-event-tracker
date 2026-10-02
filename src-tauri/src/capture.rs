use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use serde::Serialize;
use std::io::Cursor;
use trace_core::Result;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub thumbnail: String,
    #[serde(skip)]
    pub pid: Option<u32>,
}
pub fn list_sources() -> Result<Vec<Source>> {
    // The current XCap adapter uses stable X11 source IDs. A persistent portal
    // session is required for reliable unattended Wayland capture; fail explicitly.
    #[cfg(target_os = "linux")]
    if std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
    {
        return Err("This capture adapter requires an X11 desktop session on Linux. Wayland portal capture is not implemented in this build.".into());
    }
    let mut result = vec![];
    for monitor in xcap::Monitor::all().map_err(|e| e.to_string())? {
        if let Ok(id) = monitor.id() {
            result.push(Source {
                id: format!("screen:{id}"),
                name: monitor
                    .friendly_name()
                    .or_else(|_| monitor.name())
                    .unwrap_or_else(|_| format!("Screen {id}")),
                kind: "screen".into(),
                thumbnail: String::new(),
                pid: None,
            });
        }
    }
    if let Ok(windows) = xcap::Window::all() {
        for window in windows {
            if window.pid().ok() == Some(std::process::id())
                || window.is_minimized().unwrap_or(true)
            {
                continue;
            }
            if let (Ok(id), Ok(title), Ok(pid)) = (window.id(), window.title(), window.pid()) {
                if title.trim().is_empty() {
                    continue;
                }
                result.push(Source {
                    id: format!("window:{id}"),
                    name: title,
                    kind: "window".into(),
                    thumbnail: String::new(),
                    pid: Some(pid),
                });
            }
        }
    }
    Ok(result)
}
pub fn frame(source: &Source) -> Result<RgbaImage> {
    if let Some(raw) = source.id.strip_prefix("screen:") {
        let id = raw.parse::<u32>().map_err(|e| e.to_string())?;
        let monitor = xcap::Monitor::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|item| item.id().ok() == Some(id))
            .ok_or("Selected screen is no longer available")?;
        monitor.capture_image().map_err(|e| e.to_string())
    } else if let Some(raw) = source.id.strip_prefix("window:") {
        let id = raw.parse::<u32>().map_err(|e| e.to_string())?;
        let window = xcap::Window::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|item| item.id().ok() == Some(id) && item.pid().ok() == source.pid)
            .ok_or("Selected window is no longer available")?;
        if window.is_minimized().unwrap_or(true) {
            return Err("Selected window was minimized. Reconnect to continue.".into());
        }
        window.capture_image().map_err(|e| e.to_string())
    } else {
        Err("Choose an available screen or window".into())
    }
}
pub fn resized(image: &RgbaImage, max_width: u32) -> RgbaImage {
    if image.width() <= max_width {
        return image.clone();
    }
    let height =
        ((image.height() as f64 * max_width as f64 / image.width() as f64).round() as u32).max(1);
    image::imageops::resize(image, max_width, height, FilterType::Triangle)
}
pub fn png(image: &RgbaImage, max_width: u32) -> Result<Vec<u8>> {
    let image = DynamicImage::ImageRgba8(resized(image, max_width));
    let mut bytes = Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(bytes.into_inner())
}
pub fn pixels(image: &RgbaImage) -> Vec<u8> {
    image::imageops::resize(image, 64, 36, FilterType::Triangle).into_raw()
}
