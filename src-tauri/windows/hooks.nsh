; Our additions to Tauri's installer (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; The launcher always goes in %LOCALAPPDATA%\Wraith\launcher, beside what it installs there
; itself (wraith\), so instead of MUI's folder page there's ours: where it goes (not changeable),
; whether to put `wraith` on PATH, and Install. Tauri's installer has no setting for either. This
; file is included after MUI2 and before the pages are set up, so it can replace the folder page.
; If a Tauri update moves things around, the installer fails to build rather than quietly letting
; people pick a folder again.

!macroundef MUI_PAGE_DIRECTORY
!macro MUI_PAGE_DIRECTORY
  ; The template's PRE (skip when passive) was for MUI's page. Ours calls it itself
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  Page custom LauncherInstallPage LauncherInstallLeave
!macroend

; 1 to put `wraith` on PATH after installing. Only the page sets it, so updates leave PATH alone
Var LauncherAddToPath
Var LauncherPathBox

Function LauncherInstallPage
  Call SkipIfPassive
  ; Not ${PRODUCTNAME}: functions here compile before Tauri defines it
  StrCpy $INSTDIR "$LOCALAPPDATA\$(^Name)\launcher"
  !insertmacro MUI_HEADER_TEXT "Ready to install" "$(^Name) installs in your user folder, so it doesn't need admin rights."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 24u "It always goes here, with the Wraith versions it installs beside it:"
  Pop $0
  ${NSD_CreateText} 0 26u 100% 12u "$INSTDIR"
  Pop $0
  SendMessage $0 ${EM_SETREADONLY} 1 0
  ${NSD_CreateCheckbox} 0 52u 100% 12u "Add the &wraith command to PATH, for building plugins"
  Pop $LauncherPathBox
  ${NSD_Check} $LauncherPathBox
  ${NSD_CreateLabel} 12u 66u -12u 24u "You can change this later at the bottom of the launcher's Plugins tab."
  Pop $0
  ${NSD_CreateLabel} 0 100u 100% 12u "Click Install to install it."
  Pop $0
  ; Installing is next. The start menu page between is always skipped, so NSIS says Next
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^InstallBtn)"
  nsDialogs::Show
FunctionEnd

Function LauncherInstallLeave
  ${NSD_GetState} $LauncherPathBox $LauncherAddToPath
FunctionEnd

; Again for passive installs and updates, which skip the folder page
!macro NSIS_HOOK_PREINSTALL
  StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}\launcher"
  SetOutPath $INSTDIR
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $LauncherAddToPath == ${BST_CHECKED}
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --add-cli'
  ${EndIf}
!macroend

; The launcher keeps `wraith` in %LOCALAPPDATA%\Wraith\bin, maybe on PATH (src-tauri/src/cli.rs).
; Take both away with it
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --remove-cli'
!macroend
