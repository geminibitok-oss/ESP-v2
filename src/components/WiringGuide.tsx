import React from 'react';
import { 
  Zap, 
  Cpu, 
  ShieldAlert, 
  HelpCircle, 
  CheckCircle2, 
  Cable,
  Flame,
  BatteryCharging
} from 'lucide-react';
import { StaircaseSettings } from '../types';

interface WiringGuideProps {
  settings: StaircaseSettings;
}

export const WiringGuide: React.FC<WiringGuideProps> = ({ settings }) => {
  const totalLeds = settings.steps * settings.pixels_per_step;
  const maxCurrentAmps = ((totalLeds * 60) / 1000).toFixed(1);
  const recommendedPsuAmps = Math.ceil(parseFloat(maxCurrentAmps) * 1.25);

  return (
    <div id="wiring-guide" className="space-y-6">
      {/* Top Banner */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
            <Cable className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Схема подключения и расчет питания
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Подключение ESP32 (3.3V) к WS2812B (5V) и PIR датчикам движения
            </p>
          </div>
        </div>
      </div>

      {/* Pinout Table & Power Calculation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pinout Mapping */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-sky-400" />
            Распиновка микроконтроллера (ESP32)
          </h3>

          <div className="space-y-2 text-xs">
            <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-sky-400">GPIO {settings.led_gpio}</span>
                <span className="text-zinc-400 ml-2">→ Data Line (DIN)</span>
              </div>
              <span className="text-zinc-300 font-mono">Лента WS2812B (через 330-470 Ом)</span>
            </div>

            {settings.sensor_type === 1 ? (
              <>
                <div className="p-3 bg-zinc-950 rounded-xl border border-sky-800/40 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sky-400">GPIO {settings.sensor_bottom_gpio}</span>
                    <span className="text-zinc-400 ml-2">→ Нижний TRIG</span>
                  </div>
                  <span className="text-zinc-300 font-mono">HC-SR04 #1 TRIG (Запуск 10 мкс)</span>
                </div>

                <div className="p-3 bg-zinc-950 rounded-xl border border-sky-800/40 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sky-300">GPIO {settings.sensor_bottom_echo_gpio ?? 18}</span>
                    <span className="text-zinc-400 ml-2">→ Нижний ECHO</span>
                  </div>
                  <span className="text-amber-400 font-mono">HC-SR04 #1 ECHO (через делитель 5V→3.3V)</span>
                </div>

                <div className="p-3 bg-zinc-950 rounded-xl border border-sky-800/40 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-emerald-400">GPIO {settings.sensor_top_gpio}</span>
                    <span className="text-zinc-400 ml-2">→ Верхний TRIG</span>
                  </div>
                  <span className="text-zinc-300 font-mono">HC-SR04 #2 TRIG (Запуск 10 мкс)</span>
                </div>

                <div className="p-3 bg-zinc-950 rounded-xl border border-sky-800/40 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-emerald-300">GPIO {settings.sensor_top_echo_gpio ?? 19}</span>
                    <span className="text-zinc-400 ml-2">→ Верхний ECHO</span>
                  </div>
                  <span className="text-amber-400 font-mono">HC-SR04 #2 ECHO (через делитель 5V→3.3V)</span>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-emerald-400">GPIO {settings.sensor_bottom_gpio}</span>
                    <span className="text-zinc-400 ml-2">→ Нижний датчик</span>
                  </div>
                  <span className="text-zinc-300 font-mono">PIR / Оптический (Нижняя ступень)</span>
                </div>

                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-emerald-400">GPIO {settings.sensor_top_gpio}</span>
                    <span className="text-zinc-400 ml-2">→ Верхний датчик</span>
                  </div>
                  <span className="text-zinc-300 font-mono">PIR / Оптический (Верхняя ступень)</span>
                </div>
              </>
            )}

            <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-zinc-300">GND</span>
                <span className="text-zinc-400 ml-2">→ Общая земля</span>
              </div>
              <span className="text-amber-400 font-mono">ОБЩИЙ GND (ESP32 + БП + Датчики + Лента)</span>
            </div>
          </div>
        </div>

        {/* Power Calculations */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <BatteryCharging className="w-4 h-4 text-amber-400" />
            Расчет блока питания (5 Вольт)
          </h3>

          <div className="p-4 bg-amber-950/20 border border-amber-800/40 rounded-xl space-y-2 text-xs">
            <div className="flex justify-between text-zinc-300">
              <span>Ступеней:</span>
              <strong className="text-white">{settings.steps} шт.</strong>
            </div>
            <div className="flex justify-between text-zinc-300">
              <span>Диодов на ступень:</span>
              <strong className="text-white">{settings.pixels_per_step} шт.</strong>
            </div>
            <div className="flex justify-between text-zinc-300 border-t border-amber-900/40 pt-2">
              <span>Всего светодиодов:</span>
              <strong className="text-amber-300 font-mono">{totalLeds} LEDs</strong>
            </div>
            <div className="flex justify-between text-zinc-300">
              <span>Пиковый ток (100% белый):</span>
              <strong className="text-amber-300 font-mono">{maxCurrentAmps} A</strong>
            </div>
            <div className="flex justify-between text-zinc-200 font-semibold border-t border-amber-900/40 pt-2">
              <span>Рекомендуемый БП (5V):</span>
              <strong className="text-emerald-400 font-mono text-sm">{recommendedPsuAmps} A (минимум)</strong>
            </div>
          </div>

          <div className="text-xs text-zinc-400 leading-relaxed bg-zinc-950 p-3 rounded-xl border border-zinc-800">
            💡 <strong>Совет по монтажу:</strong> Подавайте питание 5V и GND толстым проводом (1.5 мм²) с обоих концов ленты или параллельно на каждые 4-5 ступеней, чтобы избежать просадки напряжения и искажения цветов.
          </div>
        </div>
      </div>

      {/* Critical Hardware Recommendations */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          Важные аппаратные правила надежности
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-zinc-300">
          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
            <div className="font-semibold text-sky-400 mb-1">1. Конденсатор по питанию</div>
            <div>Электролит 1000 мкФ x 10V прямо на вход питания ленты сглаживает скачки тока.</div>
          </div>

          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
            <div className="font-semibold text-amber-400 mb-1">2. Резистор на линии данных</div>
            <div>Резистор 330–470 Ом между GPIO{settings.led_gpio} и контактом DIN ленты защищает первый светодиод.</div>
          </div>

          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800">
            <div className="font-semibold text-emerald-400 mb-1">3. Преобразователь 3.3V → 5V</div>
            <div>При длине провода от ESP32 до ленты более 50 см используйте конвертер уровней 74AHCT125 / TXS0108.</div>
          </div>

          <div className="p-3 bg-zinc-950 rounded-xl border border-sky-800/40">
            <div className="font-semibold text-cyan-400 mb-1">4. Защита пина ECHO (HC-SR04)</div>
            <div>HC-SR04 питается от 5V и выдает 5V на выходе ECHO. Для защиты пина ESP32 (3.3V) используйте резистивный делитель: 1 кОм + 2 кОм на GND.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
