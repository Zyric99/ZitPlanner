!include "LogicLib.nsh"
!include "Sections.nsh"

!define UNINSTALL_SECTION_NAME "Zitplanner verwijderen"

!ifdef BUILD_UNINSTALLER
  !define MUI_COMPONENTSPAGE_TEXT_TOP "Uw gegevens blijven standaard bewaard. Vink de extra optie aan om alle projecten, back-ups en instellingen van dit Windows-account definitief te verwijderen."
  Var zitplannerDataRoot
!endif

!macro customUnInit
  ; Capture this user's roaming AppData even for an all-users installation.
  SetShellVarContext current
  StrCpy $zitplannerDataRoot "$APPDATA"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  Call un.ZitplannerSetDataRemoval
!macroend

!macro customUnInstallSection
  ; electron-builder inserts the components page when this macro is present.
  ; /o leaves the extra component unchecked, including for silent uninstalls.
  Section /o "un.Ook gegevens en projecten verwijderen" ZITPLANNER_DELETE_DATA_SECTION
    ${IfNot} ${isUpdated}
      ${If} $zitplannerDataRoot != ""
        ; The only deletion target is the installed app's own profile folder.
        GetFullPathName $R0 "$zitplannerDataRoot\Zitplanner"
        ClearErrors
        RMDir /r "$R0"
        ${If} ${Errors}
          DetailPrint "Niet alle Zitplanner-gegevens konden worden verwijderd: $R0"
          ${IfNot} ${Silent}
            MessageBox MB_OK|MB_ICONEXCLAMATION "Niet alle opgeslagen gegevens konden worden verwijderd. Controleer de map:$\r$\n$R0"
          ${EndIf}
          SetErrorLevel 1
        ${EndIf}
      ${EndIf}
    ${EndIf}
  SectionEnd

  Function un.ZitplannerSetDataRemoval
    ; Updates must preserve data even if an unattended deletion flag is passed.
    ${If} ${isUpdated}
      SectionSetFlags ${ZITPLANNER_DELETE_DATA_SECTION} 0
      Return
    ${EndIf}
    ; Optional explicit opt-in for administrators performing a silent uninstall.
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "--delete-zitplanner-data" $R1
    ${IfNot} ${Errors}
      SectionGetFlags ${ZITPLANNER_DELETE_DATA_SECTION} $R1
      IntOp $R1 $R1 | ${SF_SELECTED}
      SectionSetFlags ${ZITPLANNER_DELETE_DATA_SECTION} $R1
    ${EndIf}
  FunctionEnd
!macroend
