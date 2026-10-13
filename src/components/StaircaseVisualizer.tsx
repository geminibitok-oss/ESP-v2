import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  RotateCcw, 
  Sun, 
  Moon, 
  Sparkles, 
  Footprints,
  Users, 
  Radio, 
  Sliders, 
  Lightbulb, 
  Power,
  Timer,
  Zap,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { StaircaseSettings, StairState } from '../types';

interface StaircaseVisualizerProps {
  settings: StaircaseSettings;
  onUpdateSettings: (newSettings: Partial<StaircaseSettings>) => void;
}

export const StaircaseVisualizer: React.FC<StaircaseVisualizerProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [fsmState, setFsmState] = useState<StairState>('IDLE');
  const [stepStates, setStepStates] = useState<boolean[]>(
    Array(settings.steps).fill(false)
  );
  const [holdRemainingMs, setHoldRemainingMs] = useState<number>(0);
  const [isDayTime, setIsDayTime] = useState<boolean>(false);
  const [bottomSensorActive, setBottomSensorActive] = useState<boolean>(false);
  const [topSensorActive, setTopSensorActive] = useState<boolean>(false);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animTimeoutRef = useRef<NodeJS.Timeout[]>([]);

  // Keep step states array size in sync with settings.steps
  useEffect(() => {
    setStepStates((prev) => {
      const next = Array(settings.steps).fill(false);
      for (let i = 0; i < Math.min(prev.length, settings.steps); i++) {
        next[i] = prev[i];
      }
      return next;
    });
  }, [settings.steps]);

  // Night mode background lighting
  useEffect(() => {
    if (fsmState === 'IDLE') {
      if (settings.night_mode && !isDayTime) {
        setStepStates((prev) => {
          const next = [...prev];
          for (let i = 0; i < settings.steps; i++) {
            const isFirst = i === 0;
            const isLast = i === settings.steps - 1;
            const allowFirst = (settings.enable_first_step ?? true) && (settings.night_first_step ?? true);
            const allowLast = (settings.enable_last_step ?? true) && (settings.night_last_step ?? true);

            if (settings.night_mode_type === 0) {
              if (isFirst) next[i] = allowFirst;
              else if (isLast) next[i] = allowLast;
              else next[i] = false;
            } else {
              if (isFirst) next[i] = allowFirst;
              else if (isLast) next[i] = allowLast;
              else next[i] = true;
            }
          }
          return next;
        });
      } else {
        setStepStates(Array(settings.steps).fill(false));
      }
    }
  }, [
    fsmState, 
    settings.night_mode, 
    settings.night_mode_type, 
    settings.enable_first_step, 
    settings.enable_last_step, 
    settings.night_first_step, 
    settings.night_last_step, 
    isDayTime, 
    settings.steps
  ]);

  const clearAllAnimTimeouts = () => {
    animTimeoutRef.current.forEach((t) => clearTimeout(t));
    animTimeoutRef.current = [];
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const triggerBoth = () => {
    clearAllAnimTimeouts();
    setBottomSensorActive(true);
    setTopSensorActive(true);
    setTimeout(() => {
      setBottomSensorActive(false);
      setTopSensorActive(false);
    }, 1200);
    setDirection('up');
    setFsmState('TURNING_ON_BOTH');
    const total = settings.steps;
    const half = Math.ceil(total / 2);
    const delay = Math.max(30, settings.step_on_time_ms);

    for (let i = 0; i < half; i++) {
      const sBottom = i;
      const sTop = total - 1 - i;
      const t = setTimeout(() => {
        setStepStates((prev) => {
          const next = [...prev];
          if (sBottom >= 0 && sBottom < total) next[sBottom] = true;
          if (sTop >= 0 && sTop < total) next[sTop] = true;
          return next;
        });
        if (i === half - 1) {
          startHolding('up');
        }
      }, i * delay);
      animTimeoutRef.current.push(t);
    }
  };
  const triggerBottom = () => {
    clearAllAnimTimeouts();
    setBottomSensorActive(true);
    setTimeout(() => setBottomSensorActive(false), 1200);

    setDirection('up');
    setFsmState('TURNING_ON_UP');

    const total = settings.steps;
    const delay = settings.step_on_time_ms;

    for (let step = 0; step < total; step++) {
      const t = setTimeout(() => {
        setStepStates((prev) => {
          const next = [...prev];
          const isFirstDisabled = step === 0 && !(settings.enable_first_step ?? true);
          const isLastDisabled = step === total - 1 && !(settings.enable_last_step ?? true);
          if (!isFirstDisabled && !isLastDisabled) {
            next[step] = true;
          }
          return next;
        });

        if (step === total - 1) {
          startHolding('up');
        }
      }, step * delay);
      animTimeoutRef.current.push(t);
    }
  };

  const triggerTop = () => {
    clearAllAnimTimeouts();
    setTopSensorActive(true);
    setTimeout(() => setTopSensorActive(false), 1200);

    setDirection('down');
    setFsmState('TURNING_ON_DOWN');

    const total = settings.steps;
    const delay = settings.step_on_time_ms;

    for (let step = total - 1; step >= 0; step--) {
      const stepIdxFromTop = total - 1 - step;
      const t = setTimeout(() => {
        setStepStates((prev) => {
          const next = [...prev];
          const isFirstDisabled = step === 0 && !(settings.enable_first_step ?? true);
          const isLastDisabled = step === total - 1 && !(settings.enable_last_step ?? true);
          if (!isFirstDisabled && !isLastDisabled) {
            next[step] = true;
          }
          return next;
        });

        if (step === 0) {
          startHolding('down');
        }
      }, stepIdxFromTop * delay);
      animTimeoutRef.current.push(t);
    }
  };

  const resetSensors = () => {
    clearAllAnimTimeouts();
    setBottomSensorActive(false);
    setTopSensorActive(false);
    setHoldRemainingMs(0);
    setFsmState('IDLE');
    if (settings.night_mode && !isDayTime) {
      if (settings.night_mode_type === 0) {
        const next = Array(settings.steps).fill(false);
        if (settings.night_first_step ?? true) next[0] = true;
        if (settings.night_last_step ?? true) next[settings.steps - 1] = true;
        setStepStates(next);
      } else {
        setStepStates(Array(settings.steps).fill(true));
      }
    } else {
      setStepStates(Array(settings.steps).fill(false));
    }
  };

  const startHolding = (dir: 'up' | 'down') => {
    setFsmState('HOLDING');
    setHoldRemainingMs(settings.hold_time_ms);

    const startTime = Date.now();
    const holdDuration = settings.hold_time_ms;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rem = Math.max(0, holdDuration - elapsed);
      setHoldRemainingMs(rem);

      if (rem <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        startTurningOff(dir);
      }
    }, 50);
  };

  const startTurningOff = (dir: 'up' | 'down') => {
    const offUp = settings.reverse_direction ? dir !== 'up' : dir === 'up';
    setFsmState(offUp ? 'TURNING_OFF_UP' : 'TURNING_OFF_DOWN');

    const total = settings.steps;
    const delay = settings.step_off_time_ms;

    if (offUp) {
      for (let step = 0; step < total; step++) {
        const t = setTimeout(() => {
          setStepStates((prev) => {
            const next = [...prev];
            next[step] = false;
            return next;
          });

          if (step === total - 1) {
            finishTurnOff();
          }
        }, step * delay);
        animTimeoutRef.current.push(t);
      }
    } else {
      for (let step = total - 1; step >= 0; step--) {
        const stepIdxFromTop = total - 1 - step;
        const t = setTimeout(() => {
          setStepStates((prev) => {
            const next = [...prev];
            next[step] = false;
            return next;
          });

          if (step === 0) {
            finishTurnOff();
          }
        }, stepIdxFromTop * delay);
        animTimeoutRef.current.push(t);
      }
    }
  };

  const finishTurnOff = () => {
    setFsmState('IDLE');
    setHoldRemainingMs(0);
  };

  const toggleManualAll = (turnOn: boolean) => {
    clearAllAnimTimeouts();
    if (turnOn) {
      setFsmState('MANUAL_ON');
      const all = Array(settings.steps).fill(true);
      if (!(settings.enable_first_step ?? true)) all[0] = false;
      if (!(settings.enable_last_step ?? true)) all[settings.steps - 1] = false;
      setStepStates(all);
    } else {
      setFsmState('IDLE');
      setStepStates(Array(settings.steps).fill(false));
    }
  };

  const toggleSingleStep = (index: number) => {
    setStepStates((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const activeColorRgb = `rgb(${settings.color_r}, ${settings.color_g}, ${settings.color_b})`;
  const nightColorRgb = `rgb(${settings.night_color_r}, ${settings.night_color_g}, ${settings.night_color_b})`;

  const getStateBadge = () => {
    switch (fsmState) {
      case 'IDLE':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">🟢 Ожидание (IDLE)</span>;
      case 'TURNING_ON_UP':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 animate-pulse">⬆️ Зажигание снизу вверх</span>;
      case 'TURNING_ON_DOWN':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 animate-pulse">⬇️ Зажигание сверху вниз</span>;
      case 'TURNING_ON_BOTH':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-950/80 text-purple-300 border border-purple-700/60 animate-bounce">👥 Встречное движение (с двух сторон)</span>;
      case 'HOLDING':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-700/60">⏳ Удержание: {(holdRemainingMs / 1000).toFixed(1)} с</span>;
      case 'TURNING_OFF_UP':
      case 'TURNING_OFF_DOWN':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-950/80 text-sky-300 border border-sky-700/60">🌙 Плавное гашение</span>;
      case 'MANUAL_ON':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-950/80 text-purple-300 border border-purple-700/60">💡 Ручной режим (ВКЛ)</span>;
      default:
        return null;
    }
  };

  return (
    <div id="staircase-visualizer" className="space-y-6">
      {/* Top Controls & State Banner */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-zinc-400 font-medium">Текущий статус FSM лестницы</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-base font-semibold text-zinc-100">{settings.hostname}</span>
                {getStateBadge()}
              </div>
            </div>
          </div>

          {/* Quick Environment & Mode Toggles */}
          <div className="flex items-center gap-2">
            <button
              id="ambient-mode-toggle"
              onClick={() => setIsDayTime(!isDayTime)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all ${
                isDayTime
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-indigo-950/40 border-indigo-800/40 text-indigo-300'
              }`}
            >
              {isDayTime ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{isDayTime ? 'День (без ночн.)' : 'Ночь (активен ночник)'}</span>
            </button>

            <button
              id="open-config-btn"
              onClick={() => setShowConfigDrawer(!showConfigDrawer)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all ${
                showConfigDrawer
                  ? 'bg-zinc-700 border-zinc-600 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Параметры FSM</span>
            </button>
          </div>
        </div>

        {/* Action Trigger Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-4">
          <button
            id="trigger-bottom-btn"
            onClick={triggerBottom}
            className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 ${
              bottomSensorActive
                ? 'bg-emerald-500/30 border-emerald-500 text-emerald-200 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-500'
                : 'bg-emerald-950/40 hover:bg-emerald-900/40 border-emerald-800/60 text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Footprints className="w-4 h-4" />
              <span>{settings.sensor_type === 1 ? 'Снизу (HC-SR04)' : 'Шаг снизу (PIR)'}</span>
            </div>
            <span className="text-[10px] text-emerald-400/80">
              {settings.sensor_type === 1 
                ? `Порог: <${settings.ultrasonic_trigger_distance_cm ?? 80} см`
                : `Датчик GPIO ${settings.sensor_bottom_gpio}`}
            </span>
          </button>

          <button
            id="trigger-both-btn"
            onClick={triggerBoth}
            className="p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 bg-purple-950/40 hover:bg-purple-900/40 border-purple-800/60 text-purple-300"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Users className="w-4 h-4" />
              <span>Встречное</span>
            </div>
            <span className="text-[10px] text-purple-400/80">Оба датчика сразу</span>
          </button>
          <button
            id="trigger-top-btn"
            onClick={triggerTop}
            className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 ${
              topSensorActive
                ? 'bg-emerald-500/30 border-emerald-500 text-emerald-200 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-500'
                : 'bg-emerald-950/40 hover:bg-emerald-900/40 border-emerald-800/60 text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Footprints className="w-4 h-4 rotate-180" />
              <span>{settings.sensor_type === 1 ? 'Сверху (HC-SR04)' : 'Шаг сверху (PIR)'}</span>
            </div>
            <span className="text-[10px] text-emerald-400/80">
              {settings.sensor_type === 1 
                ? `Порог: <${settings.ultrasonic_trigger_distance_cm ?? 80} см`
                : `Датчик GPIO ${settings.sensor_top_gpio}`}
            </span>
          </button>

          <button
            id="reset-sensors-btn"
            onClick={resetSensors}
            className="p-3 rounded-xl bg-amber-950/30 hover:bg-amber-900/40 border border-amber-800/50 text-amber-300 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm"
            title="Ручной сброс состояния датчиков движения в IDLE"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span>Сброс датчиков</span>
            </div>
            <span className="text-[10px] text-amber-400/80">В режим ожидания</span>
          </button>

          <button
            id="manual-on-btn"
            onClick={() => toggleManualAll(true)}
            className="p-3 rounded-xl bg-slate-800/80 hover:bg-slate-750 border border-slate-750 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Lightbulb className="w-4 h-4 text-amber-300" />
              <span>Включить всё</span>
            </div>
            <span className="text-[10px] text-slate-400">100% Яркость</span>
          </button>

          <button
            id="manual-off-btn"
            onClick={() => toggleManualAll(false)}
            className="p-3 rounded-xl bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/50 text-rose-300 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-95 col-span-2 sm:col-span-1"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Power className="w-4 h-4" />
              <span>Погасить всё</span>
            </div>
            <span className="text-[10px] text-rose-400/80">Сброс в IDLE</span>
          </button>
        </div>

        {/* Hold Progress Bar */}
        {fsmState === 'HOLDING' && (
          <div className="mt-4 pt-3 border-t border-zinc-800">
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>Таймер удержания перед гашением</span>
              <span className="font-mono text-amber-300 font-semibold">{(holdRemainingMs / 1000).toFixed(1)} с</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-300"
                style={{ width: `${(holdRemainingMs / settings.hold_time_ms) * 100}%` }}
                transition={{ duration: 0.05 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Config Drawer / Sliders */}
      <AnimatePresence>
        {showConfigDrawer && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                Интерактивная настройка параметров лестницы
              </h3>
              <span className="text-xs text-zinc-400">Синхронизировано с NVS ESP32</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Ступеней: <strong className="text-zinc-100">{settings.steps}</strong>
                </label>
                <input
                  type="range"
                  min="5"
                  max="25"
                  value={settings.steps}
                  onChange={(e) => onUpdateSettings({ steps: parseInt(e.target.value) })}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Скорость вкл.: <strong className="text-zinc-100">{settings.step_on_time_ms} мс</strong> / ступ.
                </label>
                <input
                  type="range"
                  min="40"
                  max="500"
                  step="20"
                  value={settings.step_on_time_ms}
                  onChange={(e) => onUpdateSettings({ step_on_time_ms: parseInt(e.target.value) })}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Скорость выкл.: <strong className="text-zinc-100">{settings.step_off_time_ms} мс</strong> / ступ.
                </label>
                <input
                  type="range"
                  min="40"
                  max="500"
                  step="20"
                  value={settings.step_off_time_ms}
                  onChange={(e) => onUpdateSettings({ step_off_time_ms: parseInt(e.target.value) })}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Удержание: <strong className="text-zinc-100">{settings.hold_time_ms / 1000} с</strong>
                </label>
                <input
                  type="range"
                  min="1000"
                  max="15000"
                  step="500"
                  value={settings.hold_time_ms}
                  onChange={(e) => onUpdateSettings({ hold_time_ms: parseInt(e.target.value) })}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Animation Effects Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-800">
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5 font-medium">
                  Эффект включения:
                </label>
                <select
                  value={settings.anim_effect ?? 0}
                  onChange={(e) => onUpdateSettings({ anim_effect: parseInt(e.target.value) || 0 })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
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
                <label className="text-xs text-zinc-400 block mb-1.5 font-medium">
                  Эффект удержания:
                </label>
                <select
                  value={settings.hold_effect ?? 0}
                  onChange={(e) => onUpdateSettings({ hold_effect: parseInt(e.target.value) || 0 })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
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
                <label className="text-xs text-zinc-400 block mb-1.5 font-medium">
                  Эффект выключения:
                </label>
                <select
                  value={settings.off_effect ?? 0}
                  onChange={(e) => onUpdateSettings({ off_effect: parseInt(e.target.value) || 0 })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value={0}>Волна вслед за шагами</option>
                  <option value={1}>Плавное общее затухание</option>
                  <option value={2}>Пошаговый мягкий фейд</option>
                  <option value={3}>Закрытие шторы (К центру)</option>
                  <option value={4}>Растворение (Звездное угасание)</option>
                </select>
              </div>
            </div>

            {/* Colors & Brightness */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-zinc-800">
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Яркость основной подсветки: <strong className="text-zinc-100">{settings.brightness}%</strong>
                </label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={settings.brightness}
                  onChange={(e) => onUpdateSettings({ brightness: parseInt(e.target.value) })}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Цвет подсветки (RGB)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={`#${((1 << 24) + (settings.color_r << 16) + (settings.color_g << 8) + settings.color_b).toString(16).slice(1)}`}
                    onChange={(e) => {
                      const hex = e.target.value;
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      onUpdateSettings({ color_r: r, color_g: g, color_b: b });
                    }}
                    className="w-10 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
                  />
                  <div className="text-xs font-mono text-zinc-400">
                    R:{settings.color_r} G:{settings.color_g} B:{settings.color_b}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Направление выключения
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={settings.reverse_direction}
                    onChange={(e) => onUpdateSettings({ reverse_direction: e.target.checked })}
                    className="rounded border-zinc-700 text-sky-500 focus:ring-0"
                  />
                  <span>Реверс при гашении (встречный ход)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.strip_zigzag ?? false}
                    onChange={(e) => onUpdateSettings({ strip_zigzag: e.target.checked })}
                    className="rounded border-zinc-700 text-sky-500 focus:ring-0"
                  />
                  <span>Лента проложена зигзагом (змейкой)</span>
                </label>
              </div>
            </div>

            {/* First & Last Steps Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-zinc-800">
              <div className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-200">
                    Первая ступень (Снизу, #1)
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    !(settings.enable_first_step ?? true)
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}>
                    {!(settings.enable_first_step ?? true) ? 'Отключена' : 'Активна'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 text-xs text-zinc-300">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.enable_first_step ?? true}
                      onChange={(e) => onUpdateSettings({ enable_first_step: e.target.checked })}
                      className="rounded border-zinc-700 text-sky-500 focus:ring-0"
                    />
                    <span>Основная подсветка (анимации)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!(settings.enable_first_step ?? true)}
                      checked={(settings.enable_first_step ?? true) && (settings.night_first_step ?? true)}
                      onChange={(e) => onUpdateSettings({ night_first_step: e.target.checked })}
                      className="rounded border-zinc-700 text-sky-500 focus:ring-0 disabled:opacity-40"
                    />
                    <span>Дежурный ночник</span>
                  </label>
                </div>
              </div>

              <div className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-200">
                    Последняя ступень (Сверху, #{settings.steps})
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    !(settings.enable_last_step ?? true)
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}>
                    {!(settings.enable_last_step ?? true) ? 'Отключена' : 'Активна'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 text-xs text-zinc-300">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.enable_last_step ?? true}
                      onChange={(e) => onUpdateSettings({ enable_last_step: e.target.checked })}
                      className="rounded border-zinc-700 text-sky-500 focus:ring-0"
                    />
                    <span>Основная подсветка (анимации)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!(settings.enable_last_step ?? true)}
                      checked={(settings.enable_last_step ?? true) && (settings.night_last_step ?? true)}
                      onChange={(e) => onUpdateSettings({ night_last_step: e.target.checked })}
                      className="rounded border-zinc-700 text-sky-500 focus:ring-0 disabled:opacity-40"
                    />
                    <span>Дежурный ночник</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Sensor Type & Ultrasonic Threshold Slider */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-zinc-800">
              <div>
                <label className="text-xs text-zinc-400 block mb-1.5 font-medium">
                  Тип датчиков присутствия:
                </label>
                <select
                  value={settings.sensor_type ?? 0}
                  onChange={(e) => onUpdateSettings({ sensor_type: parseInt(e.target.value) || 0 })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value={0}>👁️ PIR / Оптический (цифровой вход)</option>
                  <option value={1}>📡 Ультразвуковой дальномер HC-SR04 (см)</option>
                </select>
              </div>

              {settings.sensor_type === 1 ? (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs text-zinc-400 font-medium">
                      Порог срабатывания HC-SR04: <strong className="text-sky-400">{settings.ultrasonic_trigger_distance_cm ?? 80} см</strong>
                    </label>
                    <span className="text-[10px] text-zinc-500 font-mono">10-300 см</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="300"
                    step="5"
                    value={settings.ultrasonic_trigger_distance_cm ?? 80}
                    onChange={(e) => onUpdateSettings({ ultrasonic_trigger_distance_cm: parseInt(e.target.value) || 80 })}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <div className="text-[10px] text-zinc-500 mt-1">
                    Срабатывает, если человек подходит ближе {settings.ultrasonic_trigger_distance_cm ?? 80} см
                  </div>
                </div>
              ) : (
                <div className="flex items-center text-xs text-zinc-400">
                  <span>PIR сенсор срабатывает при детектировании инфракрасного излучения человека (лог. уровень HIGH).</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main 2.5D Isometric Staircase Simulator Stage */}
      <div className="relative bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 border border-zinc-800 rounded-3xl p-6 sm:p-10 shadow-2xl overflow-hidden min-h-[460px] flex flex-col justify-between">
        {/* Ambient Room Lighting Glow */}
        <div 
          className="absolute inset-0 pointer-events-none transition-opacity duration-700"
          style={{
            background: stepStates.some(Boolean)
              ? `radial-gradient(ellipse at 50% 60%, ${activeColorRgb.replace('rgb', 'rgba').replace(')', `, ${0.15 * (settings.brightness / 100)})`)}, transparent 70%)`
              : 'transparent'
          }}
        />

        {/* Top Sensor Visual Anchor */}
        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl border flex items-center gap-2 text-xs font-medium transition-all ${
              topSensorActive
                ? 'bg-emerald-500/20 border-emerald-500/80 text-emerald-300 shadow-lg shadow-emerald-500/20 animate-pulse'
                : 'bg-zinc-900/80 border-zinc-800 text-zinc-400'
            }`}>
              <Radio className={`w-4 h-4 ${topSensorActive ? 'text-emerald-400 animate-spin' : 'text-zinc-500'}`} />
              <span>
                {settings.sensor_type === 1 
                  ? `Верхний HC-SR04 (TRIG: ${settings.sensor_top_gpio}, ECHO: ${settings.sensor_top_echo_gpio ?? 19}): `
                  : `Верхний PIR (GPIO ${settings.sensor_top_gpio}): `}
                <strong>{topSensorActive ? 'ОБНАРУЖЕНО!' : 'ОЖИДАНИЕ'}</strong>
              </span>
            </div>
          </div>
          <span className="text-xs text-zinc-500 font-mono">Верхний этаж (2F)</span>
        </div>

        {/* 2.5D Staircase Steps Stack */}
        <div className="my-6 max-w-xl mx-auto w-full flex flex-col gap-2.5 z-10">
          {Array.from({ length: settings.steps }).map((_, idx) => {
            const stepNum = idx + 1;
            const isOn = stepStates[idx];
            const isNightLight = fsmState === 'IDLE' && settings.night_mode && !isDayTime && isOn;
            const effectiveColor = isNightLight ? nightColorRgb : activeColorRgb;
            const glowOpacity = isNightLight ? 0.35 : (settings.brightness / 100);

            return (
              <motion.div
                key={idx}
                id={`stair-step-${idx}`}
                onClick={() => toggleSingleStep(idx)}
                whileHover={{ scale: 1.015 }}
                className="group relative cursor-pointer"
              >
                {/* Step Plank Container */}
                <div 
                  className="relative h-7 sm:h-8 rounded-lg border flex items-center justify-between px-3 sm:px-4 transition-all duration-200"
                  style={{
                    backgroundColor: isOn ? '#1c1917' : '#18181b',
                    borderColor: isOn 
                      ? effectiveColor.replace('rgb', 'rgba').replace(')', `, ${0.6 * glowOpacity})`)
                      : '#27272a',
                    boxShadow: isOn
                      ? `0 4px 18px ${effectiveColor.replace('rgb', 'rgba').replace(')', `, ${0.45 * glowOpacity})`)}`
                      : 'none'
                  }}
                >
                  {/* Step LED Underglow Bar */}
                  <div 
                    className="absolute -bottom-1 left-2 right-2 h-1.5 rounded-full transition-all duration-300"
                    style={{
                      backgroundColor: isOn ? effectiveColor : 'transparent',
                      filter: isOn ? `blur(2px) drop-shadow(0 0 6px ${effectiveColor})` : 'none',
                      opacity: isOn ? glowOpacity : 0
                    }}
                  />

                  {/* Step Label & Number */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-zinc-400 font-medium group-hover:text-zinc-200">
                      Ступень #{stepNum}
                    </span>
                    {idx === 0 && !(settings.enable_first_step ?? true) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-medium">
                        Отключена
                      </span>
                    )}
                    {idx === settings.steps - 1 && !(settings.enable_last_step ?? true) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-medium">
                        Отключена
                      </span>
                    )}
                    {idx === 0 && (settings.enable_first_step ?? true) && !(settings.night_first_step ?? true) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                        Ночник выкл.
                      </span>
                    )}
                    {idx === settings.steps - 1 && (settings.enable_last_step ?? true) && !(settings.night_last_step ?? true) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                        Ночник выкл.
                      </span>
                    )}
                    {isNightLight && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                        Ночник ({settings.night_brightness}%)
                      </span>
                    )}
                  </div>

                  {/* Individual LED Pixel Matrix on each step */}
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    {Array.from({ length: Math.min(settings.pixels_per_step, 16) }).map((_, pIdx) => (
                      <div
                        key={pIdx}
                        className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                        style={{
                          backgroundColor: isOn ? effectiveColor : '#3f3f46',
                          boxShadow: isOn ? `0 0 4px ${effectiveColor}` : 'none',
                          opacity: isOn ? glowOpacity : 0.4
                        }}
                      />
                    ))}
                  </div>

                  {/* Toggle Indicator */}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                    isOn ? 'bg-emerald-950/80 text-emerald-300' : 'text-zinc-500'
                  }`}>
                    {isOn ? 'ВКЛ' : 'ВЫКЛ'}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Bottom Sensor Visual Anchor */}
        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl border flex items-center gap-2 text-xs font-medium transition-all ${
              bottomSensorActive
                ? 'bg-emerald-500/20 border-emerald-500/80 text-emerald-300 shadow-lg shadow-emerald-500/20 animate-pulse'
                : 'bg-zinc-900/80 border-zinc-800 text-zinc-400'
            }`}>
              <Radio className={`w-4 h-4 ${bottomSensorActive ? 'text-emerald-400 animate-spin' : 'text-zinc-500'}`} />
              <span>
                {settings.sensor_type === 1 
                  ? `Нижний HC-SR04 (TRIG: ${settings.sensor_bottom_gpio}, ECHO: ${settings.sensor_bottom_echo_gpio ?? 18}): `
                  : `Нижний PIR (GPIO ${settings.sensor_bottom_gpio}): `}
                <strong>{bottomSensorActive ? 'ОБНАРУЖЕНО!' : 'ОЖИДАНИЕ'}</strong>
              </span>
            </div>
          </div>
          <span className="text-xs text-zinc-500 font-mono">Нижний этаж (1F)</span>
        </div>
      </div>
    </div>
  );
};
