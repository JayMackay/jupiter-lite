//! Unified Shell identity; preserve the Tauri data identifier for saved settings.
use std::{fs, hash::{Hash, Hasher}, path::PathBuf, sync::Mutex};
use tauri::Manager;
use windows::{core::{HSTRING}, Win32::{Foundation::HWND, Storage::EnhancedStorage::*,
    System::Com::StructuredStorage::PROPVARIANT,
    UI::Shell::{PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow}}}};
use windows_sys::Win32::UI::{HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi}, WindowsAndMessaging::*};

#[derive(Default)]
pub struct WindowIcons(Mutex<Vec<usize>>);
impl Drop for WindowIcons {
    fn drop(&mut self) {
        if let Ok(icons) = self.0.get_mut() {
            for icon in icons.drain(..) { unsafe { DestroyIcon(icon as _); } }
        }
    }
}

fn app_id(app: &tauri::AppHandle, label: &str) -> String {
    format!("{}.windows.{label}", app.config().identifier)
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(WindowIcons::default());
    unsafe { windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(app_id(app, "workspace")))?; }
    Ok(())
}

fn icon_path(app: &tauri::AppHandle, label: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bytes: &[u8] = if label == "chats" { include_bytes!("../icons/chats.ico") } else { include_bytes!("../icons/icon.ico") };
    let mut hash = std::collections::hash_map::DefaultHasher::new(); bytes.hash(&mut hash);
    let folder = app.path().app_cache_dir()?.join("icons");
    fs::create_dir_all(&folder)?;
    let path = folder.join(format!("jupiter-{label}-{:016x}.ico", hash.finish()));
    if fs::read(&path).ok().as_deref() != Some(bytes) { fs::write(&path, bytes)?; }
    Ok(path)
}

pub fn set_window(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let app = window.app_handle();
    let label = window.label();
    let png: &[u8] = if label == "chats" { include_bytes!("../icons/chats-128x128.png") } else { include_bytes!("../icons/128x128.png") };
    window.set_icon(tauri::image::Image::from_bytes(png)?)?;
    let icon = icon_path(app, label)?;
    let command = format!("\"{}\" --show {label}", std::env::current_exe()?.display());
    let title = if label == "chats" { "Chats" } else { "Jupiter" };
    unsafe {
        let hwnd = window.hwnd()?.0;
        let dpi = GetDpiForWindow(hwnd);
        let big = LoadImageW(std::ptr::null_mut(), HSTRING::from(icon.as_os_str()).as_ptr(), IMAGE_ICON,
            GetSystemMetricsForDpi(SM_CXICON, dpi), GetSystemMetricsForDpi(SM_CYICON, dpi), LR_LOADFROMFILE);
        if big.is_null() { return Err(std::io::Error::last_os_error().into()); }
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, big as isize);
        app.state::<WindowIcons>().0.lock().unwrap().push(big as usize);
        let properties: IPropertyStore = SHGetPropertyStoreForWindow(HWND(hwnd))?;
        properties.SetValue(&PKEY_AppUserModel_RelaunchCommand, &PROPVARIANT::from(command.as_str()))?;
        properties.SetValue(&PKEY_AppUserModel_RelaunchDisplayNameResource, &PROPVARIANT::from(title))?;
        properties.SetValue(&PKEY_AppUserModel_RelaunchIconResource, &PROPVARIANT::from(format!("{},0", icon.display()).as_str()))?;
        // Set the per-window identity last, before either window becomes visible.
        properties.SetValue(&PKEY_AppUserModel_ID, &PROPVARIANT::from(app_id(app, label).as_str()))?;
    }
    Ok(())
}
