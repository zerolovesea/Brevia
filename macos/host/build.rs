fn main() {
    println!("cargo:rustc-link-lib=framework=UniformTypeIdentifiers");
    println!("cargo:rerun-if-changed=src/appkit.m");
    cc::Build::new()
        .file("src/appkit.m")
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .compile("brevia_appkit");
    tauri_build::build();
}
