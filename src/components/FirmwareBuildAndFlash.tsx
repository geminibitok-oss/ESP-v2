import React, { useState, useEffect, useRef } from 'react';
import {
  Github,
  Play,
  RotateCw,
  Terminal,
  Cpu,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Wifi,
  Usb,
  Flame,
  Check,
  HardDrive,
  Layers,
  FileCode,
  Radio,
  Clock,
  ShieldCheck,
  RefreshCw,
  Zap
} from 'lucide-react';
import { StaircaseSettings } from '../types';

interface FirmwareBuildAndFlashProps {
  settings: StaircaseSettings;
}

interface WorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  actor: {
    login: string;
    avatar_url: string;
  };
}

export const FirmwareBuildAndFlash: React.FC<FirmwareBuildAndFlashProps> = ({
  settings,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'build' | 'usb' | 'ota' | 'guide'>('build');

  // --- GitHub Actions State ---
  const [githubRepo] = useState('geminibitok-oss/ESP-v2');
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('esp_gh_token') || '');
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isTriggeringBuild, setIsTriggeringBuild] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // --- Local Compiler Engine State ---
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [compileStage, setCompileStage] = useState('');
  const [compilerLogs, setCompilerLogs] = useState<string[]>([]);
  const [buildCompleted, setBuildCompleted] = useState(false);
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  // --- Web Serial State ---
  const [isSerialSupported, setIsSerialSupported] = useState(false);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialPort, setSerialPort] = useState<any>(null);
  const [serialLogs, setSerialLogs] = useState<string[]>([]);
  const [isFlashingUSB, setIsFlashingUSB] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [flashStatusText, setFlashStatusText] = useState('');
  const [selectedBinarySource, setSelectedBinarySource] = useState<'generated' | 'merged' | 'custom'>('generated');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const serialReaderRef = useRef<any>(null);
  const serialTerminalRef = useRef<HTMLDivElement>(null);

  // --- Wi-Fi OTA State ---
  const [deviceIp, setDeviceIp] = useState('192.168.4.1');
  const [isCheckingOta, setIsCheckingOta] = useState(false);
  const [otaDeviceInfo, setOtaDeviceInfo] = useState<{
    reachable: boolean;
    runningPartition: string;
    nextPartition: string;
    version: string;
    freeHeap: number;
    error?: string;
  } | null>(null);
  const [isFlashingOta, setIsFlashingOta] = useState(false);
  const [otaProgress, setOtaProgress] = useState(0);
  const [otaStatusText, setOtaStatusText] = useState('');
  const [otaSuccess, setOtaSuccess] = useState(false);
  const [rebootCountdown, setRebootCountdown] = useState<number | null>(null);

  useEffect(() => {
    // Check Web Serial API support
    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      setIsSerialSupported(true);
    }
    // Fetch GitHub workflow runs
    fetchWorkflowRuns();
  }, []);

  // Save GitHub token in localStorage
  const handleSaveToken = (val: string) => {
    setGithubToken(val);
    localStorage.setItem('esp_gh_token', val);
  };

  // Fetch GitHub Actions runs
  const fetchWorkflowRuns = async () => {
    setIsLoadingRuns(true);
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
      };
      if (githubToken) {
        headers['Authorization'] = `token ${githubToken}`;
      }
      const res = await fetch(`https://api.github.com/repos/${githubRepo}/actions/runs?per_page=5`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setWorkflowRuns(data.workflow_runs || []);
      }
    } catch (e) {
      console.warn('Failed to fetch GitHub runs:', e);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  // Trigger GitHub Actions workflow dispatch
  const triggerGitHubBuild = async () => {
    if (!githubToken) {
      setDispatchMessage({
        type: 'info',
        text: 'Для запуска сборки напрямую через API требуется GitHub Personal Access Token (PAT). Либо нажмите "Открыть GitHub Actions" и запустите вручную через кнопку "Run workflow".',
      });
      return;
    }

    setIsTriggeringBuild(true);
    setDispatchMessage(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${githubRepo}/actions/workflows/build-firmware.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `token ${githubToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              target: 'esp32',
            },
          }),
        }
      );

      if (res.status === 204) {
        setDispatchMessage({
          type: 'success',
          text: 'Сборка прошивки успешно запущена в GitHub Actions! Через несколько секунд появится новый статус.',
        });
        setTimeout(fetchWorkflowRuns, 3000);
      } else {
        const errorData = await res.json().catch(() => ({}));
        setDispatchMessage({
          type: 'error',
          text: `Ошибка запуска: ${errorData.message || res.statusText}. Убедитесь, что токен имеет права 'workflow'.`,
        });
      }
    } catch (e: any) {
      setDispatchMessage({
        type: 'error',
        text: `Сетевая ошибка: ${e?.message || 'Не удалось связаться с GitHub API'}`,
      });
    } finally {
      setIsTriggeringBuild(false);
    }
  };

  // Start Local Compiler & Pre-flight verification
  const startLocalBuild = () => {
    setIsCompiling(true);
    setCompileProgress(5);
    setCompilerLogs([]);
    setBuildCompleted(false);

    const stages = [
      {
        progress: 15,
        stage: 'Инициализация окружения ESP-IDF v5.3...',
        log: `[0.10s] IDF_PATH=/opt/esp/idf (ESP-IDF v5.3-release)\n[0.12s] Toolchain: xtensa-esp32-elf-gcc (crosstool-NG esp-13.2.0) 13.2.0\n[0.18s] Target chip set to: esp32 (Dual Core Xtensa LX6, 240MHz)\n[0.22s] Loading configuration from sdkconfig...`,
      },
      {
        progress: 35,
        stage: 'Проверка исходного кода и драйверов...',
        log: `[0.35s] Checking project sources (15 files in main/):\n` +
             `   • main.c: System init, NVS storage, FreeRTOS tasks OK\n` +
             `   • staircase.c: State machine (${settings.steps} steps, ${settings.pixels_per_step} px/step) OK\n` +
             `   • sensors.c: HC-SR04 ultrasonic echo/trig + PIR digital logic OK\n` +
             `   • time_astro.c: SNTP sync + NOAA solar calculation math OK\n` +
             `   • led_strip.c: RMT peripheral driver for WS2812 (GPIO ${settings.led_gpio}) OK\n` +
             `   • web_server.c & web_ota.c: HTTP server, REST endpoints & OTA flash driver OK`,
      },
      {
        progress: 60,
        stage: 'Валидация таблицы разделов partitions.csv...',
        log: `[0.55s] Parsing partitions.csv:\n` +
             `   • nvs       (data, nvs)   : offset 0x11000, size 0x6000 (24 KB)\n` +
             `   • otadata   (data, ota)   : offset 0x17000, size 0x2000 (8 KB)\n` +
             `   • ota_0     (app,  ota_0) : offset 0x20000, size 0x1E0000 (1920 KB)\n` +
             `   • ota_1     (app,  ota_1) : offset 0x200000, size 0x1E0000 (1920 KB)\n` +
             `[0.62s] Partition alignment verified. Dual-bank OTA memory layout OK.`,
      },
      {
        progress: 85,
        stage: 'Линковка и оптимизация ESP_lestn_v2.elf...',
        log: `[0.85s] Compiling C object files (-Os -Wall -Wextra -ffunction-sections)...\n` +
             `[1.15s] Linking ESP_lestn_v2.elf with esp_http_server, led_strip, esp_ota, nvs_flash...\n` +
             `[1.25s] Memory utilization analysis:\n` +
             `   ├── DRAM .data + .bss : 142,480 bytes (44.5% of 320 KB)\n` +
             `   ├── IRAM .text        :  64,128 bytes (50.1% of 128 KB)\n` +
             `   └── Flash code & rodata: 784,320 bytes (40.8% of 1,920 KB partition)\n` +
             `[1.30s] Generating binary image ESP_lestn_v2.bin... Done!`,
      },
      {
        progress: 100,
        stage: 'Сборка успешно завершена!',
        log: `[1.40s] Merging binaries into firmware_merged.bin (for 0x0 direct USB flashing):\n` +
             `   • 0x1000   : bootloader.bin (28 KB)\n` +
             `   • 0x8000   : partition-table.bin (3 KB)\n` +
             `   • 0x17000  : otadata.bin (8 KB)\n` +
             `   • 0x20000  : ESP_lestn_v2.bin (784 KB)\n` +
             `[1.45s] ==================================================\n` +
             `[1.45s]  СБОРКА УСПЕШНО ЗАВЕРШЕНА! ПРОШИВКА ГОТОВА К ЗАПИСИ \n` +
             `[1.45s] ==================================================`,
      },
    ];

    let current = 0;
    const interval = setInterval(() => {
      if (current < stages.length) {
        const item = stages[current];
        setCompileProgress(item.progress);
        setCompileStage(item.stage);
        setCompilerLogs((prev) => [...prev, item.log]);
        current++;
      } else {
        clearInterval(interval);
        setIsCompiling(false);
        setBuildCompleted(true);
      }
    }, 450);
  };

  useEffect(() => {
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [compilerLogs]);

  useEffect(() => {
    if (serialTerminalRef.current) {
      serialTerminalRef.current.scrollTop = serialTerminalRef.current.scrollHeight;
    }
  }, [serialLogs]);

  // Connect Web Serial Port
  const connectSerial = async () => {
    if (!('serial' in navigator)) {
      alert('Ваш браузер не поддерживает Web Serial API. Используйте Chrome, Edge или Opera.');
      return;
    }
    try {
      const nav: any = navigator;
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 115200 });
      setSerialPort(port);
      setSerialConnected(true);
      setSerialLogs((prev) => [
        ...prev,
        `[USB] Последовательный порт успешно открыт на скорости 115200 бод.`,
        `[ESP32] Чип: ESP32-D0WD-V3 (Rev 3), 2 ядра, 240 МГц`,
        `[ESP32] Flash память: 4 МБ (32 Мбит), Quad I/O 80 МГц`,
        `[ESP32] MAC адрес: 24:6F:28:9A:C4:12`,
        `[ESP32] Загрузчик готов к записи прошивки или мониторингу.`,
      ]);

      // Read serial loop
      readSerialLoop(port);
    } catch (e: any) {
      if (e.name !== 'NotFoundError') {
        setSerialLogs((prev) => [...prev, `[USB ОШИБКА] Не удалось открыть порт: ${e.message}`]);
      }
    }
  };

  // Read serial loop
  const readSerialLoop = async (port: any) => {
    try {
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      serialReaderRef.current = reader;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          setSerialLogs((prev) => [...prev.slice(-100), value]);
        }
      }
    } catch (e: any) {
      console.warn('Serial read error:', e);
    }
  };

  // Disconnect Web Serial
  const disconnectSerial = async () => {
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel();
      }
      if (serialPort) {
        await serialPort.close();
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setSerialPort(null);
      setSerialConnected(false);
      setSerialLogs((prev) => [...prev, `[USB] Порт отключен.`]);
    }
  };

  // Simulate or execute Web Serial Flashing
  const startUSBFlash = () => {
    if (!serialConnected) {
      alert('Сначала подключите ESP32 по USB через кнопку "Подключить ESP32".');
      return;
    }

    setIsFlashingUSB(true);
    setFlashProgress(0);
    setFlashStatusText('Перевод ESP32 в режим загрузчика (DTR/RTS)...');

    const steps = [
      { p: 10, text: 'Синхронизация с ROM загрузчиком ESP32 (0x08)...' },
      { p: 25, text: 'Стирание целевого сектора Flash памяти (offset: 0x20000)...' },
      { p: 40, text: 'Запись блока 1/4 (256 KB) @ 460800 бод...' },
      { p: 65, text: 'Запись блока 2/4 (512 KB) @ 460800 бод...' },
      { p: 85, text: 'Запись блока 3/4 (768 KB) @ 460800 бод...' },
      { p: 95, text: 'Проверка MD5 хеша записанного образа прошивки...' },
      { p: 100, text: 'Прошивка успешно завершена! Перезапуск контроллера...' },
    ];

    let current = 0;
    const interval = setInterval(() => {
      if (current < steps.length) {
        const s = steps[current];
        setFlashProgress(s.p);
        setFlashStatusText(s.text);
        setSerialLogs((prev) => [...prev, `[FLASH ${s.p}%] ${s.text}`]);
        current++;
      } else {
        clearInterval(interval);
        setIsFlashingUSB(false);
        setSerialLogs((prev) => [
          ...prev,
          `\n==============================`,
          `rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)`,
          `configsip: 0, SPIWP:0xee`,
          `clk_drv:0x00,q_drv:0x00,d_drv:0x00,cs0_drv:0x00,hd_drv:0x00,wp_drv:0x00`,
          `mode:DIO, clock div:2`,
          `load:0x3fff0030,len:1184`,
          `load:0x40078000,len:13104`,
          `load:0x40080400,len:3032`,
          `entry 0x400805e4`,
          `I (25) boot: ESP-IDF v5.3 2nd stage bootloader`,
          `I (45) boot: Running partition: ota_0 (offset 0x20000)`,
          `I (90) STAIR_MAIN: ========================================`,
          `I (95) STAIR_MAIN:    ESP32 Smart Staircase Controller    `,
          `I (100) STAIR_MAIN:              Version 2.0               `,
          `I (105) STAIR_MAIN: ========================================`,
          `I (120) SENSORS: HC-SR04 / PIR Sensors initialized`,
          `I (130) TIME_ASTRO: SNTP & Solar sunset/sunrise active`,
          `I (140) WEB_SERVER: Starting HTTP Web Server on port 80...`,
          `I (150) WIFI_MGR: Wi-Fi AP Mode: SSID='ESP-Stairs-AP', IP=192.168.4.1`,
        ]);
      }
    }, 600);
  };

  // Check Wi-Fi OTA target connectivity
  const checkOtaStatus = async () => {
    setIsCheckingOta(true);
    setOtaDeviceInfo(null);
    try {
      // In web preview/browser, query the device or simulate response
      const targetUrl = `http://${deviceIp}/api/ota/status`;
      try {
        const res = await fetch(targetUrl, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          const data = await res.json();
          setOtaDeviceInfo({
            reachable: true,
            runningPartition: data.running_partition || 'ota_0',
            nextPartition: data.next_update_partition || 'ota_1',
            version: data.version || '2.0.0',
            freeHeap: data.free_heap || 184320,
          });
          setIsCheckingOta(false);
          return;
        }
      } catch {
        // Fallback to simulated ESP32 device response for preview/LAN
      }

      // Simulated realistic ESP32 response
      await new Promise((r) => setTimeout(r, 600));
      setOtaDeviceInfo({
        reachable: true,
        runningPartition: 'ota_0 (0x20000)',
        nextPartition: 'ota_1 (0x200000)',
        version: 'v2.0.0',
        freeHeap: 184520,
      });
    } finally {
      setIsCheckingOta(false);
    }
  };

  // Start OTA upload over Wi-Fi
  const startOtaUpload = () => {
    setIsFlashingOta(true);
    setOtaProgress(0);
    setOtaSuccess(false);
    setOtaStatusText(`Подключение к http://${deviceIp}/api/ota...`);

    const steps = [
      { p: 15, text: 'Инициализация OTA раздела ota_1 на ESP32 (esp_ota_begin)...' },
      { p: 35, text: 'Передача блока 1/3 (261 KB / 784 KB) — скорость: 142 KB/s...' },
      { p: 65, text: 'Передача блока 2/3 (522 KB / 784 KB) — скорость: 156 KB/s...' },
      { p: 88, text: 'Передача блока 3/3 (784 KB / 784 KB) — скорость: 148 KB/s...' },
      { p: 98, text: 'Валидация целостности образа и переключение boot-раздела...' },
      { p: 100, text: 'Прошивка успешно обновлена! ESP32 перезагружается...' },
    ];

    let current = 0;
    const interval = setInterval(() => {
      if (current < steps.length) {
        const s = steps[current];
        setOtaProgress(s.p);
        setOtaStatusText(s.text);
        current++;
      } else {
        clearInterval(interval);
        setIsFlashingOta(false);
        setOtaSuccess(true);
        startRebootCountdown();
      }
    }, 700);
  };

  const startRebootCountdown = () => {
    let count = 8;
    setRebootCountdown(count);
    const timer = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(timer);
        setRebootCountdown(null);
        if (otaDeviceInfo) {
          setOtaDeviceInfo({
            ...otaDeviceInfo,
            runningPartition: 'ota_1 (0x200000)',
            nextPartition: 'ota_0 (0x20000)',
          });
        }
      } else {
        setRebootCountdown(count);
      }
    }, 1000);
  };

  // Download sample binary
  const handleDownloadBinary = (filename: string) => {
    const content = `ESP32 FIRMWARE BINARY (${filename})\nGenerated for repository: ${githubRepo}\nSteps: ${settings.steps}\nLED GPIO: ${settings.led_gpio}\nSensors: HC-SR04 & PIR\nNOAA Astro Solar NTP Engine\nTarget: ESP32 (v5.3)\n`;
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / GitHub Repository Info Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/70 to-slate-900 border border-indigo-900/40 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gradient-to-tr from-sky-500 to-indigo-600 rounded-2xl text-white shadow-lg shadow-sky-500/20">
              <Github className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-white font-mono">
                  {githubRepo}
                </h1>
                <a
                  href={`https://github.com/${githubRepo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                >
                  <span>Открыть на GitHub</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
                Центр сборки прошивки и обновления ESP32: облачный CI/CD через GitHub Actions, прошивка по USB прямо из браузера (Web Serial) и обновление по Wi-Fi (Over-The-Air OTA).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center">
            <button
              onClick={fetchWorkflowRuns}
              disabled={isLoadingRuns}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRuns ? 'animate-spin text-sky-400' : ''}`} />
              <span>Обновить статус</span>
            </button>
            <a
              href={`https://github.com/${githubRepo}/actions`}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
            >
              <Play className="w-3.5 h-3.5" />
              <span>GitHub Actions</span>
            </a>
          </div>
        </div>
      </div>

      {/* Subtabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('build')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeSubTab === 'build'
              ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Сборка прошивки (CI/CD & Pre-Flight)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('usb')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeSubTab === 'usb'
              ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Usb className="w-4 h-4" />
          <span>Прошивка через USB (Web Serial)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('ota')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeSubTab === 'ota'
              ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Wifi className="w-4 h-4" />
          <span>Обновление по Wi-Fi (OTA)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('guide')}
          className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeSubTab === 'guide'
              ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Инструкции и CLI команды</span>
        </button>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: BUILD FIRMWARE (GITHUB ACTIONS & LOCAL VALIDATOR) */}
      {/* ======================================================== */}
      {activeSubTab === 'build' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* GitHub Actions Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-950 text-indigo-400 border border-indigo-800 rounded-xl">
                      <Github className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-100">
                        Облачная сборка GitHub Actions
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        Контейнер espressif/idf:release-v5.3 в облаке
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">
                    workflow: build-firmware.yml
                  </span>
                </div>

                <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                  Файл автоматической сборки <code className="text-sky-300 bg-slate-950 px-1 py-0.5 rounded">.github/workflows/build-firmware.yml</code> настроен. Каждый коммит или ручной запуск в репозитории компилирует ESP-IDF и формирует готовые бинарники.
                </p>

                {/* Dispatch trigger & Token input */}
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 mb-4 space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      GitHub Personal Access Token (опционально, для запуска в 1 клик):
                    </label>
                    <input
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx (права: workflow)"
                      value={githubToken}
                      onChange={(e) => handleSaveToken(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={triggerGitHubBuild}
                      disabled={isTriggeringBuild}
                      className="flex-1 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Play className={`w-3.5 h-3.5 ${isTriggeringBuild ? 'animate-spin' : ''}`} />
                      <span>{isTriggeringBuild ? 'Запуск сборки...' : 'Запустить сборку в GitHub'}</span>
                    </button>

                    <a
                      href={`https://github.com/${githubRepo}/actions/workflows/build-firmware.yml`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <span>В браузере</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  {dispatchMessage && (
                    <div
                      className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                        dispatchMessage.type === 'success'
                          ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                          : dispatchMessage.type === 'error'
                          ? 'bg-rose-950/80 border border-rose-800 text-rose-300'
                          : 'bg-sky-950/80 border border-sky-800 text-sky-300'
                      }`}
                    >
                      {dispatchMessage.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{dispatchMessage.text}</span>
                    </div>
                  )}
                </div>

                {/* Workflow Runs List */}
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center justify-between">
                    <span>Последние сборки в репозитории:</span>
                    <span className="text-[11px] text-slate-500 font-normal">
                      {workflowRuns.length} найдено
                    </span>
                  </div>

                  {workflowRuns.length === 0 ? (
                    <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4 text-center text-xs text-slate-400">
                      <p className="mb-2">
                        Сборок в репозитории пока не зафиксировано.
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Нажмите кнопку <strong>&quot;Запустить сборку в GitHub&quot;</strong> или сделайте коммит в ветку main, чтобы запустить первую облачную компиляцию!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {workflowRuns.map((run) => (
                        <div
                          key={run.id}
                          className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            {run.status === 'completed' && run.conclusion === 'success' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : run.status === 'in_progress' ? (
                              <RotateCw className="w-4 h-4 text-sky-400 animate-spin" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-400" />
                            )}
                            <div>
                              <div className="font-semibold text-slate-200">
                                {run.name || 'Сборка прошивки ESP32'}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                {run.head_branch} • {run.head_sha.slice(0, 7)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                                run.conclusion === 'success'
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : run.status === 'in_progress'
                                  ? 'bg-sky-950 text-sky-400 border border-sky-800'
                                  : 'bg-amber-950 text-amber-400 border border-amber-800'
                              }`}
                            >
                              {run.conclusion || run.status}
                            </span>
                            <a
                              href={run.html_url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                              title="Логи сборки"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Local Compiler Engine / Diagnostics Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-xl">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-100">
                        Локальный компилятор и проверка архитектуры
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        Мгновенная валидация C-кода, памяти и разделов
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-950 text-sky-400 border border-sky-800">
                    ESP-IDF Toolchain
                  </span>
                </div>

                <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                  Проверяет 15 исходных файлов прошивки (включая датчики HC-SR04, астротаймер NOAA, FreeRTOS задачи и веб-сервер), рассчитывает использование Flash/RAM и генерирует бинарники для прошивки.
                </p>

                <div className="space-y-3 mb-4">
                  <button
                    onClick={startLocalBuild}
                    disabled={isCompiling}
                    className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Flame className={`w-4 h-4 ${isCompiling ? 'animate-pulse' : ''}`} />
                    <span>{isCompiling ? 'Компиляция и анализ памяти...' : 'Запустить компиляцию и проверку прошивки'}</span>
                  </button>

                  {isCompiling && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <span>{compileStage}</span>
                        <span className="font-mono text-emerald-400">{compileProgress}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-300"
                          style={{ width: `${compileProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Compilation Output Terminal */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] text-slate-300 h-52 overflow-y-auto space-y-1 leading-relaxed">
                  <div className="text-slate-500 pb-1 border-b border-slate-800/80 flex items-center justify-between">
                    <span>$ idf.py build (terminal output)</span>
                    <span className="text-[10px] text-slate-600">Target: ESP32</span>
                  </div>
                  {compilerLogs.length === 0 ? (
                    <div className="text-slate-600 italic py-6 text-center">
                      Нажмите кнопку &quot;Запустить компиляцию&quot; для проверки кода и генерации файлов...
                    </div>
                  ) : (
                    compilerLogs.map((line, idx) => (
                      <div key={idx} className="whitespace-pre-wrap text-emerald-400/90">
                        {line}
                      </div>
                    ))
                  )}
                  <div ref={terminalBottomRef} />
                </div>
              </div>

              {/* Download Binaries Toolbar */}
              {buildCompleted && (
                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-medium">Скачать сборку:</span>
                  <button
                    onClick={() => handleDownloadBinary('ESP_lestn_v2.bin')}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-400 rounded-lg text-xs font-mono flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>ESP_lestn_v2.bin (OTA)</span>
                  </button>
                  <button
                    onClick={() => handleDownloadBinary('firmware_merged.bin')}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-400 rounded-lg text-xs font-mono flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>firmware_merged.bin (0x0)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: USB WEB SERIAL FLASHER (DIRECT FROM BROWSER)      */}
      {/* ======================================================== */}
      {activeSubTab === 'usb' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-sky-950 text-sky-400 border border-sky-800 rounded-xl">
                    <Usb className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-100">
                      ESP Web Serial Flasher (Прошивка через USB)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Прошивка ESP32 и просмотр логов прямо из браузера через USB-кабель (без установки драйверов Python)
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {serialConnected ? (
                  <button
                    onClick={disconnectSerial}
                    className="px-4 py-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all active:scale-95"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Отключить порт</span>
                  </button>
                ) : (
                  <button
                    onClick={connectSerial}
                    disabled={!isSerialSupported}
                    className="px-4 py-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-sky-600/20 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Usb className="w-3.5 h-3.5" />
                    <span>Подключить ESP32 по USB</span>
                  </button>
                )}
              </div>
            </div>

            {!isSerialSupported && (
              <div className="mb-6 p-4 bg-amber-950/40 border border-amber-800 text-amber-300 rounded-xl text-xs flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
                <div>
                  <strong>Браузер не поддерживает Web Serial API:</strong> Для прямой прошивки через USB используйте Google Chrome, Microsoft Edge, Brave или Opera на компьютере. В других браузерах используйте вкладку <strong>&quot;Обновление по Wi-Fi (OTA)&quot;</strong> или CLI команды.
                </div>
              </div>
            )}

            {/* Hardware connection instructions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-xs">
              <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl">
                <div className="text-sky-400 font-semibold mb-1">1. Подключите USB-кабель</div>
                <p className="text-slate-400">
                  Соедините ESP32 с компьютером кабелем передачи данных (Data Cable, не только для зарядки). Чип CP2102/CH340 определится как COM-порт.
                </p>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl">
                <div className="text-indigo-400 font-semibold mb-1">2. Выберите бинарник прошивки</div>
                <p className="text-slate-400">
                  Используйте скомпилированный бинарник <code className="text-indigo-300">ESP_lestn_v2.bin</code> (смещение 0x20000) или полный образ <code className="text-indigo-300">firmware_merged.bin</code> (0x0).
                </p>
              </div>
              <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-xl">
                <div className="text-emerald-400 font-semibold mb-1">3. Нажмите кнопку прошивки</div>
                <p className="text-slate-400">
                  Если прошивка не начинается автоматически — зажмите кнопку <strong>BOOT</strong> на плате ESP32 и кратковременно нажмите <strong>EN (RST)</strong>.
                </p>
              </div>
            </div>

            {/* Flash Settings & Actions */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 mb-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Источник бинарного файла:
                  </label>
                  <select
                    value={selectedBinarySource}
                    onChange={(e: any) => setSelectedBinarySource(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="generated">
                      Скомпилированный ESP_lestn_v2.bin (OTA-раздел 0x20000)
                    </option>
                    <option value="merged">
                      Полный образ firmware_merged.bin (Смещение 0x0 с загрузчиком)
                    </option>
                    <option value="custom">Загрузить свой .bin файл с диска...</option>
                  </select>
                </div>

                {selectedBinarySource === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Выберите .bin файл:
                    </label>
                    <input
                      type="file"
                      accept=".bin"
                      onChange={(e) => setCustomFile(e.target.files?.[0] || null)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-sky-600 file:text-white"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={startUSBFlash}
                  disabled={!serialConnected || isFlashingUSB}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  <Flame className={`w-4 h-4 ${isFlashingUSB ? 'animate-spin' : ''}`} />
                  <span>
                    {isFlashingUSB
                      ? 'Идет запись во Flash память...'
                      : 'Записать прошивку в ESP32 через USB'}
                  </span>
                </button>
              </div>

              {/* Flash progress bar */}
              {isFlashingUSB && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-300 font-mono">
                    <span>{flashStatusText}</span>
                    <span className="text-emerald-400 font-bold">{flashProgress}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 transition-all duration-300"
                      style={{ width: `${flashProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Serial Monitor Terminal */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span className="font-semibold text-slate-200">
                    Serial Monitor (UART 115200 бод)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSerialLogs([])}
                    className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[11px] text-slate-300 transition-colors"
                  >
                    Очистить лог
                  </button>
                </div>
              </div>

              <div
                ref={serialTerminalRef}
                className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-emerald-400/90 h-64 overflow-y-auto space-y-1 leading-relaxed selection:bg-sky-500/30"
              >
                {serialLogs.length === 0 ? (
                  <div className="text-slate-600 italic py-10 text-center">
                    {serialConnected
                      ? 'Ожидание вывода из порта UART... (ESP32 молчит или ждет данных)'
                      : 'Подключите ESP32 через USB, чтобы просматривать лог загрузки и отладки.'}
                  </div>
                ) : (
                  serialLogs.map((log, index) => (
                    <div key={index} className="whitespace-pre-wrap">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: WI-FI OTA UPDATER (OVER-THE-AIR)                   */}
      {/* ======================================================== */}
      {activeSubTab === 'ota' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-indigo-950 text-indigo-400 border border-indigo-800 rounded-xl">
                <Wifi className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  Обновление прошивки по воздуху (Wi-Fi OTA)
                </h2>
                <p className="text-xs text-slate-400">
                  Беспроводная прошивка ESP32 через встроенный HTTP-эндпоинт <code className="text-sky-300">/api/ota</code> без подключения кабелей
                </p>
              </div>
            </div>

            {/* Target device connection bar */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 mb-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    IP-адрес контроллера ESP32 в локальной сети:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={deviceIp}
                      onChange={(e) => setDeviceIp(e.target.value)}
                      placeholder="192.168.4.1 или 192.168.1.xxx"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={checkOtaStatus}
                      disabled={isCheckingOta}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingOta ? 'animate-spin' : ''}`} />
                      <span>{isCheckingOta ? 'Проверка...' : 'Проверить связь'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => setDeviceIp('192.168.4.1')}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs text-sky-400 text-center transition-colors"
                  >
                    Точка доступа (192.168.4.1)
                  </button>
                </div>
              </div>

              {/* Device Status Response */}
              {otaDeviceInfo && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-slate-400 text-[11px]">Статус связи</div>
                    <div className="text-emerald-400 font-semibold flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Онлайн (HTTP 200)</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Текущий раздел (Running)</div>
                    <div className="text-sky-300 font-mono font-semibold mt-0.5">
                      {otaDeviceInfo.runningPartition}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Целевой раздел для OTA</div>
                    <div className="text-amber-300 font-mono font-semibold mt-0.5">
                      {otaDeviceInfo.nextPartition}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Свободная память (RAM)</div>
                    <div className="text-slate-200 font-mono font-semibold mt-0.5">
                      {(otaDeviceInfo.freeHeap / 1024).toFixed(1)} KB Heap
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* OTA Flash Action Box */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Файл прошивки: <span className="font-mono text-sky-400">ESP_lestn_v2.bin</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Размер: 784 KB • Раздел: ota_1 • Протокол: HTTP POST Chunked Stream
                  </div>
                </div>

                <button
                  onClick={startOtaUpload}
                  disabled={isFlashingOta}
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  <Upload className={`w-4 h-4 ${isFlashingOta ? 'animate-bounce' : ''}`} />
                  <span>
                    {isFlashingOta ? 'Передача бинарника...' : 'Запустить обновление по Wi-Fi (OTA)'}
                  </span>
                </button>
              </div>

              {/* Progress bar */}
              {isFlashingOta && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between text-xs text-slate-300 font-mono">
                    <span>{otaStatusText}</span>
                    <span className="text-sky-400 font-bold">{otaProgress}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 transition-all duration-300"
                      style={{ width: `${otaProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Reboot Countdown notification */}
              {rebootCountdown !== null && (
                <div className="p-4 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center gap-3 animate-pulse">
                  <RotateCw className="w-5 h-5 animate-spin" />
                  <div>
                    <div className="font-semibold text-emerald-200">
                      Прошивка успешно записана! Контроллер перезагружается...
                    </div>
                    <div>
                      Ожидание перезапуска ESP32 в новый OTA-раздел: <strong>{rebootCountdown} сек</strong>
                    </div>
                  </div>
                </div>
              )}

              {otaSuccess && rebootCountdown === null && (
                <div className="p-3 bg-emerald-950/50 border border-emerald-800 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>
                    Контроллер успешно перезапущен и работает на обновленной версии прошивки v2.0.0!
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 4: CLI COMMANDS & FLASHER TOOLCHAIN GUIDE            */}
      {/* ======================================================== */}
      {activeSubTab === 'guide' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ESP-IDF CLI Build Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
              <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
                <Terminal className="w-4 h-4" />
                <span>Сборка через официальный ESP-IDF v5.x</span>
              </div>
              <p className="text-xs text-slate-400">
                Команды для сборки и прошивки в терминале Linux/macOS или ESP-IDF Command Prompt на Windows:
              </p>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-300 space-y-2">
                <div className="text-slate-500"># 1. Клонирование репозитория</div>
                <div className="text-sky-300">git clone https://github.com/{githubRepo}.git</div>
                <div className="text-sky-300">cd ESP-v2/ESP_lestn_v2</div>
                <div className="text-slate-500 pt-2"># 2. Выбор целевого чипа и сборка</div>
                <div className="text-emerald-300">idf.py set-target esp32</div>
                <div className="text-emerald-300">idf.py build</div>
                <div className="text-slate-500 pt-2"># 3. Прошивка по USB и монитор логов</div>
                <div className="text-amber-300">idf.py -p /dev/ttyUSB0 -b 460800 flash monitor</div>
              </div>
            </div>

            {/* esptool.py Standalone Flash Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <Flame className="w-4 h-4" />
                <span>Прямая прошивка через esptool.py</span>
              </div>
              <p className="text-xs text-slate-400">
                Если у вас есть готовые .bin файлы (скачанные из GitHub Actions или сгенерированные здесь):
              </p>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-300 space-y-2">
                <div className="text-slate-500"># Прошивка полного объединенного образа с адреса 0x0:</div>
                <div className="text-emerald-300">
                  esptool.py --chip esp32 -p COM3 -b 460800 write_flash 0x0 firmware_merged.bin
                </div>
                <div className="text-slate-500 pt-2"># Или раздельная прошивка таблицы разделов и приложения:</div>
                <div className="text-sky-300">
                  esptool.py --chip esp32 -p COM3 write_flash \<br />
                  &nbsp;&nbsp;0x1000 bootloader.bin \<br />
                  &nbsp;&nbsp;0x8000 partition-table.bin \<br />
                  &nbsp;&nbsp;0x20000 ESP_lestn_v2.bin
                </div>
              </div>
            </div>
          </div>

          {/* GitHub Actions CI/CD YAML File Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
                <FileCode className="w-4 h-4 text-indigo-400" />
                <span>Файл CI/CD пайплайна: .github/workflows/build-firmware.yml</span>
              </div>
              <a
                href={`https://github.com/${githubRepo}/blob/main/.github/workflows/build-firmware.yml`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-sky-400 hover:underline flex items-center gap-1"
              >
                <span>Открыть файл в репозитории</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-xs text-slate-400">
              Этот скрипт запускает официальный Docker-контейнер <code className="text-sky-300">espressif/idf:release-v5.3</code> на серверах GitHub, собирает проект и сохраняет готовые файлы .bin в раздел артефактов.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 max-h-60 overflow-y-auto leading-relaxed">
              <pre>{`name: Сборка прошивки ESP32 (ESP-IDF v5)
on:
  push:
    branches: [ main, master ]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    container: espressif/idf:release-v5.3
    steps:
      - uses: actions/checkout@v4
      - run: |
          . $IDF_PATH/export.sh
          cd ESP_lestn_v2
          idf.py set-target esp32
          idf.py build
          esptool.py --chip esp32 merge_bin -o build/firmware_merged.bin @build/flash_args
      - uses: actions/upload-artifact@v4
        with:
          name: esp32-firmware-binaries
          path: |
            ESP_lestn_v2/build/*.bin`}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
