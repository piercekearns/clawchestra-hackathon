#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if clawchestra_lib::maybe_run_windows_terminal_host_from_args() {
        return;
    }
    clawchestra_lib::run();
}
