@echo off
setlocal enabledelayedexpansion

REM Atomic CLI installer for Windows cmd.exe.
REM
REM Modeled on Claude Code's install.cmd: download a verified prebuilt
REM binary from GitHub Releases, then hand off to `atomic install` for
REM placement, PATH wiring, mux detection, and shell completions.
REM
REM Usage:
REM   curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.cmd -o install.cmd ^&^& install.cmd ^&^& del install.cmd
REM
REM Pin a specific version:
REM   ... ^&^& install.cmd 0.4.47 ^&^& del install.cmd

set "TARGET=%~1"
if "!TARGET!"=="" set "TARGET=latest"

REM Validate target — accept stable, latest, or semver-shaped strings
REM (with optional prerelease suffix, e.g. 0.4.47-0). Anchored end-to-end
REM via two passes: the semver shape, plus a reject pass for anything not
REM in the allowed character set. Mirrors install.sh / install.ps1.
if /i "!TARGET!"=="stable" goto :target_valid
if /i "!TARGET!"=="latest" goto :target_valid
echo !TARGET! | findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*" >nul
if !ERRORLEVEL! neq 0 goto :target_invalid
REM Reject any character outside [0-9.\-A-Za-z] (covers `1.2.3foo$weird`,
REM `1.2.3 ` etc) — findstr lacks a true `$` anchor, so reject by class.
echo !TARGET! | findstr /r "[^0-9A-Za-z.\-]" >nul
if !ERRORLEVEL! equ 0 goto :target_invalid
goto :target_valid

:target_invalid
echo Usage: %~nx0 [stable^|latest^|VERSION] >&2
echo Example: %~nx0 0.4.47 >&2
exit /b 1

:target_valid

REM Reject 32-bit Windows.
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto :arch_valid
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" goto :arch_valid
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto :arch_valid
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" goto :arch_valid

echo atomic does not support 32-bit Windows. Please use a 64-bit version of Windows. >&2
exit /b 1

:arch_valid

set "RELEASES_BASE=https://github.com/flora131/atomic/releases"
set "DOWNLOAD_DIR=%USERPROFILE%\.atomic\downloads"

if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "PLATFORM=windows-arm64"
) else (
    set "PLATFORM=windows-x64"
)

if not exist "!DOWNLOAD_DIR!" mkdir "!DOWNLOAD_DIR!"

curl --version >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo curl is required but not available. Install curl ^(ships with Windows 10+^) or use install.ps1 instead. >&2
    exit /b 1
)

REM Resolve manifest URL.
if /i "!TARGET!"=="latest" (
    set "MANIFEST_URL=!RELEASES_BASE!/latest/download/manifest.json"
) else if /i "!TARGET!"=="stable" (
    set "MANIFEST_URL=!RELEASES_BASE!/latest/download/manifest.json"
) else (
    set "MANIFEST_URL=!RELEASES_BASE!/download/v!TARGET!/manifest.json"
)

call :download_file "!MANIFEST_URL!" "!DOWNLOAD_DIR!\manifest.json"
if !ERRORLEVEL! neq 0 (
    echo Failed to fetch manifest from !MANIFEST_URL! >&2
    exit /b 1
)

call :parse_manifest "!DOWNLOAD_DIR!\manifest.json" "!PLATFORM!"
if !ERRORLEVEL! neq 0 (
    echo Platform !PLATFORM! not found in manifest >&2
    del "!DOWNLOAD_DIR!\manifest.json" 2>nul
    exit /b 1
)
del "!DOWNLOAD_DIR!\manifest.json"

REM !VERSION! and !EXPECTED_CHECKSUM! are set by parse_manifest.
set "BINARY_URL=!RELEASES_BASE!/download/v!VERSION!/atomic-!PLATFORM!.exe"
set "BINARY_PATH=!DOWNLOAD_DIR!\atomic-!VERSION!-!PLATFORM!.exe"

call :download_file "!BINARY_URL!" "!BINARY_PATH!"
if !ERRORLEVEL! neq 0 (
    echo Failed to download binary from !BINARY_URL! >&2
    if exist "!BINARY_PATH!" del "!BINARY_PATH!"
    exit /b 1
)

call :verify_checksum "!BINARY_PATH!" "!EXPECTED_CHECKSUM!"
if !ERRORLEVEL! neq 0 (
    echo Checksum verification failed >&2
    del "!BINARY_PATH!"
    exit /b 1
)

REM Hand off to the binary's `install` subcommand.
echo Setting up atomic...
"!BINARY_PATH!" install
set "INSTALL_RESULT=!ERRORLEVEL!"

REM Wait briefly for any handles to release before deleting.
timeout /t 1 /nobreak >nul 2>&1
del /f "!BINARY_PATH!" >nul 2>&1
if exist "!BINARY_PATH!" (
    echo Warning: Could not remove temporary file: !BINARY_PATH!
)

if !INSTALL_RESULT! neq 0 (
    echo Installation failed >&2
    exit /b 1
)

echo.
echo Installation complete^!
echo.
exit /b 0

REM ============================================================================
REM SUBROUTINES
REM ============================================================================

:download_file
REM %1=URL  %2=OutputPath
curl -fsSL --retry 3 "%~1" -o "%~2"
exit /b !ERRORLEVEL!

:parse_manifest
REM Extract version + platform.<name>.checksum from manifest JSON using
REM only findstr — no jq, no PowerShell.
REM
REM %1=ManifestPath  %2=Platform
REM Sets: VERSION, EXPECTED_CHECKSUM
set "MANIFEST_PATH=%~1"
set "PLATFORM_NAME=%~2"
set "VERSION="
set "EXPECTED_CHECKSUM="
set "IN_PLATFORM_SECTION="

for /f "usebackq tokens=*" %%i in ("!MANIFEST_PATH!") do (
    set "LINE=%%i"

    REM Top-level "version": "..." (only matched outside platform section).
    if not defined IN_PLATFORM_SECTION (
        echo !LINE! | findstr /c:"\"version\":" >nul
        if !ERRORLEVEL! equ 0 (
            for /f "tokens=2 delims=:" %%j in ("!LINE!") do (
                set "VPART=%%j"
                set "VPART=!VPART: =!"
                set "VPART=!VPART:"=!"
                set "VPART=!VPART:,=!"
                if not "!VPART!"=="" set "VERSION=!VPART!"
            )
        )
    )

    echo !LINE! | findstr /c:"\"%PLATFORM_NAME%\":" >nul
    if !ERRORLEVEL! equ 0 set "IN_PLATFORM_SECTION=1"

    if defined IN_PLATFORM_SECTION (
        echo !LINE! | findstr /c:"\"checksum\":" >nul
        if !ERRORLEVEL! equ 0 (
            for /f "tokens=2 delims=:" %%j in ("!LINE!") do (
                set "CPART=%%j"
                set "CPART=!CPART: =!"
                set "CPART=!CPART:"=!"
                set "CPART=!CPART:,=!"
                if not "!CPART!"=="" (
                    call :check_length "!CPART!" 64
                    if !ERRORLEVEL! equ 0 (
                        set "EXPECTED_CHECKSUM=!CPART!"
                        if not "!VERSION!"=="" exit /b 0
                    )
                )
            )
        )
        echo !LINE! | findstr /c:"}" >nul
        if !ERRORLEVEL! equ 0 set "IN_PLATFORM_SECTION="
    )
)

if "!EXPECTED_CHECKSUM!"=="" exit /b 1
if "!VERSION!"=="" exit /b 1
exit /b 0

:check_length
REM %1=String  %2=ExpectedLength
set "STR=%~1"
set "EXPECTED_LEN=%~2"
set "LEN=0"
:count_loop
if "!STR:~%LEN%,1!"=="" goto :count_done
set /a LEN+=1
goto :count_loop
:count_done
if %LEN%==%EXPECTED_LEN% exit /b 0
exit /b 1

:verify_checksum
REM %1=FilePath  %2=ExpectedChecksum  (case-insensitive)
set "FILE_PATH=%~1"
set "EXPECTED=%~2"

for /f "skip=1 tokens=*" %%i in ('certutil -hashfile "!FILE_PATH!" SHA256') do (
    set "ACTUAL=%%i"
    set "ACTUAL=!ACTUAL: =!"
    if "!ACTUAL!"=="CertUtil:Thecommandcompletedsuccessfully." goto :verify_done
    if "!ACTUAL!" neq "" (
        if /i "!ACTUAL!"=="!EXPECTED!" (
            exit /b 0
        ) else (
            exit /b 1
        )
    )
)

:verify_done
exit /b 1
