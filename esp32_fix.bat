@echo off
setlocal enabledelayedexpansion
title ESP32 Rescue and Serial Monitor

echo ========================================================
echo        ESP32 RESCUE AND SERIAL MONITOR
echo ========================================================
echo.

echo Available COM ports:
powershell -Command "[System.IO.Ports.SerialPort]::getportnames()"
echo.

set /p COMPORT=Enter COM port (example COM3 or COM4): 
if "%COMPORT%"=="" (
    echo Error: COM port not entered!
    pause
    exit /b
)

echo.
echo 1 - Serial Monitor (Read IP address and logs at 115200)
echo 2 - Reset NVS Settings (Force launch AP mode 192.168.4.1)
echo 3 - Download and Flash latest firmware_merged.bin
echo.
set /p ACTION=Select option (1, 2 or 3): 

if "%ACTION%"=="1" (
    echo.
    echo Opening serial port %COMPORT% at 115200 baud...
    echo Press the RESET or EN button on your ESP32 board now!
    echo (Press Ctrl+C to stop)
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = new-Object System.IO.Ports.SerialPort '%COMPORT%',115200,None,8,one; $port.DtrEnable = $true; $port.RtsEnable = $true; $port.ReadTimeout = 5000; try { $port.Open(); Write-Host 'Port opened! Waiting for ESP32 logs...' -ForegroundColor Green; while($true){ try { $line = $port.ReadLine(); Write-Host $line } catch [TimeoutException] {} } } catch { Write-Host 'Cannot open port: ' $_.Exception.Message -ForegroundColor Red } finally { if ($port.IsOpen) { $port.Close() } }"
)

if "%ACTION%"=="2" (
    echo.
    echo Erasing NVS memory...
    python -m esptool --chip esp32 -p %COMPORT% erase_region 0x11000 0x6000
    if errorlevel 1 (
        esptool.py --chip esp32 -p %COMPORT% erase_region 0x11000 0x6000
    )
    echo.
    echo NVS wiped! Reset board to boot into AP mode (192.168.4.1).
)

if "%ACTION%"=="3" (
    echo.
    echo Downloading firmware_merged.bin from GitHub...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://github.com/geminibitok-oss/ESP-v2/releases/download/latest/firmware_merged.bin', 'firmware_merged.bin')"
    echo Flashing ESP32 at 0x0...
    python -m esptool --chip esp32 -p %COMPORT% -b 460800 write_flash 0x0 firmware_merged.bin
    if errorlevel 1 (
        esptool.py --chip esp32 -p %COMPORT% -b 460800 write_flash 0x0 firmware_merged.bin
    )
    echo Flash completed!
)

echo.
pause
