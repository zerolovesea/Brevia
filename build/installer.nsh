; Brevia 自定义 NSIS 脚本。
;
; 背景：Brevia 的转写引擎是一个独立的后台进程 brevia-worker.exe（会再派生
; ffmpeg / llama sidecar）。electron-builder 默认的 CHECK_APP_RUNNING 只结束
; 主程序 Brevia.exe，不会结束这个后台进程。若安装/更新时该进程仍在运行，会
; 占用安装目录里的文件，报「抽取：无法写入文件 uninstall brevia.exe」。
;
; 这里在安装初始化阶段（.onInit 的 preInit 钩子）强制结束残留的后台进程树。

!macro preInit
  ; 结束后台转写进程及其全部子进程（ffmpeg / llama sidecar）。
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "brevia-worker.exe" /T'
  Pop $0
  ; 给进程树完全退出留一点时间，避免文件句柄仍处于 DELETE PENDING。
  Sleep 500
!macroend
