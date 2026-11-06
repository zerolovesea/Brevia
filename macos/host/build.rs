fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-lib=framework=UniformTypeIdentifiers");
        println!("cargo:rerun-if-changed=src/appkit.m");
        cc::Build::new()
            .file("src/appkit.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("brevia_appkit");
    }
    println!("cargo:rerun-if-env-changed=BREVIA_NATIVE_UPDATE_PUBKEY");
    tauri_build::build();
}
