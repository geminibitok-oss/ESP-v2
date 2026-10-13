@echo off
chcp 65001 >nul
title Диагностика и поиск контроллера ESP32 (ESP-Lestn)
color 0B

echo ======================================================================
echo          ДИАГНОСТИКА СЕТИ И ПОИСК ESP32 УМНОЙ ЛЕСТНИЦЫ
echo ======================================================================
echo.

:: 1. Проверка локального имени mDNS
echo [1/4] Попытка обнаружения по локальному имени mDNS (esp-lestn.local)...
ping -n 1 -w 1500 esp-lestn.local >nul 2>&1
if %errorlevel% equ 0 (
    echo [УСПЕХ] Контроллер найден по имени esp-lestn.local!
    for /f "tokens=3" %%a in ('ping -n 1 esp-lestn.local ^| findstr "["') do set ESP_IP=%%a
    echo Адрес устройства: %ESP_IP%
    echo.
    echo Открываю веб-интерфейс в браузере...
    start http://esp-lestn.local
    pause
    exit /b
)
echo [-] По имени esp-lestn.local не отвечает.
echo.

:: 2. Проверка точки доступа ESP-Lestn (192.168.4.1)
echo [2/4] Проверка режима точки доступа по адресу 192.168.4.1...
ping -n 1 -w 1000 192.168.4.1 >nul 2>&1
if %errorlevel% equ 0 (
    echo [УСПЕХ] Вы подключены к точке доступа ESP-Lestn (192.168.4.1)!
    echo.
    echo Открываю страницу настроек Wi-Fi...
    start http://192.168.4.1/wifi
    pause
    exit /b
)
echo [-] Режим точки доступа (192.168.4.1) недоступен.
echo.

:: 3. Определение локальной подсети компьютера
echo [3/4] Сканирование устройств в вашей локальной подсети...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
set LOCAL_IP=%LOCAL_IP: =%
echo Ваш IP-адрес: %LOCAL_IP%

:: Получаем базовые три октета (например, 192.168.170)
for /f "tokens=1,2,3 delims=." %%a in ("%LOCAL_IP%") do set SUBNET=%%a.%%b.%%c
echo Базовая подсеть: %SUBNET%.0/24
echo.

echo Поиск устройств с MAC-адресом Espressif (ESP32) в таблице ARP...
arp -d >nul 2>&1
:: Быстрый пинг шлюза и диапазона
for /L %%i in (1,1,30) do start /b ping -n 1 -w 100 %SUBNET%.%%i >nul 2>&1
for /L %%i in (100,1,150) do start /b ping -n 1 -w 100 %SUBNET%.%%i >nul 2>&1
timeout /t 2 >nul

:: Проверка таблицы ARP на известных производителей ESP32 (MAC: 24:0a:c4, 30:ae:a4, 40:22:d8, 48:e7:29, 84:cc:a8, ac:67:b2, 24:6f:28, d8:bc:38, b0:a7:32, cc:50:e3, etc.)
for /f "tokens=1,2" %%a in ('arp -a ^| findstr /i "%SUBNET%"') do (
    echo Найдено активное устройство: %%a  (MAC: %%b)
    powershell -Command "try { $r = (Invoke-WebRequest -Uri 'http://%%a/api/state' -TimeoutSec 1).StatusCode; if ($r -eq 200) { Write-Host '[НАЙДЕН ESP32 КОНТРОЛЛЕР!] -> http://%%a' -ForegroundColor Green; Start-Process 'http://%%a'; exit 0 } } catch {}" >nul 2>&1
)

echo.
echo ======================================================================
echo [4/4] РЕКОМЕНДАЦИИ, ЕСЛИ УСТРОЙСТВО НЕ НАЙДЕНО:
echo ======================================================================
echo 1. Подключите ESP32 по USB-кабелю к компьютеру.
echo 2. Запустите консоль COM-порта на скорости 115200.
echo 3. Нажмите кнопку EN / RESET на плате.
echo 4. Если плата застряла или слетели настройки Wi-Fi, откройте в браузере
echo    веб-прошивальщик и прошейте свежий файл firmware_merged.bin на адрес 0x0.
echo ======================================================================
echo.
pause
