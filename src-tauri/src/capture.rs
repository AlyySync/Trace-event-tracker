use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use serde::Serialize;
use std::io::Cursor;
use std::sync::Arc;
use trace_core::Result;

#[cfg(target_os = "linux")]
use std::sync::{Condvar, Mutex};
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};

const PORTAL_SOURCE: &str = "portal:select";
const PORTAL_ALL_SOURCE: &str = "portal:all";

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

#[cfg(target_os = "linux")]
fn wayland_session(session: Option<&str>, display: Option<&str>) -> bool {
    session == Some("wayland")
        || display.is_some_and(|value| value.to_ascii_lowercase().contains("wayland"))
}

pub fn is_wayland() -> bool {
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").ok();
        let display = std::env::var("WAYLAND_DISPLAY").ok();
        return wayland_session(session.as_deref(), display.as_deref());
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

pub fn list_sources() -> Result<Vec<Source>> {
    if is_wayland() {
        let mut sources = vec![Source {
            id: PORTAL_SOURCE.into(),
            name: "One screen (choose in Ubuntu's sharing dialog)".into(),
            kind: "screen".into(),
            thumbnail: String::new(),
            pid: None,
        }];
        if xcap::Monitor::all().map_err(|e| e.to_string())?.len() > 1 {
            sources.push(Source {
                id: PORTAL_ALL_SOURCE.into(),
                name: "Both screens (choose both in Ubuntu's dialog)".into(),
                kind: "screen".into(),
                thumbnail: String::new(),
                pid: None,
            });
        }
        return Ok(sources);
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

#[derive(Clone)]
pub struct CaptureHandle {
    source: Source,
    portal: Option<Arc<PortalCapture>>,
}

impl CaptureHandle {
    pub fn connect(source: Source, previous_portal: Option<Arc<PortalCapture>>) -> Result<Self> {
        if source.id == PORTAL_SOURCE || source.id == PORTAL_ALL_SOURCE {
            #[cfg(target_os = "linux")]
            {
                if !is_wayland() {
                    return Err("The desktop session changed. Choose a source again.".into());
                }
                let portal = match previous_portal {
                    Some(portal) if portal.available_for(source.id == PORTAL_ALL_SOURCE) => portal,
                    _ => Arc::new(PortalCapture::new(source.id == PORTAL_ALL_SOURCE)?),
                };
                return Ok(Self {
                    source,
                    portal: Some(portal),
                });
            }
            #[cfg(not(target_os = "linux"))]
            return Err("The system screen picker is only available on Linux Wayland.".into());
        }
        let _ = previous_portal;
        Ok(Self {
            source,
            portal: None,
        })
    }

    pub fn frame(&self) -> Result<RgbaImage> {
        if let Some(portal) = &self.portal {
            #[cfg(target_os = "linux")]
            return portal.frame();
            #[cfg(not(target_os = "linux"))]
            let _ = portal;
        }
        frame(&self.source)
    }

    pub fn stop(&self) {
        #[cfg(target_os = "linux")]
        if let Some(portal) = &self.portal {
            portal.stop();
        }
    }

    pub fn portal(&self) -> Option<Arc<PortalCapture>> {
        self.portal.clone()
    }
}

pub struct PortalCapture {
    #[cfg(target_os = "linux")]
    all: bool,
    #[cfg(target_os = "linux")]
    recorders: Mutex<Vec<xcap::VideoRecorder>>,
    #[cfg(target_os = "linux")]
    frame: Arc<(Mutex<PortalFrame>, Condvar)>,
}

#[cfg(target_os = "linux")]
struct PortalFrame {
    latest: Vec<Option<RgbaImage>>,
    closed: bool,
    active: bool,
}

#[cfg(target_os = "linux")]
impl PortalCapture {
    fn new(all: bool) -> Result<Self> {
        let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
        let expected = monitors.len();
        let monitor = monitors
            .into_iter()
            .next()
            .ok_or("No display is available for the system screen picker")?;
        // The portal allows selecting multiple monitors in one dialog and
        // returns one PipeWire stream for each approved monitor.
        let captures = monitor
            .wayland_video_recorders(all)
            .map_err(|e| e.to_string())?;
        if all && captures.len() != expected {
            for (recorder, _) in &captures {
                let _ = recorder.stop();
            }
            return Err(format!(
                "Select all {expected} displays in Ubuntu's sharing dialog to track both screens."
            ));
        }
        let state = Arc::new((
            Mutex::new(PortalFrame {
                latest: vec![None; captures.len()],
                closed: false,
                active: false,
            }),
            Condvar::new(),
        ));
        let mut recorders = Vec::with_capacity(captures.len());
        for (index, (recorder, frames)) in captures.into_iter().enumerate() {
            recorders.push(recorder);
            let worker_state = Arc::clone(&state);
            std::thread::spawn(move || {
                let mut last_image = None::<Instant>;
                while let Ok(frame) = frames.recv() {
                    if last_image.is_some_and(|at| at.elapsed() < Duration::from_millis(250)) {
                        continue;
                    }
                    if let Some(image) = portal_image(frame) {
                        let (lock, ready) = &*worker_state;
                        if let Ok(mut state) = lock.lock() {
                            state.latest[index] = Some(image);
                            last_image = Some(Instant::now());
                            ready.notify_all();
                        } else {
                            return;
                        }
                    }
                }
                let (lock, ready) = &*worker_state;
                if let Ok(mut state) = lock.lock() {
                    state.closed = true;
                    ready.notify_all();
                }
            });
        }
        Ok(Self {
            all,
            recorders: Mutex::new(recorders),
            frame: state,
        })
    }

    fn available_for(&self, all: bool) -> bool {
        self.all == all && self.frame.0.lock().map(|state| !state.closed).unwrap_or(false)
    }

    fn start(&self) -> Result<()> {
        let (lock, _) = &*self.frame;
        let mut state = lock.lock().map_err(|e| e.to_string())?;
        if state.closed {
            return Err("The screen sharing session ended. Choose a source again.".into());
        }
        if state.active {
            return Ok(());
        }
        state.latest.fill(None);
        state.active = true;
        drop(state);
        let result = self.recorders
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .try_for_each(|recorder| recorder.start().map_err(|e| e.to_string()));
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn stop(&self) {
        if let Ok(recorders) = self.recorders.lock() {
            for recorder in recorders.iter() {
                let _ = recorder.stop();
            }
        }
        let (lock, ready) = &*self.frame;
        if let Ok(mut state) = lock.lock() {
            state.latest.fill(None);
            state.active = false;
            ready.notify_all();
        }
    }

    fn frame(&self) -> Result<RgbaImage> {
        self.start()?;
        self.wait_for_frame()
    }

    fn wait_for_frame(&self) -> Result<RgbaImage> {
        let deadline = Instant::now() + Duration::from_secs(8);
        let (lock, ready) = &*self.frame;
        let mut state = lock.lock().map_err(|e| e.to_string())?;
        loop {
            if !state.active {
                return Err("Screen sharing was paused. Reconnect to continue.".into());
            }
            if state.latest.iter().all(Option::is_some) {
                let images = state.latest.iter()
                    .filter_map(|frame| frame.clone())
                    .collect::<Vec<_>>();
                drop(state);
                return combine_portal_frames(&images);
            }
            if state.closed {
                return Err("Screen sharing ended. Reconnect to continue.".into());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("No screen frame arrived. Check the sharing indicator and reconnect.".into());
            }
            state = ready
                .wait_timeout(state, remaining)
                .map_err(|e| e.to_string())?
                .0;
        }
    }
}

#[cfg(target_os = "linux")]
fn portal_image(frame: xcap::Frame) -> Option<RgbaImage> {
    let bytes = usize::try_from(frame.width)
        .ok()?
        .checked_mul(usize::try_from(frame.height).ok()?)?
        .checked_mul(4)?;
    if bytes == 0 || frame.raw.len() < bytes {
        return None;
    }
    let mut raw = frame.raw;
    raw.truncate(bytes);
    for pixel in raw.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    RgbaImage::from_raw(frame.width, frame.height, raw)
}

#[cfg(target_os = "linux")]
fn combine_portal_frames(frames: &[RgbaImage]) -> Result<RgbaImage> {
    if frames.len() == 1 {
        return Ok(frames[0].clone());
    }
    let width = frames.iter().try_fold(0_u32, |sum, frame| {
        sum.checked_add(frame.width()).ok_or("Combined screen image is too wide")
    })?;
    let height = frames.iter().map(RgbaImage::height).max().ok_or("No screen frames arrived")?;
    let mut combined = RgbaImage::new(width, height);
    let mut x = 0_i64;
    for frame in frames {
        image::imageops::overlay(&mut combined, frame, x, 0);
        x += i64::from(frame.width());
    }
    Ok(combined)
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

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    #[test]
    fn wayland_detection_matches_capture_library() {
        assert!(super::wayland_session(Some("x11"), Some("wayland-0")));
        assert!(super::wayland_session(Some("wayland"), None));
        assert!(!super::wayland_session(Some("x11"), None));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn portal_frame_uses_opaque_pixels() {
        let image = super::portal_image(xcap::Frame::new(1, 1, vec![10, 20, 30, 0]))
            .expect("valid frame");
        assert_eq!(image.into_raw(), vec![10, 20, 30, 255]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn multiple_portal_frames_are_combined() {
        let first = image::RgbaImage::from_pixel(2, 1, image::Rgba([255, 0, 0, 255]));
        let second = image::RgbaImage::from_pixel(1, 2, image::Rgba([0, 0, 255, 255]));
        let combined = super::combine_portal_frames(&[first, second]).unwrap();
        assert_eq!(combined.dimensions(), (3, 2));
        assert_eq!(combined.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(combined.get_pixel(2, 1).0, [0, 0, 255, 255]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires a Wayland desktop and approval in the system sharing dialog"]
    fn live_wayland_capture() {
        assert!(super::is_wayland());
        let source = super::list_sources().unwrap().remove(0);
        let handle = super::CaptureHandle::connect(source, None).unwrap();
        let image = handle.frame().unwrap();
        assert!(image.width() > 0 && image.height() > 0);
        handle.stop();
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
