import React, { useState, useEffect } from 'react';
import { StaircaseSettings } from '../types';
import { 
  Globe, 
  Save, 
  Wifi, 
  CheckCircle2, 
  Sun, 
  Moon, 
  Clock, 
  Compass, 
  Calendar,
  Sparkles,
  MapPin,
  Upload,
  RotateCw,
  RotateCcw,
  Sliders,
  Layers,
  Radar,
  Gauge,
  Activity,
  AlertCircle,
  Info,
  Copy,
  Download,
  Terminal,
  Check
, Github, Tag, Zap, RefreshCw } from 'lucide-react';
import { GitHubRelease } from '../types';

interface DeviceWebInterfaceProps {
  settings: StaircaseSettings;
  onUpdateSettings: (newSettings: Partial<StaircaseSettings>) => void;
}

export const DeviceWebInterface: React.FC<DeviceWebInterfaceProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'control' | 'settings' | 'wifi' | 'ota'>('control');
  const [formState, setFormState] = useState<StaircaseSettings>(settings);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // OTA state in Device Web Interface
  const [otaFile, setOtaFile] = useState<File | null>(null);
  const [otaUploading, setOtaUploading] = useState(false);
  const [otaProgress, setOtaProgress] = useState(0);
  const [otaSuccess, setOtaSuccess] = useState(false);
  const [otaRebootTimer, setOtaRebootTimer] = useState<number | null>(null);
  const [activePartition, setActivePartition] = useState<'ota_0' | 'ota_1'>('ota_0');
  const [currentFwVersion, setCurrentFwVersion] = useState('v2.0.0');

  // GitHub Releases state in Device Web Interface
  const [deviceReleases, setDeviceReleases] = useState<GitHubRelease[]>([]);
  const [isLoadingReleases, setIsLoadingReleases] = useState(false);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState<string>('latest');
  const [releaseCheckError, setReleaseCheckError] = useState<string | null>(null);

  const fetchDeviceReleases = async () => {
    setIsLoadingReleases(true);
    setReleaseCheckError(null);
    try {
      const res = await fetch('https://api.github.com/repos/geminibitok-oss/ESP-v2/releases?per_page=15');
      if (res.ok) {
        const data = await res.json();
        setDeviceReleases(data || []);
        if (data && data.length > 0 && !selectedReleaseTag) {
          setSelectedReleaseTag(data[0].tag_name);
        }
      } else {
        setReleaseCheckError(`Статус HTTP: ${res.status}`);
      }
    } catch (e: any) {
      setReleaseCheckError('Не удалось загрузить релизы с GitHub');
    } finally {
      setIsLoadingReleases(false);
    }
  };

  useEffect(() => {
    fetchDeviceReleases();
  }, []);

  const handleInstallRelease = (tag: string) => {
    setOtaUploading(true);
    setOtaProgress(0);
    setOtaSuccess(false);
    let p = 0;
    const interval = setInterval(() => {
      p += 20;
      if (p <= 100) {
        setOtaProgress(p);
      } else {
        clearInterval(interval);
        setOtaUploading(false);
        setOtaSuccess(true);
        setOtaFile(null);
        let countdown = 6;
        setOtaRebootTimer(countdown);
        const restartTimer = setInterval(() => {
          countdown--;
          if (countdown <= 0) {
            clearInterval(restartTimer);
            setOtaRebootTimer(null);
            setActivePartition((prev) => (prev === 'ota_0' ? 'ota_1' : 'ota_0'));
            setCurrentFwVersion(tag.startsWith('v') ? tag : (tag === 'latest' ? 'v2.0.1 (Latest)' : tag));
            setSaveToast(`ESP32 успешно обновлен на версию ${tag} и перезагружен в новый OTA раздел!`);
          } else {
            setOtaRebootTimer(countdown);
          }
        }, 1000);
      }
    }, 400);
  };

  // Sensor state reset state
  const [isResettingSensors, setIsResettingSensors] = useState(false);
  const [sensorResetFeedback, setSensorResetFeedback] = useState<string | null>(null);

  const handleManualResetSensors = () => {
    setIsResettingSensors(true);
    setSensorResetFeedback('Датчики сброшены');
    setSaveToast('Состояние аппаратных датчиков сброшено в режим ожидания (IDLE)!');
    setTimeout(() => {
      setIsResettingSensors(false);
      setTimeout(() => {
        setSensorResetFeedback(null);
      }, 3500);
    }, 400);
  };

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Wi-Fi direct save & curl helpers
  const [copiedWifiCmd, setCopiedWifiCmd] = useState(false);
  const [isSendingWifiDirect, setIsSendingWifiDirect] = useState(false);
  const [wifiDirectResult, setWifiDirectResult] = useState<string | null>(null);

  const handleCopyWifiCurl = () => {
    const cmd = `curl.exe -X POST "http://192.168.4.1/wifi" -d "ssid=${encodeURIComponent(formState.wifi_ssid || '')}&pass=${encodeURIComponent(formState.wifi_password || '')}&hostname=${encodeURIComponent(formState.hostname || 'esp-stairs')}"`;
    navigator.clipboard.writeText(cmd);
    setCopiedWifiCmd(true);
    setTimeout(() => setCopiedWifiCmd(false), 2500);
  };

  const handleDownloadWifiBat = () => {
    const bat = `@echo off
chcp 65001 >nul
echo ========================================================
echo   Сохранение настроек Wi-Fi в ESP32 (без ошибок header)
echo ========================================================
echo.
echo Отправка команды на http://192.168.4.1/wifi...
curl.exe -X POST "http://192.168.4.1/wifi" -d "ssid=${encodeURIComponent(formState.wifi_ssid || '')}&pass=${encodeURIComponent(formState.wifi_password || '')}&hostname=${encodeURIComponent(formState.hostname || 'esp-stairs')}"
echo.
echo ========================================================
echo Если связь разорвалась или получен ответ -
echo настройки сохранены! ESP32 перезагружается в вашу сеть.
echo ========================================================
pause
`;
    const blob = new Blob([bat], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'save_wifi.bat';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendWifiDirect = async () => {
    setIsSendingWifiDirect(true);
    setWifiDirectResult(null);
    try {
      const body = `ssid=${encodeURIComponent(formState.wifi_ssid || '')}&pass=${encodeURIComponent(formState.wifi_password || '')}&hostname=${encodeURIComponent(formState.hostname || 'esp-stairs')}`;
      await fetch('http://192.168.4.1/wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        mode: 'no-cors'
      });
      setWifiDirectResult('Команда отправлена! ESP32 сохранил параметры и перезагружается.');
      setSaveToast('Wi-Fi параметры переданы на ESP32!');
    } catch {
      setWifiDirectResult('Запрос передан на 192.168.4.1 (ESP32 перезагружается).');
    } finally {
      setIsSendingWifiDirect(false);
    }
  };

  // Astronomical calculation helper (NOAA method in JS)
  const calculateSunTimes = (lat: number, lon: number, tz: number) => {
    const now = currentTime;
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const diff = now.getTime() - startOfYear.getTime();
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

    const deg2rad = Math.PI / 180.0;
    const rad2deg = 180.0 / Math.PI;

    const B = (360.0 / 365.0) * (dayOfYear - 81) * deg2rad;
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const decl = 23.45 * Math.sin(deg2rad * (360.0 / 365.0) * (dayOfYear - 81));
    const decl_rad = decl * deg2rad;
    const lat_rad = lat * deg2rad;

    const zenith = 90.8333 * deg2rad;
    const cos_ha = (Math.cos(zenith) - Math.sin(lat_rad) * Math.sin(decl_rad)) / 
                   (Math.cos(lat_rad) * Math.cos(decl_rad));
    const clamped_cos = Math.max(-1.0, Math.min(1.0, cos_ha));
    const ha_deg = Math.acos(clamped_cos) * rad2deg;
    const ha_hours = ha_deg / 15.0;

    const solar_noon = 12.0 - (lon / 15.0) - (eot / 60.0) + tz;
    let sunrise_h = solar_noon - ha_hours;
    let sunset_h = solar_noon + ha_hours;

    while (sunrise_h < 0) sunrise_h += 24;
    while (sunrise_h >= 24) sunrise_h -= 24;
    while (sunset_h < 0) sunset_h += 24;
    while (sunset_h >= 24) sunset_h -= 24;

    const sr_h = Math.floor(sunrise_h);
    const sr_m = Math.floor((sunrise_h - sr_h) * 60);
    const ss_h = Math.floor(sunset_h);
    const ss_m = Math.floor((sunset_h - ss_h) * 60);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return {
      sunriseStr: `${pad(sr_h)}:${pad(sr_m)}`,
      sunsetStr: `${pad(ss_h)}:${pad(ss_m)}`,
      sunriseDec: sunrise_h,
      sunsetDec: sunset_h,
    };
  };

  const sunData = calculateSunTimes(
    formState.latitude ?? 55.7558,
    formState.longitude ?? 37.6173,
    formState.timezone_offset ?? 3
  );

  // Determine night mode state based on settings
  const nowDecimal = currentTime.getHours() + currentTime.getMinutes() / 60 + currentTime.getSeconds() / 3600;
  const sunsetWithOffset = sunData.sunsetDec + (formState.sunset_offset_min ?? 0) / 60.0;
  const sunriseWithOffset = sunData.sunriseDec + (formState.sunrise_offset_min ?? 0) / 60.0;

  let isNightNow = false;
  if (formState.schedule_mode === 0) {
    // Astro mode
    if (sunsetWithOffset > sunriseWithOffset) {
      isNightNow = nowDecimal >= sunsetWithOffset || nowDecimal < sunriseWithOffset;
    } else {
      isNightNow = nowDecimal >= sunsetWithOffset && nowDecimal < sunriseWithOffset;
    }
  } else if (formState.schedule_mode === 1) {
    // Fixed time mode
    const onDec = (formState.fixed_on_hour ?? 22) + (formState.fixed_on_minute ?? 0) / 60.0;
    const offDec = (formState.fixed_off_hour ?? 7) + (formState.fixed_off_minute ?? 0) / 60.0;
    if (onDec > offDec) {
      isNightNow = nowDecimal >= onDec || nowDecimal < offDec;
    } else {
      isNightNow = nowDecimal >= onDec && nowDecimal < offDec;
    }
  } else if (formState.schedule_mode === 2) {
    isNightNow = true;
  } else {
    isNightNow = false;
  }

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(formState);
    setSaveToast('Настройки сохранены в энергонезависимую память NVS!');
    setTimeout(() => setSaveToast(null), 3500);
  };

  const cityPresets = [
    { name: 'Москва', lat: 55.7558, lon: 37.6173, tz: 3 },
    { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, tz: 3 },
    { name: 'Екатеринбург', lat: 56.8389, lon: 60.6057, tz: 5 },
    { name: 'Новосибирск', lat: 55.0084, lon: 82.9357, tz: 7 },
    { name: 'Владивосток', lat: 43.1155, lon: 131.8855, tz: 10 },
    { name: 'Минск', lat: 53.9045, lon: 27.5615, tz: 3 },
    { name: 'Алматы', lat: 43.2220, lon: 76.8512, tz: 5 },
  ];

  return (
    <div id="device-web-preview" className="space-y-6">
      {/* Browser Frame */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Browser Top Bar */}
        <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>

          <div className="flex-1 max-w-md bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-slate-300 font-mono">
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span>http://192.168.4.1/ (или http://{settings.hostname}.local/)</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1 rounded-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>ESP32 HTTP Server Online</span>
          </div>
        </div>

        {/* Browser Header Fields Warning/Tip */}
        <div className="bg-sky-950/40 border-b border-sky-800/40 px-4 py-2 text-[11px] text-sky-200/90 flex items-center gap-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            <strong>Совет:</strong> Если при открытии <code>192.168.4.1</code> в браузере пишет <em>&quot;header fields are too long&quot;</em> — откройте страницу в режиме <strong>Инкогнито (Ctrl+Shift+N)</strong> или очистите старые куки для 192.168.4.1.
          </span>
        </div>

        {/* Web UI Body */}
        <div className="p-6 sm:p-8 max-w-2xl mx-auto">
          {/* Header & Title */}
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-sky-400 mb-2">
              ✨ Умная лестница ESP-Lestn v2
            </h1>
            <p className="text-xs text-slate-400">
              Встроенный веб-сервер ESP-IDF v5.x • NTP Интернет-время • Астрономический расчет заката/восхода
            </p>
          </div>

          {/* Navigation Bar */}
          <div className="flex items-center gap-2 mb-6 border-b border-slate-700 pb-3">
            <button
              onClick={() => setActiveTab('control')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'control'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Главная & Статус
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Настройки и Астротаймер
            </button>
            <button
              onClick={() => setActiveTab('wifi')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'wifi'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Wi-Fi Сеть
            </button>
            <button
              onClick={() => setActiveTab('ota')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'ota'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Обновление (OTA)
            </button>
          </div>

          {/* Toast Notification */}
          {saveToast && (
            <div className="mb-4 p-3 bg-emerald-950/80 border border-emerald-700 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{saveToast}</span>
            </div>
          )}

          {/* Tab 1: Control Dashboard */}
          {activeTab === 'control' && (
            <div className="space-y-6">
              {/* Astronomical Time Widget Card */}
              <div className="bg-gradient-to-br from-indigo-950/60 to-slate-900 border border-indigo-800/40 rounded-xl p-5 shadow-lg relative overflow-hidden">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-semibold text-sky-300">Интернет-время (NTP)</span>
                  </div>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                    Синхронизировано (UTC{formState.timezone_offset >= 0 ? `+${formState.timezone_offset}` : formState.timezone_offset})
                  </span>
                </div>

                <div className="text-2xl font-bold font-mono text-slate-100 tracking-wider mb-3">
                  {currentTime.toLocaleTimeString('ru-RU')}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80 text-xs">
                  <div className="flex items-center gap-2 text-amber-300">
                    <Sun className="w-4 h-4 text-amber-400" />
                    <span>Восход: <strong>{sunData.sunriseStr}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 text-orange-300">
                    <Moon className="w-4 h-4 text-orange-400" />
                    <span>Закат: <strong>{sunData.sunsetStr}</strong></span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Текущий режим лестницы:</span>
                  <span className={`px-2.5 py-1 rounded-full font-semibold ${
                    isNightNow ? 'bg-indigo-950 text-indigo-300 border border-indigo-700' : 'bg-amber-950 text-amber-300 border border-amber-700'
                  }`}>
                    {isNightNow ? '🌙 Ночная дежурная подсветка' : '☀️ Дневной режим ожидания'}
                  </span>
                </div>
              </div>

              {/* Hardware Sensors State */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-slate-200">Сенсоры движения и присутствия</h2>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                    formState.sensor_type === 1 
                      ? 'bg-sky-950 text-sky-300 border border-sky-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}>
                    {formState.sensor_type === 1 ? '📡 Ультразвуковые HC-SR04' : '👁️ Цифровые PIR / Оптика'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700/60">
                    <div className="text-xs text-slate-400">
                      Нижний датчик {formState.sensor_type === 1 ? `(TRIG: ${settings.sensor_bottom_gpio}, ECHO: ${settings.sensor_bottom_echo_gpio ?? 18})` : `(GPIO ${settings.sensor_bottom_gpio})`}
                    </div>
                    <div className="text-sm font-semibold text-emerald-400 mt-1 flex items-center justify-between">
                      <span>{sensorResetFeedback ? 'СБРОШЕН / ГОТОВ' : 'ГОТОВ / ОЖИДАНИЕ'}</span>
                      {formState.sensor_type === 1 && (
                        <span className="text-xs font-mono text-sky-400 bg-sky-950/60 border border-sky-800/40 px-2 py-0.5 rounded">Порог: &lt;{formState.ultrasonic_trigger_distance_cm ?? 80} см</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700/60">
                    <div className="text-xs text-slate-400">
                      Верхний датчик {formState.sensor_type === 1 ? `(TRIG: ${settings.sensor_top_gpio}, ECHO: ${settings.sensor_top_echo_gpio ?? 19})` : `(GPIO ${settings.sensor_top_gpio})`}
                    </div>
                    <div className="text-sm font-semibold text-emerald-400 mt-1 flex items-center justify-between">
                      <span>{sensorResetFeedback ? 'СБРОШЕН / ГОТОВ' : 'ГОТОВ / ОЖИДАНИЕ'}</span>
                      {formState.sensor_type === 1 && (
                        <span className="text-xs font-mono text-sky-400 bg-sky-950/60 border border-sky-800/40 px-2 py-0.5 rounded">Порог: &lt;{formState.ultrasonic_trigger_distance_cm ?? 80} см</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Manual sensor reset action bar */}
                <div className="p-3 bg-slate-900/90 border border-slate-700/70 rounded-xl flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className={`w-4 h-4 ${isResettingSensors ? 'text-amber-400 animate-spin' : 'text-emerald-400'}`} />
                    <div>
                      <div className="text-xs font-medium text-slate-200">
                        {sensorResetFeedback ? 'Состояние датчиков сброшено в режим ожидания' : 'Аппаратные датчики в режиме ожидания'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formState.sensor_type === 1
                          ? `HC-SR04: сработка при приближении объекта ближе ${formState.ultrasonic_trigger_distance_cm ?? 80} см`
                          : 'PIR: сработка при изменении логического уровня HIGH/LOW'}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleManualResetSensors}
                    disabled={isResettingSensors}
                    className="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
                    title="Ручной сброс состояния датчиков движения"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isResettingSensors ? 'animate-spin' : ''}`} />
                    <span>{isResettingSensors ? 'Сброс...' : 'Сбросить состояние датчиков'}</span>
                  </button>
                </div>

                <div className="text-xs text-slate-300 space-y-1">
                  <div>Ступеней в системе: <strong>{settings.steps}</strong> шт.</div>
                  <div>Диодов на ступень: <strong>{settings.pixels_per_step}</strong> шт. (Всего: {settings.steps * settings.pixels_per_step} диодов)</div>
                  <div>Время задержки шага: <strong>{settings.step_on_time_ms} мс</strong></div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Settings Form */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 shadow-lg space-y-6">
              {/* Section 1: NTP & Astronomical Solar Engine */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sun className="w-4 h-4 text-amber-400" />
                  <h2 className="text-base font-semibold text-slate-200">
                    ☀️ Интернет-время и Астротаймер (Закат / Восход)
                  </h2>
                </div>

                {/* City Presets */}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Быстрый выбор города (Координаты и часовой пояс)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {cityPresets.map((city) => (
                      <button
                        key={city.name}
                        type="button"
                        onClick={() => {
                          setFormState({
                            ...formState,
                            latitude: city.lat,
                            longitude: city.lon,
                            timezone_offset: city.tz,
                          });
                        }}
                        className="px-2.5 py-1 text-xs rounded-md bg-slate-900 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      >
                        {city.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      NTP Синхронизация времени
                    </label>
                    <select
                      value={formState.ntp_enabled ? 1 : 0}
                      onChange={(e) => setFormState({ ...formState, ntp_enabled: e.target.value === '1' })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    >
                      <option value={1}>Включена (SNTP клиент)</option>
                      <option value={0}>Выключена</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Часовой пояс (UTC, часы)
                    </label>
                    <input
                      type="number"
                      min="-12"
                      max="14"
                      value={formState.timezone_offset ?? 3}
                      onChange={(e) => setFormState({ ...formState, timezone_offset: parseInt(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    NTP Сервер времени
                  </label>
                  <input
                    type="text"
                    value={formState.ntp_server ?? 'pool.ntp.org'}
                    onChange={(e) => setFormState({ ...formState, ntp_server: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Широта (Latitude, °)
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={formState.latitude ?? 55.7558}
                      onChange={(e) => setFormState({ ...formState, latitude: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Долгота (Longitude, °)
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={formState.longitude ?? 37.6173}
                      onChange={(e) => setFormState({ ...formState, longitude: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Режим автоматического расписания
                  </label>
                  <select
                    value={formState.schedule_mode ?? 0}
                    onChange={(e) => setFormState({ ...formState, schedule_mode: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  >
                    <option value={0}>🌅 Астрономический (по закату и восходу солнца)</option>
                    <option value={1}>⏰ Фиксированное время (по часам)</option>
                    <option value={2}>🌕 Всегда включен ночной режим</option>
                    <option value={3}>🌑 Выключен (только дневной режим)</option>
                  </select>
                </div>

                {formState.schedule_mode === 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        Смещение от заката (мин, +/-)
                      </label>
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        value={formState.sunset_offset_min ?? 0}
                        onChange={(e) => setFormState({ ...formState, sunset_offset_min: parseInt(e.target.value) || 0 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                      />
                      <span className="text-[10px] text-slate-500">Например, +15 = включить через 15 мин после заката</span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        Смещение от восхода (мин, +/-)
                      </label>
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        value={formState.sunrise_offset_min ?? 0}
                        onChange={(e) => setFormState({ ...formState, sunrise_offset_min: parseInt(e.target.value) || 0 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                      />
                      <span className="text-[10px] text-slate-500">Например, -15 = выключить за 15 мин до восхода</span>
                    </div>
                  </div>
                )}

                {formState.schedule_mode === 1 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        Фиксированное время вкл (ЧЧ:ММ)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={formState.fixed_on_hour ?? 22}
                          onChange={(e) => setFormState({ ...formState, fixed_on_hour: parseInt(e.target.value) || 0 })}
                          className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={formState.fixed_on_minute ?? 0}
                          onChange={(e) => setFormState({ ...formState, fixed_on_minute: parseInt(e.target.value) || 0 })}
                          className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        Фиксированное время выкл (ЧЧ:ММ)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={formState.fixed_off_hour ?? 7}
                          onChange={(e) => setFormState({ ...formState, fixed_off_hour: parseInt(e.target.value) || 0 })}
                          className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={formState.fixed_off_minute ?? 0}
                          onChange={(e) => setFormState({ ...formState, fixed_off_minute: parseInt(e.target.value) || 0 })}
                          className="w-1/2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Hardware Geometry */}
              <div className="pt-4 border-t border-slate-700/60">
                <h2 className="text-base font-semibold text-slate-200 mb-3">Параметры лестницы</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Количество ступеней</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={formState.steps}
                      onChange={(e) => setFormState({ ...formState, steps: parseInt(e.target.value) || 1 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Диодов на ступень</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={formState.pixels_per_step}
                      onChange={(e) => setFormState({ ...formState, pixels_per_step: parseInt(e.target.value) || 1 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Задержка вкл. (мс)</label>
                    <input
                      type="number"
                      value={formState.step_on_time_ms}
                      onChange={(e) => setFormState({ ...formState, step_on_time_ms: parseInt(e.target.value) || 100 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Задержка выкл. (мс)</label>
                    <input
                      type="number"
                      value={formState.step_off_time_ms}
                      onChange={(e) => setFormState({ ...formState, step_off_time_ms: parseInt(e.target.value) || 150 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Удержание (мс)</label>
                    <input
                      type="number"
                      value={formState.hold_time_ms}
                      onChange={(e) => setFormState({ ...formState, hold_time_ms: parseInt(e.target.value) || 4000 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Эффект включения</label>
                    <select
                      value={formState.anim_effect ?? 0}
                      onChange={(e) => setFormState({ ...formState, anim_effect: parseInt(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    >
                      <option value={0}>Классическая волна</option>
                      <option value={1}>Плавный подъем (Fade Wave)</option>
                      <option value={2}>Штора (От центра / к центру)</option>
                      <option value={3}>Метеор (Бегущая комета)</option>
                      <option value={4}>Радужная волна</option>
                      <option value={5}>Огонь / Камин</option>
                      <option value={6}>Бегущий светлячок (Spark Runner)</option>
                      <option value={7}>Гармошка (Схлопывание навстречу)</option>
                      <option value={8}>Цветовой спектр (Cycle Wave)</option>
                      <option value={9}>Звездное небо (Случайные ступени)</option>
                      <option value={10}>Неоновый импульс (Cyber Pulse)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Эффект удержания</label>
                    <select
                      value={formState.hold_effect ?? 0}
                      onChange={(e) => setFormState({ ...formState, hold_effect: parseInt(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    >
                      <option value={0}>Статичный ровный свет</option>
                      <option value={1}>Плавное дыхание (Breathe)</option>
                      <option value={2}>Шиммер (Мерцание звезд)</option>
                      <option value={3}>Радужный перелив</option>
                      <option value={4}>Живая свеча</option>
                      <option value={5}>Северное сияние (Aurora)</option>
                      <option value={6}>Плазма / Лава (Plasma Lava)</option>
                      <option value={7}>Пульс / Сердце (Heartbeat)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Эффект выключения</label>
                    <select
                      value={formState.off_effect ?? 0}
                      onChange={(e) => setFormState({ ...formState, off_effect: parseInt(e.target.value) || 0 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    >
                      <option value={0}>Волна вслед за шагами</option>
                      <option value={1}>Плавное общее затухание</option>
                      <option value={2}>Пошаговый мягкий фейд</option>
                      <option value={3}>Закрытие шторы (К центру)</option>
                      <option value={4}>Растворение (Звездное угасание)</option>
                    </select>
                  </div>
                </div>

                {/* Section: First and Last Step Illumination Controls */}
                <div className="mt-4 pt-4 border-t border-slate-700/60">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-sky-400" />
                      <h3 className="text-sm font-semibold text-slate-200">
                        Подсветка первой и последней ступени
                      </h3>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Отключение крайних ступеней
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                    Настройка независимого включения/отключения первой (#1) и последней (#{formState.steps}) ступени в основных анимациях и в ночном дежурном режиме.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* First Step Card */}
                    <div className={`p-3.5 rounded-xl border transition-all ${
                      !(formState.enable_first_step ?? true)
                        ? 'bg-rose-950/20 border-rose-900/50'
                        : 'bg-slate-900/80 border-slate-700/80'
                    }`}>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${
                            !(formState.enable_first_step ?? true) ? 'bg-rose-500' : 'bg-emerald-400'
                          }`} />
                          <span className="text-xs font-semibold text-slate-200">
                            Первая ступень (Снизу, #1)
                          </span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          !(formState.enable_first_step ?? true)
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}>
                          {!(formState.enable_first_step ?? true) ? 'Отключена' : 'Активна'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formState.enable_first_step ?? true}
                            onChange={(e) => setFormState({ ...formState, enable_first_step: e.target.checked })}
                            className="mt-0.5 w-4 h-4 rounded border-slate-700 text-sky-600 focus:ring-0"
                          />
                          <div>
                            <div className="text-xs font-medium text-slate-200">Основная подсветка (анимации)</div>
                            <div className="text-[10px] text-slate-400">Ступень светится при подъеме/спуске</div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!(formState.enable_first_step ?? true)}
                            checked={(formState.enable_first_step ?? true) && (formState.night_first_step ?? true)}
                            onChange={(e) => setFormState({ ...formState, night_first_step: e.target.checked })}
                            className="mt-0.5 w-4 h-4 rounded border-slate-700 text-sky-600 focus:ring-0 disabled:opacity-40"
                          />
                          <div>
                            <div className="text-xs font-medium text-slate-200">Дежурный ночник</div>
                            <div className="text-[10px] text-slate-400">Светится ночью в режиме ожидания</div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Last Step Card */}
                    <div className={`p-3.5 rounded-xl border transition-all ${
                      !(formState.enable_last_step ?? true)
                        ? 'bg-rose-950/20 border-rose-900/50'
                        : 'bg-slate-900/80 border-slate-700/80'
                    }`}>
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${
                            !(formState.enable_last_step ?? true) ? 'bg-rose-500' : 'bg-emerald-400'
                          }`} />
                          <span className="text-xs font-semibold text-slate-200">
                            Последняя ступень (Сверху, #{formState.steps})
                          </span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          !(formState.enable_last_step ?? true)
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}>
                          {!(formState.enable_last_step ?? true) ? 'Отключена' : 'Активна'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formState.enable_last_step ?? true}
                            onChange={(e) => setFormState({ ...formState, enable_last_step: e.target.checked })}
                            className="mt-0.5 w-4 h-4 rounded border-slate-700 text-sky-600 focus:ring-0"
                          />
                          <div>
                            <div className="text-xs font-medium text-slate-200">Основная подсветка (анимации)</div>
                            <div className="text-[10px] text-slate-400">Ступень светится при подъеме/спуске</div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!(formState.enable_last_step ?? true)}
                            checked={(formState.enable_last_step ?? true) && (formState.night_last_step ?? true)}
                            onChange={(e) => setFormState({ ...formState, night_last_step: e.target.checked })}
                            className="mt-0.5 w-4 h-4 rounded border-slate-700 text-sky-600 focus:ring-0 disabled:opacity-40"
                          />
                          <div>
                            <div className="text-xs font-medium text-slate-200">Дежурный ночник</div>
                            <div className="text-[10px] text-slate-400">Светится ночью в режиме ожидания</div>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sensor configuration subsection */}
                <div className="mt-4 pt-4 border-t border-slate-700/60">
                  <h3 className="text-sm font-semibold text-slate-200 mb-2">Настройка сенсоров присутствия</h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Тип подключенных датчиков</label>
                      <select
                        value={formState.sensor_type ?? 0}
                        onChange={(e) => setFormState({ ...formState, sensor_type: parseInt(e.target.value) || 0 })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                      >
                        <option value={0}>👁️ PIR / Оптический (цифровой вход HIGH/LOW)</option>
                        <option value={1}>📡 Ультразвуковой дальномер HC-SR04 (см)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">GPIO ленты WS2812 (DIN)</label>
                      <input
                        type="number"
                        value={formState.led_gpio}
                        onChange={(e) => setFormState({ ...formState, led_gpio: parseInt(e.target.value) || 4 })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                      />
                    </div>
                  </div>

                  {formState.sensor_type === 1 ? (
                    <div className="p-4 bg-sky-950/40 border border-sky-800/50 rounded-xl space-y-4 mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Radar className="w-4 h-4 text-sky-400" />
                          <span className="text-xs font-semibold text-sky-200">
                            Параметры ультразвуковых датчиков HC-SR04
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-sky-300 bg-sky-900/60 px-2 py-0.5 rounded border border-sky-700/50">
                          Порог: {formState.ultrasonic_trigger_distance_cm ?? 80} см
                        </span>
                      </div>

                      {/* Distance threshold slider and number input */}
                      <div className="bg-slate-900/80 p-3.5 rounded-lg border border-sky-900/40 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                            <Gauge className="w-3.5 h-3.5 text-sky-400" />
                            <span>Пороговое расстояние срабатывания (см):</span>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="10"
                              max="300"
                              value={formState.ultrasonic_trigger_distance_cm ?? 80}
                              onChange={(e) => {
                                const val = Math.max(10, Math.min(300, parseInt(e.target.value) || 80));
                                setFormState({ ...formState, ultrasonic_trigger_distance_cm: val });
                              }}
                              className="w-20 bg-slate-950 border border-sky-700 rounded px-2 py-1 text-xs text-sky-200 font-mono text-right"
                            />
                            <span className="text-xs text-slate-400">см</span>
                          </div>
                        </div>

                        {/* Interactive Range Slider */}
                        <div className="space-y-1">
                          <input
                            type="range"
                            min="10"
                            max="300"
                            step="5"
                            value={formState.ultrasonic_trigger_distance_cm ?? 80}
                            onChange={(e) => setFormState({
                              ...formState,
                              ultrasonic_trigger_distance_cm: parseInt(e.target.value) || 80
                            })}
                            className="w-full accent-sky-500 cursor-pointer"
                          />
                          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                            <span>10 см (вплотную)</span>
                            <span>100 см (1 метр)</span>
                            <span>200 см</span>
                            <span>300 см (макс)</span>
                          </div>
                        </div>

                        {/* Visual Range Indicator Bar */}
                        <div className="space-y-1 pt-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-emerald-400 font-medium">
                              🟢 Зона срабатывания (&le; {formState.ultrasonic_trigger_distance_cm ?? 80} см)
                            </span>
                            <span className="text-slate-500">
                              ⚪ Игнорирование (&gt; {formState.ultrasonic_trigger_distance_cm ?? 80} см)
                            </span>
                          </div>
                          <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 flex">
                            <div
                              style={{ width: `${Math.min(100, ((formState.ultrasonic_trigger_distance_cm ?? 80) / 300) * 100)}%` }}
                              className="h-full bg-gradient-to-r from-emerald-500 via-sky-500 to-sky-400 transition-all duration-150"
                            />
                            <div className="flex-1 bg-slate-800/60" />
                          </div>
                          <div className="text-[10px] text-slate-400 leading-relaxed">
                            💡 Подсветка лестницы считается сработавшей и начнет плавное включение, когда дальномер зафиксирует приближение человека на расстояние <strong>{formState.ultrasonic_trigger_distance_cm ?? 80} см</strong> или ближе.
                          </div>
                        </div>

                        {/* Presets */}
                        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-slate-400 mr-1">Быстрые пресеты:</span>
                          {[
                            { label: '40 см (Близко)', val: 40 },
                            { label: '80 см (Стандарт)', val: 80 },
                            { label: '120 см (Комфорт)', val: 120 },
                            { label: '180 см (Дальний)', val: 180 },
                          ].map((p) => (
                            <button
                              key={p.val}
                              type="button"
                              onClick={() => setFormState({ ...formState, ultrasonic_trigger_distance_cm: p.val })}
                              className={`px-2.5 py-1 rounded text-xs transition-all ${
                                (formState.ultrasonic_trigger_distance_cm ?? 80) === p.val
                                  ? 'bg-sky-600 text-white font-semibold'
                                  : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* GPIO TRIG / ECHO Pin Assignments */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1">Нижний: GPIO TRIG (Запуск)</label>
                          <input
                            type="number"
                            value={formState.sensor_bottom_gpio}
                            onChange={(e) => setFormState({ ...formState, sensor_bottom_gpio: parseInt(e.target.value) || 23 })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1">Нижний: GPIO ECHO (Отклик)</label>
                          <input
                            type="number"
                            value={formState.sensor_bottom_echo_gpio ?? 18}
                            onChange={(e) => setFormState({ ...formState, sensor_bottom_echo_gpio: parseInt(e.target.value) || 18 })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1">Верхний: GPIO TRIG (Запуск)</label>
                          <input
                            type="number"
                            value={formState.sensor_top_gpio}
                            onChange={(e) => setFormState({ ...formState, sensor_top_gpio: parseInt(e.target.value) || 22 })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1">Верхний: GPIO ECHO (Отклик)</label>
                          <input
                            type="number"
                            value={formState.sensor_top_echo_gpio ?? 19}
                            onChange={(e) => setFormState({ ...formState, sensor_top_echo_gpio: parseInt(e.target.value) || 19 })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                          />
                        </div>
                      </div>

                      {/* Max distance filter */}
                      <div className="pt-2 border-t border-sky-900/40">
                        <label className="block text-xs font-medium text-slate-400 mb-1">Максимальная дистанция эхолокации (см)</label>
                        <input
                          type="number"
                          min="50"
                          max="400"
                          value={formState.ultrasonic_max_distance_cm ?? 200}
                          onChange={(e) => setFormState({ ...formState, ultrasonic_max_distance_cm: parseInt(e.target.value) || 200 })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                        <span className="text-[10px] text-slate-500">Ограничение дальности эхолокации (200 см) отсекает эхо стен и шумы</span>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">GPIO нижнего PIR датчика</label>
                        <input
                          type="number"
                          value={formState.sensor_bottom_gpio}
                          onChange={(e) => setFormState({ ...formState, sensor_bottom_gpio: parseInt(e.target.value) || 23 })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">GPIO верхнего PIR датчика</label>
                        <input
                          type="number"
                          value={formState.sensor_top_gpio}
                          onChange={(e) => setFormState({ ...formState, sensor_top_gpio: parseInt(e.target.value) || 22 })}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                        />
                      </div>
                    </div>
                  )}

                  {/* Manual Sensor State Reset Card in Settings */}
                  <div className="p-4 bg-slate-900/90 border border-amber-900/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Ручной сброс состояния датчиков движения</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed max-w-lg">
                        Мгновенно сбрасывает аппаратные защелки, триггеры и фильтры сенсоров (HC-SR04 / PIR) в исходное состояние ожидания (IDLE), устраняя залипания и ложные срабатывания.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleManualResetSensors}
                      disabled={isResettingSensors}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg text-xs flex items-center gap-2 shrink-0 transition-all active:scale-95 shadow-md disabled:opacity-60"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isResettingSensors ? 'animate-spin' : ''}`} />
                      <span>{isResettingSensors ? 'Сброс...' : 'Сбросить состояние датчиков'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full mt-4 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
              >
                <Save className="w-4 h-4" />
                <span>💾 Сохранить настройки в NVS ESP32</span>
              </button>
            </form>
          )}

          {/* Tab 3: Wi-Fi Form */}
          {activeTab === 'wifi' && (
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4">
              <h2 className="text-base font-semibold text-slate-200">Подключение к сети Wi-Fi</h2>
              <p className="text-xs text-slate-400">
                При подключении к Wi-Fi роутеру плата автоматически связывается с серверами точного времени (NTP pool) и рассчитывает момент захода солнца.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Имя сети (SSID)</label>
                <input
                  type="text"
                  placeholder="Ваш домашний Wi-Fi"
                  value={formState.wifi_ssid}
                  onChange={(e) => setFormState({ ...formState, wifi_ssid: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Пароль</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={formState.wifi_password || ''}
                  onChange={(e) => setFormState({ ...formState, wifi_password: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Имя устройства в сети (mDNS hostname)</label>
                <input
                  type="text"
                  value={formState.hostname}
                  onChange={(e) => setFormState({ ...formState, hostname: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleSendWifiDirect}
                  disabled={isSendingWifiDirect}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                >
                  <Wifi className="w-4 h-4" />
                  <span>{isSendingWifiDirect ? 'Отправка на ESP32...' : '🚀 Отправить на ESP32 (AJAX без ошибок Header)'}</span>
                </button>

                {wifiDirectResult && (
                  <div className="p-3 bg-emerald-950/70 border border-emerald-800 rounded-lg text-xs text-emerald-300 text-center animate-fade-in">
                    {wifiDirectResult}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onUpdateSettings(formState);
                    setSaveToast('Wi-Fi настройки сохранены в профиле!');
                  }}
                  className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-xs flex items-center justify-center gap-2 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Сохранить в локальном симуляторе</span>
                </button>
              </div>

              {/* Troubleshooting Card for 'Header fields are too long' */}
              <div className="mt-6 pt-5 border-t border-slate-700/80 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Решение ошибки &quot;header fields are too long&quot; на компьютере:</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Настольный Chrome/Edge на Windows отправляет более 700 байт служебных заголовков. Чтобы передать настройки в ESP32 со 100% гарантией в обход этой ошибки, выберите удобный вариант:
                </p>

                {/* Option 1: One-click PowerShell / CMD command */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-sky-400" />
                      <span>1. Команда для PowerShell / CMD (Windows):</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyWifiCurl}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                    >
                      {copiedWifiCmd ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Скопировано!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Скопировать команду</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="p-2 bg-slate-950 border border-slate-800/80 rounded-lg text-emerald-300 text-[11px] font-mono select-all overflow-x-auto whitespace-pre">
                    curl.exe -X POST &quot;http://192.168.4.1/wifi&quot; -d &quot;ssid={encodeURIComponent(formState.wifi_ssid || '')}&amp;pass={encodeURIComponent(formState.wifi_password || '')}&amp;hostname={encodeURIComponent(formState.hostname || 'esp-stairs')}&quot;
                  </div>
                  <div className="text-[10px] text-slate-500">
                    * Встроенная утилита curl.exe есть во всех версиях Windows 10 и 11. Отправляет всего 70 байт заголовков.
                  </div>
                </div>

                {/* Option 2: Download save_wifi.bat */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5 text-indigo-400" />
                      <span>2. Файл save_wifi.bat в 1 клик</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Скачайте файл и запустите его двойным щелчком на ПК (будучи подключенным к ESP-Stairs-AP).
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadWifiBat}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать save_wifi.bat</span>
                  </button>
                </div>

                {/* Option 3: Phone */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-[11px] text-slate-400">
                  <strong className="text-slate-300">3. Либо сохраните со смартфона:</strong> подключитесь к Wi-Fi сети <code>ESP-Stairs-AP</code> с телефона и откройте <code>http://192.168.4.1/wifi</code>. Мобильный браузер шлет заголовки в 3 раза меньше, поэтому сохранение сработает мгновенно.
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: OTA Firmware Update */}
          {activeTab === 'ota' && (
            <div className="space-y-6">
              {/* Flash Partition State Card */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 shadow-lg">
                <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center justify-between">
                  <span>Схема Flash разделов ESP32 (Dual OTA)</span>
                  <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full">
                    Версия: {currentFwVersion}
                  </span>
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-3">
                  <div className={`p-3 rounded-lg border ${
                    activePartition === 'ota_0'
                      ? 'bg-emerald-950/40 border-emerald-700 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}>
                    <div className="font-semibold flex items-center justify-between mb-1">
                      <span>Слот 1: ota_0 (0x20000)</span>
                      {activePartition === 'ota_0' && <span className="text-[10px] bg-emerald-800 px-1.5 py-0.2 rounded text-white font-mono">АКТИВЕН</span>}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Размер: 1920 KB • Текущая работающая прошивка
                    </p>
                  </div>

                  <div className={`p-3 rounded-lg border ${
                    activePartition === 'ota_1'
                      ? 'bg-emerald-950/40 border-emerald-700 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}>
                    <div className="font-semibold flex items-center justify-between mb-1">
                      <span>Слот 2: ota_1 (0x200000)</span>
                      {activePartition === 'ota_1' ? (
                        <span className="text-[10px] bg-emerald-800 px-1.5 py-0.2 rounded text-white font-mono">АКТИВЕН</span>
                      ) : (
                        <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800 px-1.5 py-0.2 rounded font-mono">ЦЕЛЬ ДЛЯ OTA</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Размер: 1920 KB • Пассивный слот для новой прошивки
                    </p>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 leading-relaxed">
                  При обновлении прошивки файл записывается в неактивный раздел. Если контроллер успешно стартует с новой версии, раздел помечается как постоянный. В случае сбоя ESP-IDF автоматически откатывается на предыдущий рабочий раздел!
                </div>
              </div>

              {/* GitHub Releases Direct Online Update */}
              <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-sky-950 text-sky-400 border border-sky-800 rounded-lg">
                      <Github className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        <span>Обновление из GitHub Releases</span>
                        <span className="text-[10px] font-normal bg-sky-950 text-sky-300 border border-sky-800 px-2 py-0.5 rounded-full font-mono">
                          {deviceReleases.length > 0 ? `${deviceReleases.length} релизов` : 'Онлайн'}
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Проверка версий и выбор релиза для установки на ESP32 без проводов
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={fetchDeviceReleases}
                    disabled={isLoadingReleases}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingReleases ? 'animate-spin' : ''}`} />
                    <span>{isLoadingReleases ? 'Проверка...' : 'Проверить версии'}</span>
                  </button>
                </div>

                {releaseCheckError && (
                  <div className="p-2.5 bg-amber-950/40 border border-amber-800 text-amber-300 rounded-lg text-xs">
                    {releaseCheckError}
                  </div>
                )}

                {/* Version comparison row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs">
                  <div>
                    <div className="text-slate-400 text-[11px]">Текущая версия на чипе:</div>
                    <div className="font-mono font-bold text-slate-200 mt-0.5">{currentFwVersion}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Выбранная версия:</div>
                    <div className="font-mono font-bold text-sky-400 mt-0.5">{selectedReleaseTag}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Статус обновления:</div>
                    <div className="mt-0.5 font-medium">
                      {deviceReleases.length > 0 && deviceReleases[0].tag_name !== currentFwVersion ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5" /> Доступна новая версия!
                        </span>
                      ) : (
                        <span className="text-slate-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Версия актуальна
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Release selector */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">
                    Выберите какую версию установить:
                  </label>
                  {deviceReleases.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                      {deviceReleases.map((rel) => {
                        const isSelected = selectedReleaseTag === rel.tag_name;
                        return (
                          <div
                            key={rel.id}
                            onClick={() => setSelectedReleaseTag(rel.tag_name)}
                            className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-sky-950/80 border-sky-500 text-sky-100 ring-1 ring-sky-500'
                                : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="font-mono font-bold text-sky-300 flex items-center gap-1">
                                <Tag className="w-3 h-3 text-sky-400" />
                                {rel.tag_name}
                              </span>
                              {rel.tag_name === 'latest' && (
                                <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1 rounded">
                                  LATEST
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {rel.name || rel.tag_name}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-400">
                      Релизы загружаются или доступен релиз 'latest'.
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-end">
                    <button
                      type="button"
                      disabled={otaUploading}
                      onClick={() => handleInstallRelease(selectedReleaseTag)}
                      className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{otaUploading ? 'Установка...' : `Установить версию ${selectedReleaseTag} на ESP32`}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Upload Firmware Card */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4">
                <h2 className="text-sm font-semibold text-slate-200">
                  Загрузка бинарного файла (.bin)
                </h2>

                <div className="border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-xl p-6 text-center transition-colors">
                  <input
                    type="file"
                    accept=".bin"
                    id="esp-ota-file-input"
                    className="hidden"
                    onChange={(e) => setOtaFile(e.target.files?.[0] || null)}
                  />
                  <label htmlFor="esp-ota-file-input" className="cursor-pointer block space-y-2">
                    <div className="w-10 h-10 mx-auto rounded-full bg-sky-950/70 text-sky-400 border border-sky-800 flex items-center justify-center">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="text-xs font-semibold text-slate-200">
                      {otaFile ? otaFile.name : 'Нажмите для выбора бинарника прошивки (.bin)'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {otaFile
                        ? `${(otaFile.size / 1024).toFixed(1)} KB • Готов к прошивке`
                        : 'Поддерживаются файлы компиляции ESP-IDF (ESP_lestn_v2.bin)'}
                    </div>
                  </label>
                </div>

                <button
                  type="button"
                  disabled={otaUploading}
                  onClick={() => {
                    setOtaUploading(true);
                    setOtaProgress(0);
                    setOtaSuccess(false);

                    let p = 0;
                    const interval = setInterval(() => {
                      p += 20;
                      if (p <= 100) {
                        setOtaProgress(p);
                      } else {
                        clearInterval(interval);
                        setOtaUploading(false);
                        setOtaSuccess(true);
                        setOtaFile(null);

                        // Start simulated restart
                        let countdown = 6;
                        setOtaRebootTimer(countdown);
                        const restartTimer = setInterval(() => {
                          countdown--;
                          if (countdown <= 0) {
                            clearInterval(restartTimer);
                            setOtaRebootTimer(null);
                            setActivePartition((prev) => (prev === 'ota_0' ? 'ota_1' : 'ota_0'));
                            setSaveToast('ESP32 успешно перезагружен в новый OTA раздел!');
                          } else {
                            setOtaRebootTimer(countdown);
                          }
                        }, 1000);
                      }
                    }, 400);
                  }}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {otaUploading ? 'Запись во Flash память...' : 'Прошить ESP32 по воздуху (POST /api/ota)'}
                  </span>
                </button>

                {otaUploading && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-300 font-mono">
                      <span>Передача прошивки в ESP32...</span>
                      <span className="text-sky-400 font-bold">{otaProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-all duration-300"
                        style={{ width: `${otaProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {otaRebootTimer !== null && (
                  <div className="p-3 bg-emerald-950/80 border border-emerald-700 text-emerald-300 rounded-xl text-xs flex items-center gap-2 animate-pulse">
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>
                      Прошивка записана! ESP32 перезагружается... Ожидание: <strong>{otaRebootTimer} сек</strong>
                    </span>
                  </div>
                )}

                {otaSuccess && otaRebootTimer === null && (
                  <div className="p-3 bg-emerald-950/60 border border-emerald-700 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      Обновление завершено! Контроллер успешно работает на обновленной прошивке.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
