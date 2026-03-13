use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let mut attributes = tauri_build::Attributes::new();

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
        let icon_source = PathBuf::from("icons").join("icon.ico");
        let icon_copy = out_dir.join("icon.ico");

        println!("cargo:rerun-if-changed={}", icon_source.display());
        fs::copy(&icon_source, &icon_copy).expect("copy icon.ico into OUT_DIR");

        let windows = tauri_build::WindowsAttributes::new().window_icon_path(&icon_copy);
        attributes = attributes.windows_attributes(windows);
    }

    tauri_build::try_build(attributes).expect("failed to run tauri build");
}
