import React from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  Cpu, 
  Wifi, 
  Server, 
  Sparkles,
  GitCommit
} from 'lucide-react';

export const AuditReport: React.FC = () => {
  const fixes = [
    {
      id: 1,
      title: 'Устранение Kernel Panic в аппаратном прерывании (GPIO ISR)',
      severity: 'Критическая',
      problem: 'В обработчике `gpio_isr_handler` вызывался `ESP_LOG` и задержки `vTaskDelay`, что приводило к Guru Meditation Panic (ISR context violation).',
      solution: 'Реализована неблокирующая отправка `xQueueSendFromISR` в очередь FreeRTOS с последующей обработкой дребезга в выделенной задаче `sensor_processing_task`.',
      status: 'Исправлено'
    },
    {
      id: 2,
      title: 'Потокобезопасность управления WS2812 (RMT Driver Mutex)',
      severity: 'Высокая',
      problem: 'Одновременный вызов функций обновления ленты из задачи FSM и HTTP сервера приводил к порче буфера RMT и мерцанию ступеней.',
      solution: 'Добавлен мьютекс `led_mutex` (FreeRTOS Semaphore) с таймаутом, защищающий все операции записи и рендеринга `led_strip_refresh`.',
      status: 'Исправлено'
    },
    {
      id: 3,
      title: 'Автоматический fallback Wi-Fi в режим точки доступа (AP Mode)',
      severity: 'Высокая',
      problem: 'При смене пароля Wi-Fi или недоступности роутера контроллер зависал в бесконечных попытках подключения без возможности перенастройки.',
      solution: 'Реализован счетчик попыток (MAX 5) с автоматическим запуском открытой точки доступа `ESP-Lestn` (IP 192.168.4.1) и mDNS.',
      status: 'Исправлено'
    },
    {
      id: 4,
      title: 'Конечный автомат (FSM) анимации лестницы',
      severity: 'Средняя',
      problem: 'Линейные задержки блокировали обработку повторных срабатываний датчиков во время движения человека по лестнице.',
      solution: 'Построен FSM с состояниями IDLE, TURNING_ON, HOLDING, TURNING_OFF и продлением таймера удержания при повторном шаге.',
      status: 'Исправлено'
    },
    {
      id: 5,
      title: 'Оптимизация встроенного веб-сервера (Чанковая передача)',
      severity: 'Средняя',
      problem: 'Выделение динамического буфера `malloc(12000)` в HTTP сервере вызывало фрагментацию кучи (Heap Fragmentation) и Out of Memory.',
      solution: 'Переведено на поточное формирование ответа `httpd_resp_sendstr_chunk` со стековым буфером 512–768 байт и REST JSON API.',
      status: 'Исправлено'
    },
    {
      id: 6,
      title: 'Безопасная перезагрузка и валидация NVS настроек',
      severity: 'Средняя',
      problem: 'Мгновенный вызов `esp_restart()` обрывал соединение до получения клиентом HTTP 200/302, а поврежденный NVS мог завесить плату.',
      solution: 'Добавлен асинхронный таймер `schedule_restart(500)` и строгая валидация `settings_sanitize` при загрузке из памяти.',
      status: 'Исправлено'
    },
    {
      id: 7,
      title: 'Синхронизация времени по интернету (NTP) и расчет заката/восхода (NOAA)',
      severity: 'Функционал',
      problem: 'Отсутствовала привязка к астрономическому времени: ночной режим приходилось переключать вручную или требовался внешний датчик освещенности.',
      solution: 'Внедрен модуль `time_astro`: фоновый SNTP клиент с поддержкой часовых поясов, астрономический расчет точного заката/восхода по координатам (широта/долгота) и гибкие смещения (минуты до/после заката) с настройкой через веб-интерфейс.',
      status: 'Реализовано'
    },
    {
      id: 8,
      title: 'Поддержка ультразвуковых датчиков расстояния HC-SR04',
      severity: 'Функционал',
      problem: 'Ранее поддерживались только простые цифровые PIR/оптические датчики (HIGH/LOW). Нельзя было настроить точный порог дистанции подхода человека (например, чтобы лестница не реагировала на проходящих вдалеке в коридоре).',
      solution: 'Реализован полноценный ультразвуковой драйвер HC-SR04 в `sensors.c`: генерация импульса TRIG (10 мкс), высокоточный тайминг эхо-импульса ECHO с таймаутами зависания, расчет дистанции в см, настраиваемый порог срабатывания и максимальная дальность с управлением через веб-интерфейс и NVS.',
      status: 'Реализовано'
    },
    {
      id: 9,
      title: 'Сборка прошивки (GitHub Actions) и обновление ESP32 (Web Serial + Wi-Fi OTA)',
      severity: 'Функционал',
      problem: 'Отсутствовал автоматизированный пайплайн сборки прошивки из репозитория и возможность бесшовного обновления прошивки контроллера без ручной установки полного тулчейна ESP-IDF на компьютер.',
      solution: 'Создан CI/CD workflow `.github/workflows/build-firmware.yml` с компиляцией в контейнере `espressif/idf:release-v5.3` и склейкой единого `firmware_merged.bin`. В код прошивки внедрен драйвер Dual-OTA (`web_ota.c`, `web_ota.h`, `POST /api/ota`), а в веб-интерфейс добавлены Web Serial Flasher для прямой USB-прошивки из браузера и беспроводное OTA-обновление.',
      status: 'Реализовано'
    },
    {
      id: 10,
      title: 'Раздельное отключение подсветки первой и последней ступени',
      severity: 'Функционал',
      problem: 'Крайние ступени лестницы не могли настраиваться раздельно. Если нижняя ступень светила в коридор/спальню ночью, либо физически не имела LED ленты (подиум), приходилось терпеть засвет или менять код.',
      solution: 'Добавлены независимые параметры `enable_first_step`, `enable_last_step`, `night_first_step`, `night_last_step` с сохранением в NVS ESP32. Теперь первую и последнюю ступени можно раздельно отключать как в основной анимации подъема/спуска, так и в дежурном ночном режиме ожидания.',
      status: 'Реализовано'
    }
  ];

  return (
    <div id="audit-report" className="space-y-6">
      {/* Top Banner */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              Отчет об аудите и исправлениях прошивки ESP_lestn_v2
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Все выявленные архитектурные проблемы успешно устранены и протестированы
            </p>
          </div>
        </div>
      </div>

      {/* Fixes List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fixes.map((fix) => (
          <div
            key={fix.id}
            className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-3"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-mono font-semibold text-sky-400">
                  #{fix.id} • {fix.severity}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  {fix.status}
                </span>
              </div>

              <h3 className="text-sm font-semibold text-zinc-100 mb-2">
                {fix.title}
              </h3>

              <div className="space-y-2 text-xs">
                <div className="p-2.5 bg-rose-950/20 border border-rose-900/30 rounded-lg text-rose-300">
                  <strong className="block text-rose-400 mb-0.5">Было (ошибка):</strong>
                  {fix.problem}
                </div>

                <div className="p-2.5 bg-emerald-950/20 border border-emerald-900/30 rounded-lg text-emerald-300">
                  <strong className="block text-emerald-400 mb-0.5">Исправлено:</strong>
                  {fix.solution}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
