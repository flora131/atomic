: << 'CMDBLOCK'
@echo off
REM Polyglot wrapper: runs .sh scripts cross-platform
REM Usage: run.cmd <script-path> [args...]
REM Script path is relative to this wrapper's directory

if "%~1"=="" (
    echo run.cmd: missing script path >&2
    exit /b 1
)
wsl bash -l "%~dp0%~1" %2 %3 %4 %5 %6 %7 %8 %9
exit /b
CMDBLOCK

# Unix shell runs from here
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="$1"
shift
"${SCRIPT_DIR}/${SCRIPT_PATH}" "$@"
