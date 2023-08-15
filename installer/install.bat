@echo off
setlocal

set url=https://github.com/electron/electron/releases/download/v25.5.0/electron-v25.5.0-win32-x64.zip
set filename=%~dp0\bin\electron.zip
set extractdir=%~dp0\bin
set tarloc=%~dp0\util\tar.exe
set shortcutloc=%~dp0\util\shortcut.exe
set appfilessource=%~dp0\resources\*.asar
set appfilesdestination=%~dp0\bin\resources\*.asar

if exist "%extractdir%" (
    rd /s /q "%extractdir%"
	if %errorlevel% neq 0 (
		echo Error occured.
		goto error
	)
)
if exist "%filename%" (
    del /f /q "%filename%"
	if %errorlevel% neq 0 (
		echo Error occured.
		goto error
	)
)

mkdir "%extractdir%"
echo Downloading from %url%...
bitsadmin.exe /transfer "DownloadJob" /download /priority normal "%url%" "%filename%"
if %errorlevel% neq 0 (
    echo Error downloading file.
    goto error
)

echo Installing...
cd "%extractdir%"
"%tarloc%" -xf "%filename%"
if %errorlevel% neq 0 (
    echo Error extracting file.
    goto error
)

cd..

del /f /q "%appfilesdestination%"
if %errorlevel% neq 0 (
    echo Error occured.
	goto error
)

copy "%appfilessource%" "%appfilesdestination%"
if %errorlevel% neq 0 (
    echo Error occured.
	goto error
)

set sourceexe=%~dp0\bin\electron.exe
set destinationshrtcut=%~dp0\App.lnk
if exist "%destinationshrtcut%" del /f /q "%destinationshrtcut%"
"%shortcutloc%" /f:"%destinationshrtcut%" /t:"%sourceexe%" /a:c

if %errorlevel% neq 0 (
    echo Error creating shortcut.
	goto error
)

if exist "%filename%" (
    del /f /q "%filename%"
)

rem set installer=%~dp0\install.bat
rem if exist "%installer%" (
rem    del /f /q "%installer%"
rem )

echo Installation Complete.
goto end

:error
echo .
echo Installation incomplete.
goto end



:end
pause