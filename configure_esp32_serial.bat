@echo off
chcp 65001 >nul
title Прямая настройка Wi-Fi и диагностика ESP32 через COM-порт
color 0E

echo ======================================================================
echo    ПРЯМАЯ НАСТРОЙКА WI-FI И СЕТИ ESP32 ЧЕРЕЗ COM-ПОРТ (USB)
echo ======================================================================
echo.

:: Поиск доступных COM-портов
echo Доступные COM-порты в системе:
powershell -Command "[System.IO.Ports.SerialPort]::getportnames()"
echo.

set /p COMPORT="Введите номер COM-порта (например, COM3 или COM4): "
if "%COMPORT%"=="" (
    echo Номер порта не введен!
    pause
    exit /b
)

echo.
echo ======================================================================
echo Выберите действие:
echo 1 - Прочитать текущий IP и статус сети из ESP32 (Монитор порта)
echo 2 - Сбросить память Wi-Fi / NVS (чтобы включилась точка доступа ESP-Lestn)
echo 3 - Прошить полный образ (firmware_merged.bin на адрес 0x0)
echo ======================================================================
set /p ACTION="Выберите пункт (1, 2 или 3): "

if "%ACTION%"=="1" (
    echo.
    echo Открываю монитор порта %COMPORT% на скорости 115200...
    echo Нажмите кнопку RESET / EN на плате ESP32 для вывода IP-адреса.
    echo (Для выхода нажмите Ctrl+C)
    echo.
    powershell -Command "$port = new-Object System.IO.Ports.SerialPort %COMPORT%,115200,None,8,one; $port.open(); while($true){ Write-Host $port.ReadLine() }"
)

if "%ACTION%"=="2" (
    echo.
    echo Очистка NVS Flash памяти на ESP32...
    python -m esptool --chip esp32 -p %COMPORT% erase_region 0x9000 0x6000
    echo Память NVS очищена! Теперь при старте включится точка доступа ESP-Lestn (192.168.4.1).
    echo Нажмите кнопку RESET на плате.
)

if "%ACTION%"=="3" (
    echo.
    echo Скачивание свежей прошивки latest из GitHub...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/geminibitok-oss/ESP-v2/releases/download/latest/firmware_merged.bin' -OutFile 'firmware_merged.bin'"
    echo Прошивка ESP32...
    python -m esptool --chip esp32 -p %COMPORT% -b 460800 write_flash 0x0 firmware_merged.bin
    echo.
    echo Прошивка успешно завершена! Плата перезагружена.
)

pause
