@echo off
rem Erases ONE test copy (test-run\<name>) so the next Run-Test.bat starts from zero. Real data and demo data are not touched.
rem   Reset-Test.bat        -> erases test-run\pc1
rem   Reset-Test.bat pc2    -> erases test-run\pc2
rem Close Mishkat first.
set "NAME=%~1"
if "%NAME%"=="" set "NAME=pc1"
if not exist "%~dp0test-run\%NAME%" (
  echo Nothing to erase: test-run\%NAME% does not exist.
  pause
  exit /b 0
)
echo This permanently erases the TEST copy: %~dp0test-run\%NAME%
echo Real data and demo data are not touched. Close Mishkat before continuing.
choice /c YN /m "Erase it now"
if errorlevel 2 exit /b 0
rmdir /s /q "%~dp0test-run\%NAME%"
if exist "%~dp0test-run\%NAME%" (echo Could not erase it. Is Mishkat still open?) else (echo Done. The next Run-Test.bat %NAME% starts from zero.)
pause
