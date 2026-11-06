; electron-builder 26.15.3: UUID.v5("com.brevia.app", "50e065bc-3134-11e6-9bab-38c9862bdaf3").
; 卸载遵循该版本 installUtil.nsh 的 --updated /KEEP_APP_DATA 约定。
!define BREVIA_LEGACY_GUID "cd5ecd10-b94d-5d23-8c47-11b57b4f71d8"
!define BREVIA_LEGACY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BREVIA_LEGACY_GUID}"
!define BREVIA_HOOK_DIR "${__FILEDIR__}"
!define MUI_CUSTOMFUNCTION_GUIINIT BreviaRestoreLegacyDirectory
!include StrFunc.nsh
${StrStr}
; 官方 v1.4.5 安装器 SHA256 71016acd...3559 中的原始卸载器，不执行自选目录中的任意程序。
!define BREVIA_LEGACY_UNINSTALL_SHA256 "42e3887c561ca98373e932f171cf19fe125d69c1075124f641f378951e6a4835"

Var BreviaLegacyDir
Var BreviaLegacyScope
Var BreviaLegacyView
Var BreviaLegacyInvalid
Var BreviaDirectorySuggested
Var BreviaUninstallerHandle

LangString BreviaCloseFirst 1033 "Save your recording and quit Brevia, then retry. Installation will not close the app for you."
LangString BreviaCloseFirst 2052 "请先保存录音并退出 Brevia，然后重试。安装程序不会替你关闭应用。"
LangString BreviaMigrationFailed 1033 "The previous installation could not be migrated. Repair or uninstall the old version while keeping app data, then retry."
LangString BreviaMigrationFailed 2052 "旧版程序未能完成迁移。请修复或卸载旧版（保留应用数据）后重试。"

; Tauri 默认在静默更新中强制关闭进程；录音应用必须等用户自行结束并保存。
!ifmacrodef CheckIfAppIsRunning
  !macroundef CheckIfAppIsRunning
!endif
!macro CheckIfAppIsRunning executablePath productName
  ${Do}
    StrCpy $R4 1
    !insertmacro RestartManager_StartSession $R0
    ${If} $R0 != ""
      !insertmacro RestartManager_RegisterFile $R0 "${executablePath}"
      ${If} $0 = 0
        System::Call 'RSTRTMGR::RmGetList(i R0, *i .r1, *i 0, p 0, *i .r3) i .R4'
      ${EndIf}
      !insertmacro RestartManager_EndSession $R0
    ${EndIf}
    ${If} $R4 = 0
      SetErrorLevel 0
      ${Break}
    ${EndIf}
    SetErrorLevel 1618
    ${If} ${Silent}
      Abort "$(BreviaCloseFirst)"
    ${EndIf}
    ${GetOptions} $CMDLINE "/P" $R5
    ${IfNot} ${Errors}
      Abort "$(BreviaCloseFirst)"
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(BreviaCloseFirst)" /SD IDCANCEL IDRETRY +2
    Abort
  ${Loop}
!macroend

!macro BreviaReadLegacy root view scope
  SetRegView ${view}
  ReadRegStr $0 ${root} "Software\${BREVIA_LEGACY_GUID}" "InstallLocation"
  ${If} $0 != ""
    ${If} $BreviaLegacyDir != ""
      ; HKCU Software 在当前 Windows 上由两种视图共享，不能误判为两次安装。
      GetFullPathName $1 "$0"
      ${If} "${scope}" != "currentuser"
      ${OrIf} $BreviaLegacyScope != "currentuser"
      ${OrIf} $1 != $BreviaLegacyDir
        StrCpy $BreviaLegacyInvalid 1
      ${EndIf}
    ${Else}
      GetFullPathName $BreviaLegacyDir "$0"
      StrCpy $BreviaLegacyScope "${scope}"
      StrCpy $BreviaLegacyView ${view}
      ReadRegStr $1 ${root} "${BREVIA_LEGACY_KEY}" "DisplayName"
      ReadRegStr $2 ${root} "${BREVIA_LEGACY_KEY}" "UninstallString"
      StrCpy $3 $BreviaLegacyDir 1 1
      StrLen $4 $BreviaLegacyDir
      ${If} $1 != "Brevia"
      ${OrIf} $3 != ":"
      ${OrIf} $4 <= 3
      ${OrIf} $2 != '$\"$BreviaLegacyDir\Uninstall Brevia.exe$\" /${scope}'
      ${OrIfNot} ${FileExists} "$BreviaLegacyDir\resources\app.asar"
      ${OrIfNot} ${FileExists} "$BreviaLegacyDir\Uninstall Brevia.exe"
        StrCpy $BreviaLegacyInvalid 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

Function BreviaFindLegacy
  StrCpy $BreviaLegacyDir ""
  StrCpy $BreviaLegacyInvalid 0
  !insertmacro BreviaReadLegacy HKLM 64 allusers
  !insertmacro BreviaReadLegacy HKLM 32 allusers
  !insertmacro BreviaReadLegacy HKCU 64 currentuser
  !insertmacro BreviaReadLegacy HKCU 32 currentuser
  SetRegView 64
FunctionEnd

Function BreviaRestoreLegacyDirectory
  Call BreviaFindLegacy
  ${If} $BreviaLegacyInvalid = 0
  ${AndIf} $BreviaLegacyDir != ""
    ; NSIS 从 $CMDLINE 移除 /D，需读取原始命令行以保留用户指定的新目录。
    System::Call 'kernel32::GetCommandLineW() w .r0'
    ${GetOptions} $0 "/D=" $1
    ${If} ${Errors}
      StrCpy $INSTDIR $BreviaLegacyDir
    ${EndIf}
  ${EndIf}
  StrCpy $BreviaDirectorySuggested 1
  ClearErrors
FunctionEnd

Function BreviaVerifyUninstaller
  ; 同时拒绝写入/替换，直到卸载完成；仅先算摘要再运行仍存在 TOCTOU 竞争。
  System::Call 'kernel32::CreateFileW(w "$PLUGINSDIR\brevia-old-uninstaller.exe", i 0x80000000, i 1, p 0, i 3, i 0x80, p 0) p .r0'
  StrCpy $BreviaUninstallerHandle $0
  ${If} $0 = -1
    StrCpy $0 1
    Return
  ${EndIf}
  nsExec::ExecToStack /TIMEOUT=30000 '$\"$SYSDIR\certutil.exe$\" -hashfile $\"$PLUGINSDIR\brevia-old-uninstaller.exe$\" SHA256'
  Pop $0
  Pop $1
  ${StrStr} $1 $1 "$\r$\n${BREVIA_LEGACY_UNINSTALL_SHA256}$\r$\n"
  ${If} $0 != 0
  ${OrIf} $1 == ""
    System::Call 'kernel32::CloseHandle(p $BreviaUninstallerHandle)'
    StrCpy $0 1
  ${EndIf}
FunctionEnd

Function BreviaMigrateLegacy
  ${If} $BreviaDirectorySuggested != 1
    Call BreviaRestoreLegacyDirectory
  ${Else}
    Call BreviaFindLegacy
  ${EndIf}
  ${If} $BreviaLegacyInvalid != 0
    SetErrorLevel 1603
    Abort "$(BreviaMigrationFailed)"
  ${EndIf}
  ${If} $BreviaLegacyDir == ""
    Return
  ${EndIf}
  !insertmacro CheckIfAppIsRunning "$BreviaLegacyDir\Brevia.exe" "Brevia"
  InitPluginsDir
  SetOutPath "$TEMP"
  ClearErrors
  CopyFiles /SILENT "$BreviaLegacyDir\Uninstall Brevia.exe" "$PLUGINSDIR\brevia-old-uninstaller.exe"
  ${If} ${Errors}
    SetErrorLevel 1603
    Abort "$(BreviaMigrationFailed)"
  ${EndIf}
  Call BreviaVerifyUninstaller
  ${If} $0 != 0
    SetErrorLevel 1603
    Abort "$(BreviaMigrationFailed)"
  ${EndIf}
  ${If} $BreviaLegacyScope == "currentuser"
    ; HKCU 的程序可能由普通用户写入，不可从提升权限的安装器直接执行。
    File "/oname=$PLUGINSDIR\brevia-uninstall-user.ps1" "${BREVIA_HOOK_DIR}/uninstall-legacy.ps1"
    Delete "$PLUGINSDIR\brevia-uninstall-result"
    nsis_tauri_utils::RunAsUser "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\brevia-uninstall-user.ps1" -Uninstaller "$PLUGINSDIR\brevia-old-uninstaller.exe" -Directory "$BreviaLegacyDir" -Result "$PLUGINSDIR\brevia-uninstall-result"'
    Pop $0
    ${If} $0 = 0
      StrCpy $1 0
      ${DoUntil} ${FileExists} "$PLUGINSDIR\brevia-uninstall-result"
        Sleep 250
        IntOp $1 $1 + 1
        ${If} $1 >= 480
          StrCpy $0 1
          ${Break}
        ${EndIf}
      ${Loop}
      ${If} $0 = 0
        ClearErrors
        StrCpy $0 1
        FileOpen $1 "$PLUGINSDIR\brevia-uninstall-result" r
        FileRead $1 $0
        FileClose $1
        ${If} ${Errors}
          StrCpy $0 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${Else}
    ClearErrors
    ExecWait '$\"$PLUGINSDIR\brevia-old-uninstaller.exe$\" /S /KEEP_APP_DATA --updated /allusers _?=$BreviaLegacyDir' $0
    ${If} ${Errors}
      StrCpy $0 1
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p $BreviaUninstallerHandle)'
  ${If} $0 != 0
  ${OrIf} ${FileExists} "$BreviaLegacyDir\Brevia.exe"
  ${OrIf} ${FileExists} "$BreviaLegacyDir\resources\app.asar"
    SetErrorLevel 1603
    Abort "$(BreviaMigrationFailed)"
  ${EndIf}
  ${If} $BreviaLegacyView = 32
    SetRegView 32
  ${Else}
    SetRegView 64
  ${EndIf}
  ${If} $BreviaLegacyScope == "currentuser"
    ReadRegStr $1 HKCU "${BREVIA_LEGACY_KEY}" "UninstallString"
  ${Else}
    ReadRegStr $1 HKLM "${BREVIA_LEGACY_KEY}" "UninstallString"
  ${EndIf}
  SetRegView 64
  ${If} $1 != ""
    SetErrorLevel 1603
    Abort "$(BreviaMigrationFailed)"
  ${EndIf}
  SetOutPath "$INSTDIR"
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Call BreviaMigrateLegacy
!macroend
