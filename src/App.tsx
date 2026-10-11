import React, { useState } from 'react';
import { StaircaseSettings } from './types';
import { StaircaseVisualizer } from './components/StaircaseVisualizer';
import { DeviceWebInterface } from './components/DeviceWebInterface';
import { FirmwareExplorer } from './components/FirmwareExplorer';
import { WiringGuide } from './components/WiringGuide';
import { AuditReport } from './components/AuditReport';
import { FirmwareBuildAndFlash } from './components/FirmwareBuildAndFlash';
import { 
  Sparkles, 
  Layers, 
  Globe, 
  FileCode, 
  Cable, 
  ShieldCheck, 
  Zap, 
  CheckCircle2,
  Flame,
  Cpu
} from 'lucide-react';

const DEFAULT_SETTINGS: StaircaseSettings = {
  wifi_ssid: 'Home_WiFi_2.4G',
  wifi_password: 'secretpassword123',
  hostname: 'esp-lestn',

  led_gpio: 4,
  sensor_bottom_gpio: 23,
  sensor_top_gpio: 22,

  steps: 18,
  pixels_per_step: 1,

  brightness: 90,
  night_brightness: 20,

  color_r: 255,
  color_g: 220,
  color_b: 150,

  night_color_r: 255,
  night_color_g: 140,
  night_color_b: 30,

  anim_effect: 0,
  hold_effect: 0,
  off_effect: 0,

  step_on_time_ms: 120,
  step_off_time_ms: 180,
  hold_time_ms: 4000,
  fade_duration_ms: 30,

  night_mode: true,
  night_mode_type: 0,
  reverse_direction: false,
  sensor_active_high: true,
  sensor_debounce_ms: 60,

  // Sensor Type & Ultrasonic HC-SR04
  sensor_type: 0, // 0 = PIR/Optical, 1 = HC-SR04 Ultrasonic
  sensor_bottom_echo_gpio: 18, // Bottom ECHO pin (TRIG uses sensor_bottom_gpio = 23)
  sensor_top_echo_gpio: 19,    // Top ECHO pin (TRIG uses sensor_top_gpio = 22)
  ultrasonic_trigger_distance_cm: 80, // Срабатывать если человек ближе 80 см
  ultrasonic_max_distance_cm: 200,

  // Internet Time & Astro Solar Schedule
  ntp_enabled: true,
  ntp_server: 'pool.ntp.org',
  timezone_offset: 3,
  latitude: 55.7558,
  longitude: 37.6173,
  schedule_mode: 0,
  sunset_offset_min: 0,
  sunrise_offset_min: 0,
  fixed_on_hour: 22,
  fixed_on_minute: 0,
  fixed_off_hour: 7,
  fixed_off_minute: 0,
};

export function App() {
  const [settings, setSettings] = useState<StaircaseSettings>(DEFAULT_SETTINGS);
  const [activeView, setActiveView] = useState<
    'simulator' | 'web' | 'flash' | 'code' | 'wiring' | 'audit'
  >('flash');

  const handleUpdateSettings = (newSettings: Partial<StaircaseSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-500/30">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-sky-500 to-indigo-500 rounded-xl text-white shadow-lg shadow-sky-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>ESP_lestn_v2</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                  v2.0 • Исправлено и доработано
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Контроллер умной светодиодной подсветки лестницы (ESP32 + WS2812)
              </p>
            </div>
          </div>

          {/* Telemetry Chips */}
          <div className="hidden sm:flex items-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              Ступеней: <strong className="text-sky-400">{settings.steps}</strong> ({settings.steps * settings.pixels_per_step} LEDs)
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              LED: <strong className="text-amber-400">GPIO {settings.led_gpio}</strong>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              PIR: <strong className="text-emerald-400">{settings.sensor_bottom_gpio} / {settings.sensor_top_gpio}</strong>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800">
          <button
            id="tab-flash"
            onClick={() => setActiveView('flash')}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeView === 'flash'
                ? 'bg-gradient-to-r from-sky-600 via-indigo-600 to-purple-600 text-white shadow-lg shadow-sky-900/40 ring-1 ring-sky-400/40'
                : 'bg-slate-900 hover:bg-slate-800 text-sky-400 border border-slate-800'
            }`}
          >
            <Flame className="w-4 h-4 text-amber-400 animate-pulse" />
            <span>Сборка и прошивка ESP32</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
              CI/CD & OTA
            </span>
          </button>

          <button
            id="tab-simulator"
            onClick={() => setActiveView('simulator')}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeView === 'simulator'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/30'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Интерактивный симулятор 2.5D</span>
          </button>

          <button
            id="tab-web"
            onClick={() => setActiveView('web')}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeView === 'web'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/30'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Веб-портал ESP32 (HTTP Server)</span>
          </button>

          <button
            id="tab-code"
            onClick={() => setActiveView('code')}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeView === 'code'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/30'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Исходный код и экспорт (.ZIP)</span>
          </button>

          <button
            id="tab-wiring"
            onClick={() => setActiveView('wiring')}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeView === 'wiring'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/30'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Cable className="w-4 h-4" />
            <span>Схема подключения и БП</span>
          </button>

          <button
            id="tab-audit"
            onClick={() => setActiveView('audit')}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              activeView === 'audit'
                ? 'bg-sky-600 text-white shadow-lg shadow-sky-900/30'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Отчет об аудите (7 исправлений)</span>
          </button>
        </div>

        {/* View Switcher */}
        {activeView === 'flash' && (
          <FirmwareBuildAndFlash settings={settings} />
        )}

        {activeView === 'simulator' && (
          <StaircaseVisualizer
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {activeView === 'web' && (
          <DeviceWebInterface
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {activeView === 'code' && <FirmwareExplorer />}

        {activeView === 'wiring' && <WiringGuide settings={settings} />}

        {activeView === 'audit' && <AuditReport />}
      </main>
    </div>
  );
}
export default App;
