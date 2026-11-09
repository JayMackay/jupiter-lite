#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_window_state::StateFlags;
mod external_links;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

struct Service(Mutex<Option<Child>>);
// True only when the build carries an updater public key (release builds with signing set up).
struct UpdaterEnabled(bool);

// Asks the local service to save and quit, then makes sure it has stopped.
fn stop_service(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<Service>().0.lock().unwrap().take() {
        if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(b"quit\n"); }
        for _ in 0..80 { if child.try_wait().ok().flatten().is_some() { break; } std::thread::sleep(std::time::Duration::from_millis(100)); }
        let _ = child.kill(); let _ = child.wait();
    }
}

fn update_event(app: &tauri::AppHandle, detail: serde_json::Value) {
    if let Some(window) = app.get_webview_window("workspace") {
        let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-update',{{detail:{detail}}}))"));
    }
}

fn run_update(app: tauri::AppHandle, install: bool) {
    if !app.state::<UpdaterEnabled>().0 { update_event(&app, serde_json::json!({ "state": "unavailable" })); return; }
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;
        let error = |app: &tauri::AppHandle, message: String| update_event(app, serde_json::json!({ "state": "error", "message": message }));
        let handle = app.clone();
        // Windows installers close the app themselves; save chats and stop the service first.
        let updater = match app.updater_builder().on_before_exit(move || stop_service(&handle)).build() { Ok(updater) => updater, Err(e) => return error(&app, e.to_string()) };
        match updater.check().await {
            Ok(Some(update)) if !install => update_event(&app, serde_json::json!({ "state": "available", "version": update.version, "notes": update.body })),
            Ok(Some(update)) => {
                update_event(&app, serde_json::json!({ "state": "installing", "version": update.version }));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => { stop_service(&app); app.restart(); },
                    Err(e) => error(&app, e.to_string()),
                }
            },
            Ok(None) => update_event(&app, serde_json::json!({ "state": "current" })),
            Err(e) => error(&app, e.to_string()),
        }
    });
}
#[cfg(windows)]
struct ServiceJob(Mutex<Option<OwnedHandle>>);
#[cfg(windows)]
mod window_identity;
#[cfg(windows)]
mod win_key;
#[cfg(target_os = "macos")]
mod mac_key;

// The "recall Jupiter" shortcut: a bare Win-key tap on Windows, ⌃⌥⌘Space on macOS.
#[cfg(windows)]
type RecallShortcut = win_key::WinKeyShortcut;
#[cfg(target_os = "macos")]
type RecallShortcut = mac_key::RecallShortcut;
#[cfg(windows)]
const RECALL_LABEL: &str = "Win key";
#[cfg(target_os = "macos")]
const RECALL_LABEL: &str = mac_key::LABEL;

#[cfg(windows)]
fn process_job(child: &Child) -> Result<OwnedHandle, Box<dyn std::error::Error>> {
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() { return Err(std::io::Error::last_os_error().into()); }
        let owned = OwnedHandle::from_raw_handle(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) == 0
            || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(owned)
    }
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)] command.creation_flags(0x08000000);
    command
}

fn reveal(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window("workspace") {
        if label == "chats" { let _ = window.eval("window.dispatchEvent(new Event('jupiter-show-chats'))"); }
        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
    }
}

fn requested_window(args: &[String]) -> Option<&str> {
    args.windows(2).find_map(|pair| {
        if pair[0] == "--show" && matches!(pair[1].as_str(), "chats" | "workspace") { Some(pair[1].as_str()) } else { None }
    })
}

fn hide(window: &tauri::WebviewWindow) {
    // macOS keeps the miniaturized flag on a hidden window; clear it so a
    // closed window is never taken for a minimized, open one.
    #[cfg(target_os = "macos")]
    if window.is_minimized().unwrap_or(false) { let _ = window.unminimize(); }
    let _ = window.hide();
}

fn recall_open_windows(app: &tauri::AppHandle) {
    reveal(app, "workspace");
}

#[cfg(any(windows, target_os = "macos"))]
fn publish_shortcut(app: &tauri::AppHandle, request_id: Option<&str>, error: Option<String>) {
    let available = app.try_state::<RecallShortcut>().is_some();
    let enabled = app.try_state::<RecallShortcut>().is_some_and(|shortcut| shortcut.enabled());
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() { let _ = item.set_checked(enabled); }
    let event = serde_json::json!({ "type": "native-settings", "requestId": request_id, "available": available, "winKey": enabled && available, "label": RECALL_LABEL, "error": error });
    if let Some(child) = app.state::<Service>().0.lock().unwrap().as_mut() {
        if let Some(stdin) = child.stdin.as_mut() { let _ = writeln!(stdin, "{event}"); }
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn set_shortcut(app: &tauri::AppHandle, enabled: bool, request_id: Option<&str>) {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let shortcut = app.try_state::<RecallShortcut>().ok_or("Shortcut unavailable")?;
        let folder = app.path().app_config_dir()?;
        fs::create_dir_all(&folder)?;
        fs::write(folder.join("windows-key.json"), if enabled { "true" } else { "false" })?;
        #[cfg(windows)]
        shortcut.set_enabled(enabled);
        #[cfg(target_os = "macos")]
        shortcut.set_enabled(enabled)?;
        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() { item.set_checked(enabled)?; }
        Ok(())
    })();
    publish_shortcut(app, request_id, result.err().map(|error| error.to_string()));
}

#[cfg(any(windows, target_os = "macos"))]
fn start_file_drag(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let Some(window) = app.get_webview_window("workspace") else { return };
    let _ = app.run_on_main_thread(move || {
        let callback_window = window.clone();
        let result = drag::start_drag(
            &window, drag::DragItem::Files(paths),
            drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
            move |result, _| {
                let detail = serde_json::json!({ "dropped": matches!(result, drag::DragResult::Dropped) });
                let _ = callback_window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-native-drag-result',{{detail:{detail}}}))"));
            }, drag::Options::default(),
        );
        if let Err(error) = result {
            let detail = serde_json::json!({ "dropped": false, "error": error.to_string() });
            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-native-drag-result',{{detail:{detail}}}))"));
        }
    });
}

// Cancelling the repository picker: quit quietly instead of reporting an error.
#[derive(Debug)]
struct Cancelled;
impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("No Workspace repository selected") }
}
impl std::error::Error for Cancelled {}

// Copies the bundled starter workspace into a folder; files already there are never replaced.
fn seed_workspace(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() { seed_workspace(&entry.path(), &target)?; }
        else if !target.exists() { fs::copy(entry.path(), &target)?; }
    }
    Ok(())
}

fn repo_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let config = app.path().app_config_dir()?.join("repository.json");
    let args: Vec<String> = std::env::args().collect();
    let supplied = args.iter().position(|v| v == "--repo").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let saved = fs::read_to_string(&config).ok().and_then(|s| serde_json::from_str::<String>(&s).ok()).map(PathBuf::from);
    let current = std::env::current_dir().ok().filter(|root| root.join("workspace/workspace.json").is_file());
    // Installed builds carry a starter workspace, so a first launch can create one instead of asking for a clone.
    let starter = app.path().resource_dir()?.join("runtime").join("content");
    let starter = starter.join("workspace/workspace.json").is_file().then_some(starter);
    let mut selected = supplied.or(saved).or(current);
    if selected.is_none() {
        if let (Some(ref starter), Ok(documents)) = (&starter, app.path().document_dir()) {
            let default = documents.join("Jupiter");
            let choice = rfd::MessageDialog::new().set_title("Welcome to Jupiter")
                .set_description(format!("Jupiter keeps your workspace, skills and notes in a folder.\n\nUse {}?", default.display()))
                .set_buttons(rfd::MessageButtons::OkCancelCustom("Use this folder".into(), "Choose another folder".into())).show();
            if matches!(choice, rfd::MessageDialogResult::Ok) || matches!(choice, rfd::MessageDialogResult::Custom(ref label) if label == "Use this folder") {
                seed_workspace(starter, &default)?;
                selected = Some(default);
            }
        }
    }
    loop {
        if let Some(ref root) = selected {
            if root.join("workspace/workspace.json").is_file() {
                fs::create_dir_all(config.parent().unwrap())?;
                fs::write(&config, serde_json::to_string(&root.to_string_lossy())?)?;
                return Ok(root.to_owned());
            }
        }
        let title = if starter.is_some() { "Choose a folder for your Jupiter workspace" } else { "Choose your Jupiter repository" };
        selected = rfd::FileDialog::new().set_title(title).pick_folder();
        let Some(chosen) = selected.clone() else { return Err(Cancelled.into()) };
        if chosen.join("workspace/workspace.json").is_file() { continue; }
        if let Some(ref starter) = starter {
            // An empty folder becomes the workspace; otherwise a Jupiter folder is made inside it.
            let empty = fs::read_dir(&chosen).map(|mut items| items.next().is_none()).unwrap_or(false);
            let target = if empty { chosen } else { chosen.join("Jupiter") };
            seed_workspace(starter, &target)?;
            selected = Some(target);
        } else {
            rfd::MessageDialog::new().set_title("Choose the Workspace folder").set_description("Select the repository folder containing workspace/workspace.json.").show();
        }
    }
}

fn normalize_node_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn window_defaults(builder: WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle>) -> WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle> {
    // macOS: a forced theme sets NSApp.appearance app-wide, which WKWebView
    // reports as prefers-color-scheme, so the page's System theme could never
    // turn light. The dark background still avoids a white flash on load.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.theme(Some(tauri::Theme::Dark));
    // macOS: without a download handler, wry cancels every WKWebView download
    // (image Download buttons, report downloads). Save to ~/Downloads under a
    // unique name, as wry chooses, and select the file in Finder when done.
    #[cfg(target_os = "macos")]
    let builder = {
        let pending = Mutex::new(std::collections::HashMap::<String, PathBuf>::new());
        builder.on_download(move |_, event| {
            match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => { pending.lock().unwrap().insert(url.to_string(), destination.clone()); },
                tauri::webview::DownloadEvent::Finished { url, path, success } => {
                    // wry never reports the saved path on macOS; use the requested one.
                    let saved = path.or_else(|| pending.lock().unwrap().remove(url.as_str()));
                    if let (true, Some(saved)) = (success, saved) { let _ = external_links::reveal_path(&saved.to_string_lossy()); }
                },
                _ => {}
            }
            true
        })
    };
    builder.background_color(tauri::webview::Color(12, 13, 16, 255))
}

fn make_windows(app: &tauri::AppHandle, workspace: &str, _chats: &str) -> Result<(), Box<dyn std::error::Error>> {
    let service_url: tauri::Url = workspace.parse()?;
    let service_token = service_url.query_pairs().find(|(key, _)| key == "token").map(|(_, value)| value.into_owned()).ok_or("Service credential unavailable")?;
    let auth_script = include_str!("desktop-auth.js")
        .replace("__JUPITER_SERVICE_ORIGIN__", &serde_json::to_string(&service_url.origin().ascii_serialization())?)
        .replace("__JUPITER_SERVICE_TOKEN__", &serde_json::to_string(&service_token)?);
    let (mut x, mut y, mut width, mut height) = (0.0, 0.0, 1440.0, 900.0);
    if let Some(monitor) = app.primary_monitor()? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        x = area.position.x as f64 / scale; y = area.position.y as f64 / scale;
        width = area.size.width as f64 / scale; height = area.size.height as f64 / scale;
    }
    let workspace_window = window_defaults(WebviewWindowBuilder::new(app, "workspace", WebviewUrl::External(workspace.parse()?)))
        .initialization_script(&auth_script)
        .on_new_window(|url, _| external_links::open_popup(url))
        .visible(false)
        .title(format!("{} · Workspace", app.config().product_name.as_deref().unwrap_or("Jupiter"))).inner_size((width - 8.0).max(1100.0), (height - 6.0).max(450.0))
        .position(x + 2.0, y + 2.0).min_inner_size(1100.0, 400.0)
        .build()?;
    let drop_window = workspace_window.clone();
    workspace_window.on_window_event(move |event| {
        if let tauri::WindowEvent::DragDrop(event) = event {
            // wry reports WKWebView drop positions in points although Tauri labels
            // them physical, so dividing by the scale again would halve them on Retina.
            let scale = if cfg!(target_os = "macos") { 1.0 } else { drop_window.scale_factor().unwrap_or(1.0) };
            let detail = match event {
                tauri::DragDropEvent::Enter { paths, position } => serde_json::json!({ "phase": "enter", "paths": paths, "x": position.x / scale, "y": position.y / scale }),
                tauri::DragDropEvent::Over { position } => serde_json::json!({ "phase": "over", "x": position.x / scale, "y": position.y / scale }),
                tauri::DragDropEvent::Drop { paths, position } => serde_json::json!({ "phase": "drop", "paths": paths, "x": position.x / scale, "y": position.y / scale }),
                tauri::DragDropEvent::Leave => serde_json::json!({ "phase": "leave" }),
                _ => return,
            };
            let _ = drop_window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-file-drop',{{detail:{detail}}}))"));
        }
    });
    let args: Vec<String> = std::env::args().collect();
    let _selected = requested_window(&args);
    for window in [workspace_window] {
        #[cfg(windows)]
        window_identity::set_window(&window)?;
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close(); hide(&handle);
            }
        });
        window.show()?;
    }

    Ok(())
}

#[cfg(unix)]
mod login_path;

// Finder and Dock launches get launchd's environment, not the user's shell
// exports. PATH always comes from the login shell; the other imported
// variables only fill gaps, so a Terminal launch or `launchctl setenv` wins.
#[cfg(target_os = "macos")]
fn login_environment(command: &mut Command) {
    let (path, vars) = login_path::discover();
    command.env("PATH", path);
    let missing = |name: &str| std::env::var_os(name).is_none();
    let mut has_locale = !(missing("LANG") && missing("LC_ALL") && missing("LC_CTYPE"));
    for (name, value) in vars {
        if missing(&name) {
            has_locale |= matches!(name.as_str(), "LANG" | "LC_ALL" | "LC_CTYPE");
            command.env(name, value);
        }
    }
    // Without any locale the service and every terminal run in the C locale.
    if !has_locale { command.env("LANG", "en_US.UTF-8"); }
}

// macOS: NSFileManager needs no Automation (Apple Events) permission, unlike
// the crate's default Finder script, but Finder offers no "Put Back" for it.
fn move_to_trash(path: &str) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut context = trash::TrashContext::default();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(path)
    }
    #[cfg(not(target_os = "macos"))]
    { trash::delete(path) }
}

// macOS menu-bar extras are template images that follow the menu bar's look.
// Preserve the supplied icon artwork and transparency.
#[cfg(target_os = "macos")]
fn menu_bar_icon() -> tauri::Result<tauri::image::Image<'static>> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
    Ok(tauri::image::Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height()))
}


#[cfg(target_os = "macos")]
fn recall_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::ShortcutState;
    tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
        if event.state() == ShortcutState::Pressed { recall_all_windows(app); }
    }).build()
}

// Windows and Linux have nothing to register here; keep the builder chain uniform.
#[cfg(not(target_os = "macos"))]
fn recall_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> { tauri::plugin::Builder::new("jupiter-recall").build() }

// macOS: the recall shortcut and a Dock-icon click restore the unified window.
#[cfg(target_os = "macos")]
fn recall_all_windows(app: &tauri::AppHandle) {
    recall_open_windows(app);
}

// macOS: the web view never receives Cmd+1…9 (the native window consumes them
// before the page), so chat switching lives in a Chats menu, as in other Mac
// apps. Selecting an item shows Chats and asks the page to open that tab.
#[cfg(target_os = "macos")]
fn install_chats_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::Submenu;
    let menu = Menu::default(app)?;
    let items = (1..=9).map(|n| MenuItem::with_id(app, format!("chat-{n}"), format!("Chat {n}"), true, Some(format!("CmdOrCtrl+{n}"))))
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    menu.append(&Submenu::with_items(app, "Chats", true, &refs)?)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let Some(index) = event.id.as_ref().strip_prefix("chat-").and_then(|n| n.parse::<u8>().ok()) else { return };
        reveal(app, "chats");
        if let Some(window) = app.get_webview_window("workspace") {
            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-select-chat',{{detail:{{index:{index}}}}}))"));
        }
    });
    Ok(())
}

// Tauri panics on a setup error, which macOS reports as a crash. Show the
// error and quit instead, quietly when the repository picker was cancelled.
fn guarded_setup(app: &mut tauri::App, setup: impl FnOnce(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>>) -> Result<(), Box<dyn std::error::Error>> {
    let Err(error) = setup(app) else { return Ok(()) };
    if !cfg!(target_os = "macos") { return Err(error); }
    let cancelled = error.downcast_ref::<Cancelled>().is_some();
    if !cancelled {
        rfd::MessageDialog::new().set_level(rfd::MessageLevel::Error).set_title("Jupiter could not start").set_description(error.to_string()).show();
    }
    app.handle().exit(if cancelled { 0 } else { 1 });
    Ok(())
}

fn main() {
    let context = tauri::generate_context!();
    let updater = context.config().plugins.0.contains_key("updater");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--quit") { app.exit(0); }
            else if let Some(label) = requested_window(&args) { reveal(app, label); }
            else { reveal(app, "workspace"); }
        }))
        .plugin(recall_plugin())
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED).build());
    let builder = if updater { builder.plugin(tauri_plugin_updater::Builder::new().build()) } else { builder };
    let result = builder
        .manage(UpdaterEnabled(updater))
        .manage(Service(Mutex::new(None)))
        .setup(|app| guarded_setup(app, |app| {
            if std::env::args().any(|arg| arg == "--quit") { app.handle().exit(0); return Ok(()); }
            #[cfg(windows)]
            window_identity::initialize(app.handle())?;
            let repo = repo_path(app.handle())?;
            let resource_dir = app.path().resource_dir()?;
            let runtime = resource_dir.join("runtime");
            let runtime_node = if cfg!(windows) { runtime.join("node.exe") } else { runtime.join("node") };
            let (node, script, ui) = if runtime_node.is_file() {
                (runtime_node, runtime.join("service/main.mjs"), runtime.join("ui"))
            } else {
                (PathBuf::from("node"), repo.join("desktop/service/main.mjs"), repo.join("dist"))
            };
            let script = normalize_node_path(script);
            let logs = app.path().app_log_dir()?; fs::create_dir_all(&logs)?;
            let service_log = logs.join("service.log");
            let log = fs::OpenOptions::new().create(true).append(true).open(&service_log)?;
            let mut command = Command::new(node);
            command.arg(script).arg("--repo").arg(&repo).arg("--ui").arg(ui).current_dir(&repo)
                .env("JUPITER_PARENT_PID", std::process::id().to_string())
                .env("JUPITER_APP_VERSION", app.package_info().version.to_string())
                .env("JUPITER_UPDATER", if app.state::<UpdaterEnabled>().0 { "1" } else { "0" })
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
            #[cfg(target_os = "macos")]
            login_environment(&mut command);
            let mut child = hidden(&mut command).spawn()?;
            // The job contains only this app's service and descendants. Quitting
            // or a host crash cannot leave managed CLI/MCP processes behind.
            #[cfg(windows)]
            app.manage(ServiceJob(Mutex::new(Some(process_job(&child)?))));
            let stdout = child.stdout.take().ok_or("Service output unavailable")?;
            *app.state::<Service>().0.lock().unwrap() = Some(child);
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                    match event["type"].as_str().unwrap_or("") {
                        #[cfg(any(windows, target_os = "macos"))]
                        "native-settings" => {
                            if let Some(enabled) = event["winKey"].as_bool() {
                                let handle = app_handle.clone();
                                let request_id = event["requestId"].as_str().map(str::to_owned);
                                let _ = app_handle.run_on_main_thread(move || set_shortcut(&handle, enabled, request_id.as_deref()));
                            }
                        },
                        "ready" => {
                            let handle = app_handle.clone();
                            let workspace = event["workspace"].as_str().unwrap_or("").to_owned();
                            let chats = event["chats"].as_str().unwrap_or("").to_owned();
                            let _ = app_handle.run_on_main_thread(move || {
                                if let Err(error) = make_windows(&handle, &workspace, &chats) {
                                    rfd::MessageDialog::new().set_title("Jupiter could not open").set_description(error.to_string()).show(); handle.exit(1);
                                }
                            });
                        },
                        "window" => {
                            let label = event["window"].as_str().unwrap_or("");
                            if let Some(window) = app_handle.get_webview_window("workspace") {
                                match event["action"].as_str().unwrap_or("") {
                                    "show" => reveal(&app_handle, label),
                                    "hide" => hide(&window),
                                    "minimize" => { let _ = window.minimize(); },
                                    _ => {}
                                }
                            }
                        },
                        "recycle-file" => {
                            if let Some(file) = event["path"].as_str() {
                                if let Some(window) = app_handle.get_webview_window("workspace") {
                                    let file = file.to_owned();
                                    std::thread::spawn(move || {
                                        let detail = match move_to_trash(&file) {
                                            Ok(()) => serde_json::json!({ "path": file, "recycled": true }),
                                            Err(error) => serde_json::json!({ "path": file, "recycled": false, "error": error.to_string() }),
                                        };
                                        let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-recycle-result',{{detail:{detail}}}))"));
                                    });
                                }
                            }
                        },
                        #[cfg(any(windows, target_os = "macos"))]
                        "drag-files" => {
                            if let Some(paths) = event["paths"].as_array() {
                                let paths: Vec<PathBuf> = paths.iter().filter_map(|p| p.as_str().map(PathBuf::from)).collect();
                                if !paths.is_empty() { start_file_drag(&app_handle, paths); }
                            }
                        },
                        "pick-files" => {
                            if let (Some(window), Some(request_id)) = (app_handle.get_webview_window("workspace"), event["requestId"].as_str()) {
                                let request_id = request_id.to_owned();
                                std::thread::spawn(move || {
                                    let paths = rfd::FileDialog::new().set_parent(&window).set_title("Attach file paths").pick_files().unwrap_or_default();
                                    let detail = serde_json::json!({ "requestId": request_id, "paths": paths });
                                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-picked-files',{{detail:{detail}}}))"));
                                });
                            }
                        },
                        "update-check" => run_update(app_handle.clone(), false),
                        "update-install" => run_update(app_handle.clone(), true),
                        "pick-folder" => {
                            if let (Some(window), Some(request_id)) = (app_handle.get_webview_window("workspace"), event["requestId"].as_str()) {
                                let request_id = request_id.to_owned();
                                let title = event["title"].as_str().unwrap_or("Choose a folder").to_owned();
                                std::thread::spawn(move || {
                                    let folder = rfd::FileDialog::new().set_parent(&window).set_title(&title).pick_folder();
                                    let detail = serde_json::json!({ "requestId": request_id, "path": folder });
                                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('jupiter-picked-folder',{{detail:{detail}}}))"));
                                });
                            }
                        },
                        "reveal" => { if let Some(file) = event["path"].as_str() { let _ = external_links::reveal_path(file); } },
                        // A tool's own editor (Pixelbolt Studio) in its own Jupiter window rather than a browser.
                        // Only a local editor on 127.0.0.1 is opened, and the window gets no Jupiter sign-in
                        // script. Opening again focuses the same window; closing it leaves the editor running.
                        "tool-window" => {
                            let id: String = event["id"].as_str().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
                            if id.is_empty() { continue; }
                            let label = format!("tool-{id}");
                            let action = event["action"].as_str().unwrap_or("").to_owned();
                            let url = event["url"].as_str().and_then(|value| value.parse::<tauri::Url>().ok())
                                .filter(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port().is_some());
                            let title: String = event["title"].as_str().unwrap_or("Editor").chars().take(60).collect();
                            let handle = app_handle.clone();
                            let _ = app_handle.run_on_main_thread(move || {
                                let existing = handle.get_webview_window(&label);
                                if action == "close" { if let Some(window) = existing { let _ = window.close(); } return; }
                                let Some(url) = url else { return };
                                if let Some(window) = existing {
                                    let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
                                    if window.url().map(|current| current.origin() != url.origin()).unwrap_or(true) { let _ = window.navigate(url); }
                                    return;
                                }
                                let built = window_defaults(WebviewWindowBuilder::new(&handle, &label, WebviewUrl::External(url)))
                                    .title(format!("{title} · Jupiter"))
                                    .inner_size(1280.0, 840.0).min_inner_size(720.0, 480.0)
                                    .on_new_window(|url, _| external_links::open_popup(url))
                                    .build();
                                #[cfg(windows)]
                                if let Ok(window) = &built { let _ = window_identity::set_window(window); }
                                if let Ok(window) = built { let _ = window.set_focus(); }
                            });
                        },
                        _ => {}
                    }
                }
                if app_handle.get_webview_window("workspace").is_none() {
                    rfd::MessageDialog::new().set_title("Jupiter service did not start").set_description(format!("The local service stopped before opening the windows. See {} for details.", service_log.display())).show();
                    app_handle.exit(1);
                }
            });
            #[cfg(target_os = "macos")]
            install_chats_menu(app.handle())?;
            let workspace_item = MenuItem::with_id(app, "workspace", "Show Workspace", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Jupiter", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&workspace_item, &separator, &quit_item])?;
            #[cfg(any(windows, target_os = "macos"))]
            {
                let preference = app.path().app_config_dir()?.join("windows-key.json");
                let enabled = fs::read_to_string(&preference).ok().and_then(|text| serde_json::from_str::<bool>(&text).ok()).unwrap_or(false);
                let shortcut = RecallShortcut::start(app.handle(), enabled);
                let available = shortcut.is_ok();
                if let Ok(shortcut) = shortcut { app.manage(shortcut); }
                let shortcut_label = if cfg!(windows) { "Enable Window Key".to_owned() } else { format!("Enable {RECALL_LABEL}") };
                let item = CheckMenuItem::with_id(app, "win-key", shortcut_label, available, enabled && available, None::<&str>)?;
                menu.insert(&item, 1)?;
                app.manage(item);
                publish_shortcut(app.handle(), None, if available { None } else { Some(format!("The system could not register {RECALL_LABEL}.")) });
            }
            #[cfg(target_os = "macos")]
            let tray = TrayIconBuilder::new().icon(menu_bar_icon()?).icon_as_template(false);
            #[cfg(not(target_os = "macos"))]
            let tray = TrayIconBuilder::new().icon(tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?);
            tray.tooltip("Jupiter")
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "workspace" => reveal(app, "workspace"),
                    "quit" => app.exit(0),
                    #[cfg(any(windows, target_os = "macos"))]
                    "win-key" => {
                        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
                            if let Ok(enabled) = item.is_checked() {
                                set_shortcut(app, enabled, None);
                            }
                        }
                    },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| { if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { reveal(tray.app_handle(), "workspace"); } })
                .build(app)?;
            Ok(())
        })).build(context);
    match result {
        Ok(app) => app.run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event { recall_all_windows(app); }
            if let tauri::RunEvent::Exit = event {
                #[cfg(windows)]
                if let Some(shortcut) = app.try_state::<win_key::WinKeyShortcut>() { shortcut.shutdown(); }
                stop_service(app);
                #[cfg(windows)]
                if let Some(job) = app.try_state::<ServiceJob>() { job.0.lock().unwrap().take(); }
            }
        }),
        Err(error) => { rfd::MessageDialog::new().set_title("Jupiter could not start").set_description(error.to_string()).show(); }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_node_path};
    use std::path::PathBuf;



    #[test]
    fn normalize_node_path_removes_windows_extended_prefixes() {
        assert_eq!(normalize_node_path(PathBuf::from(r"\\?\C:\My Apps\Jupiter\service\main.mjs")), PathBuf::from(r"C:\My Apps\Jupiter\service\main.mjs"));
        assert_eq!(normalize_node_path(PathBuf::from(r"\\?\UNC\server\share\service\main.mjs")), PathBuf::from(r"\\server\share\service\main.mjs"));
        assert_eq!(normalize_node_path(PathBuf::from(r"C:\My Apps\Jupiter\service\main.mjs")), PathBuf::from(r"C:\My Apps\Jupiter\service\main.mjs"));
    }
}
