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
  MapPin
} from 'lucide-react';

interface DeviceWebInterfaceProps {
  settings: StaircaseSettings;
  onUpdateSettings: (newSettings: Partial<StaircaseSettings>) => void;
}

export const DeviceWebInterface: React.FC<DeviceWebInterfaceProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'control' | 'settings' | 'wifi'>('control');
  const [formState, setFormState] = useState<StaircaseSettings>(settings);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
                <h2 className="text-base font-semibold text-slate-200 mb-3">Состояние лестницы</h2>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700/60">
                    <div className="text-xs text-slate-400">Нижний датчик (GPIO {settings.sensor_bottom_gpio})</div>
                    <div className="text-sm font-semibold text-emerald-400 mt-1">ГОТОВ / ОЖИДАНИЕ</div>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700/60">
                    <div className="text-xs text-slate-400">Верхний датчик (GPIO {settings.sensor_top_gpio})</div>
                    <div className="text-sm font-semibold text-emerald-400 mt-1">ГОТОВ / ОЖИДАНИЕ</div>
                  </div>
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
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">GPIO ленты WS2812</label>
                    <input
                      type="number"
                      value={formState.led_gpio}
                      onChange={(e) => setFormState({ ...formState, led_gpio: parseInt(e.target.value) || 4 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">GPIO нижнего датчика</label>
                    <input
                      type="number"
                      value={formState.sensor_bottom_gpio}
                      onChange={(e) => setFormState({ ...formState, sensor_bottom_gpio: parseInt(e.target.value) || 23 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">GPIO верхнего датчика</label>
                    <input
                      type="number"
                      value={formState.sensor_top_gpio}
                      onChange={(e) => setFormState({ ...formState, sensor_top_gpio: parseInt(e.target.value) || 22 })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                    />
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

              <button
                type="button"
                onClick={() => {
                  onUpdateSettings(formState);
                  setSaveToast('Wi-Fi настройки сохранены! Плата перезагрузится.');
                }}
                className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
              >
                <Wifi className="w-4 h-4" />
                <span>💾 Сохранить Wi-Fi и перезагрузить</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
