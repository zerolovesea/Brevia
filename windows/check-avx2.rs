#![windows_subsystem = "windows"]

fn main() {
    if !std::is_x86_feature_detected!("avx2") {
        std::process::exit(1);
    }
}
