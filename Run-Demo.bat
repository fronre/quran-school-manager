@echo off
rem Opens Mishkat on the DEMO data (apps\desktop\out\demo). Real data is not touched.
rem Sign in with:  demo  /  sidi-aoun-test-2026-pass
start "" "%LOCALAPPDATA%\Programs\Mishkat\Mishkat.exe" --user-data-dir="%~dp0apps\desktop\out\demo"
