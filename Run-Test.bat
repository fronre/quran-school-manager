@echo off
rem Opens Mishkat on an EMPTY TEST copy of the data (test-run\<name>). Real data and demo data are not touched.
rem   Run-Test.bat          -> test-run\pc1  (first "computer": do the full checklist here)
rem   Run-Test.bat pc2      -> test-run\pc2  (second "computer": use it to test restoring a backup)
rem First run shows the setup wizard; the ready account is admin / admin.
set "NAME=%~1"
if "%NAME%"=="" set "NAME=pc1"
if not exist "%~dp0test-run" mkdir "%~dp0test-run"
start "" "%LOCALAPPDATA%\Programs\Mishkat\Mishkat.exe" --user-data-dir="%~dp0test-run\%NAME%"
