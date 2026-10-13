#include "web_routes.h"

static const char *TAG = "WEB_SETTINGS";
static staircase_settings_t *cfg = NULL;

void web_settings_set_settings(staircase_settings_t *settings)
{
    cfg = settings;
}

esp_err_t settings_get_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    web_send_html_header(req, "Настройки");
    /* Проверяем параметр saved=1 в URL для отображения уведомления */
    char query[32] = {0};
    bool show_saved_banner = false;
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
        if (strstr(query, "saved=1") != NULL) {
            show_saved_banner = true;
        }
    }

    if (show_saved_banner) {
        httpd_resp_sendstr_chunk(req,
            "<div id='save-toast' style='position:sticky;top:10px;z-index:999;margin-bottom:14px;padding:14px 18px;background:#15803d;color:#fff;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 6px 20px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:space-between;animation:fadeIn 0.3s ease-in-out'>"
            "<span>✅ НАСТРОЙКИ УСПЕШНО СОХРАНЕНЫ В FLASH (NVS)!</span>"
            "<button type='button' style='background:none;border:none;color:#fff;font-size:18px;cursor:pointer' onclick='this.parentElement.style.display="none"'>✕</button>"
            "</div>"
        );
    }


    httpd_resp_sendstr_chunk(req,
        "<form method='POST' action='/settings'>"
        "<div style='display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px'>"
        "<button type='button' class='btn btn-sm' onclick='toggleAll(true)'>Развернуть все</button>"
        "<button type='button' class='btn btn-sm' style='background:#475569' onclick='toggleAll(false)'>Свернуть все</button>"
        "</div>"
    );

    char buf[1024];

    /* СЕКЦИЯ 1: Параметры лестницы */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec' open><summary>🪜 1. Параметры лестницы и ленты</summary><div class='sec-body'>"
        "<div class='grid'>"
        "<div class='form-group'><label>Количество ступеней</label>"
    );
    snprintf(buf, sizeof(buf), "<input type='number' name='steps' value='%u' min='1' max='50'></div>", (unsigned int)cfg->steps);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Диодов на ступень</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='pixels' value='%u' min='1' max='50'></div></div>", (unsigned int)cfg->pixels_per_step);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Топология ленты на ступенях</label><select name='zigzag'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Прямое подключение (каждая ступень слева направо)</option>"
        "<option value='1' %s>Зигзаг / Змейка (четные ступени слева направо, нечетные справа налево)</option></select></div>",
        !cfg->strip_zigzag ? "selected" : "",
        cfg->strip_zigzag ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Яркость (0-100%)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='brightness' value='%u' min='1' max='100'></div>", (unsigned int)cfg->brightness);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Ночная яркость (%)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='night_brightness' value='%u' min='1' max='100'></div></div>", (unsigned int)cfg->night_brightness);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin-top:14px;padding-top:10px;border-top:1px dashed #334155;text-align:right'>"
        "<button type='submit' class='btn btn-success btn-sm'>💾 Сохранить этот раздел</button>"
        "</div></div></details>"
    );

    /* СЕКЦИЯ 2: Первая и последняя ступень */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec'><summary>🚪 2. Первая и последняя ступень (дежурный свет)</summary><div class='sec-body'>"
        "<div class='grid'>"
        "<div class='form-group'><label>Первая ступень (Снизу, #1)</label><select name='en_first'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Включена в анимации</option>"
        "<option value='0' %s>Отключена</option></select></div>",
        cfg->enable_first_step ? "selected" : "",
        !cfg->enable_first_step ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Последняя ступень (Сверху)</label><select name='en_last'>");
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Включена в анимации</option>"
        "<option value='0' %s>Отключена</option></select></div></div>",
        cfg->enable_last_step ? "selected" : "",
        !cfg->enable_last_step ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Дежурный ночник первой ступени</label><select name='night_first'>");
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Светится ночью (дежурный свет)</option>"
        "<option value='0' %s>Отключена ночью</option></select></div>",
        cfg->night_first_step ? "selected" : "",
        !cfg->night_first_step ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Дежурный ночник последней ступени</label><select name='night_last'>");
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Светится ночью (дежурный свет)</option>"
        "<option value='0' %s>Отключена ночью</option></select></div></div>",
        cfg->night_last_step ? "selected" : "",
        !cfg->night_last_step ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin-top:14px;padding-top:10px;border-top:1px dashed #334155;text-align:right'>"
        "<button type='submit' class='btn btn-success btn-sm'>💾 Сохранить этот раздел</button>"
        "</div></div></details>"
    );

    /* СЕКЦИЯ 3: Световые эффекты и тайминги (в секундах для удобства) */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec'><summary>✨ 3. Световые эффекты и тайминги</summary><div class='sec-body'>"
        "<div class='grid'>"
        "<div class='form-group'><label>Скорость шага вкл. (мс на ступень)</label>"
    );
    snprintf(buf, sizeof(buf), "<input type='number' name='step_on' value='%u' min='20' max='2000' placeholder='120'></div>", (unsigned int)cfg->step_on_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Скорость шага выкл. (мс на ступень)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='step_off' value='%u' min='20' max='2000' placeholder='150'></div>", (unsigned int)cfg->step_off_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    /* Время удержания задается в СЕКУНДАХ */
    float hold_sec = (float)cfg->hold_time_ms / 1000.0f;
    if (hold_sec < 1.0f) hold_sec = 4.0f;
    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>⏱ Время удержания света (СЕКУНДЫ)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' step='0.5' name='hold_sec' value='%.1f' min='1' max='300'></div></div>", hold_sec);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Эффект включения</label><select name='anim_eff'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Классическая волна</option>"
        "<option value='1' %s>Плавный подъем (Fade Wave)</option>"
        "<option value='2' %s>Штора (Края / Центр)</option>"
        "<option value='3' %s>Метеор (Бегущая комета)</option>"
        "<option value='4' %s>Радужная волна</option>"
        "<option value='5' %s>Огонь / Камин</option>"
        "<option value='6' %s>Бегущий светлячок (Spark Runner)</option>"
        "<option value='7' %s>Гармошка (Схлопывание навстречу)</option>"
        "<option value='8' %s>Цветовой спектр (Cycle Wave)</option>"
        "<option value='9' %s>Звездное небо (Случайные ступени)</option>"
        "<option value='10' %s>Неоновый импульс (Cyber Pulse)</option></select></div>",
        cfg->anim_effect == 0 ? "selected" : "",
        cfg->anim_effect == 1 ? "selected" : "",
        cfg->anim_effect == 2 ? "selected" : "",
        cfg->anim_effect == 3 ? "selected" : "",
        cfg->anim_effect == 4 ? "selected" : "",
        cfg->anim_effect == 5 ? "selected" : "",
        cfg->anim_effect == 6 ? "selected" : "",
        cfg->anim_effect == 7 ? "selected" : "",
        cfg->anim_effect == 8 ? "selected" : "",
        cfg->anim_effect == 9 ? "selected" : "",
        cfg->anim_effect == 10 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Эффект удержания света</label><select name='hold_eff'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Статичный ровный свет</option>"
        "<option value='1' %s>Плавное дыхание (Breathe)</option>"
        "<option value='2' %s>Шиммер (Мерцание звезд)</option>"
        "<option value='3' %s>Радужный перелив</option>"
        "<option value='4' %s>Живая свеча</option>"
        "<option value='5' %s>Северное сияние (Aurora)</option>"
        "<option value='6' %s>Плазма / Лава (Plasma Lava)</option>"
        "<option value='7' %s>Пульс / Сердце (Heartbeat)</option></select></div>",
        cfg->hold_effect == 0 ? "selected" : "",
        cfg->hold_effect == 1 ? "selected" : "",
        cfg->hold_effect == 2 ? "selected" : "",
        cfg->hold_effect == 3 ? "selected" : "",
        cfg->hold_effect == 4 ? "selected" : "",
        cfg->hold_effect == 5 ? "selected" : "",
        cfg->hold_effect == 6 ? "selected" : "",
        cfg->hold_effect == 7 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Эффект выключения</label><select name='off_eff'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Волна вслед за шагами</option>"
        "<option value='1' %s>Плавное общее затухание</option>"
        "<option value='2' %s>Пошаговый мягкий фейд</option>"
        "<option value='3' %s>Закрытие шторы (К центру)</option>"
        "<option value='4' %s>Растворение (Звездное угасание)</option></select></div></div>",
        cfg->off_effect == 0 ? "selected" : "",
        cfg->off_effect == 1 ? "selected" : "",
        cfg->off_effect == 2 ? "selected" : "",
        cfg->off_effect == 3 ? "selected" : "",
        cfg->off_effect == 4 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin-top:14px;padding-top:10px;border-top:1px dashed #334155;text-align:right'>"
        "<button type='submit' class='btn btn-success btn-sm'>💾 Сохранить этот раздел</button>"
        "</div></div></details>"
    );

    /* СЕКЦИЯ 4: Палитра цветов */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec'><summary>🎨 4. Палитра цветов и пресеты</summary><div class='sec-body'>"
        "<div class='grid'>"
        "<div class='form-group'>"
        "<label>Основной цвет анимации (шаги, волна, удержание)</label>"
    );
    char hex_main[8];
    snprintf(hex_main, sizeof(hex_main), "#%02x%02x%02x", cfg->color_r, cfg->color_g, cfg->color_b);
    snprintf(buf, sizeof(buf),
        "<div style='display:flex;align-items:center;gap:10px;margin-bottom:8px'>"
        "<input type='color' id='color_picker_main' value='%s' style='width:54px;height:38px;padding:2px;cursor:pointer;border-radius:6px;border:1px solid #475569' onchange='syncColorFromPicker()'>"
        "<span style='font-size:12px;color:#94a3b8'>Нажмите на палитру для выбора любого цвета</span>"
        "</div>"
        "<div style='display:flex;gap:6px'>"
        "<input type='number' id='cr_in' name='cr' value='%u' min='0' max='255' style='width:33%%' placeholder='R' onchange='syncPickerFromInputs()'>"
        "<input type='number' id='cg_in' name='cg' value='%u' min='0' max='255' style='width:33%%' placeholder='G' onchange='syncPickerFromInputs()'>"
        "<input type='number' id='cb_in' name='cb' value='%u' min='0' max='255' style='width:33%%' placeholder='B' onchange='syncPickerFromInputs()'>"
        "</div></div>",
        hex_main, (unsigned int)cfg->color_r, (unsigned int)cfg->color_g, (unsigned int)cfg->color_b
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='form-group'>"
        "<label>Цвет ночного дежурного режима (ночник)</label>"
    );
    char hex_night[8];
    snprintf(hex_night, sizeof(hex_night), "#%02x%02x%02x", cfg->night_color_r, cfg->night_color_g, cfg->night_color_b);
    snprintf(buf, sizeof(buf),
        "<div style='display:flex;align-items:center;gap:10px;margin-bottom:8px'>"
        "<input type='color' id='color_picker_night' value='%s' style='width:54px;height:38px;padding:2px;cursor:pointer;border-radius:6px;border:1px solid #475569' onchange='syncNightColorFromPicker()'>"
        "<span style='font-size:12px;color:#94a3b8'>Мягкий ночной оттенок (теплый янтарь)</span>"
        "</div>"
        "<div style='display:flex;gap:6px'>"
        "<input type='number' id='ncr_in' name='ncr' value='%u' min='0' max='255' style='width:33%%' placeholder='R' onchange='syncNightPickerFromInputs()'>"
        "<input type='number' id='ncg_in' name='ncg' value='%u' min='0' max='255' style='width:33%%' placeholder='G' onchange='syncNightPickerFromInputs()'>"
        "<input type='number' id='ncb_in' name='ncb' value='%u' min='0' max='255' style='width:33%%' placeholder='B' onchange='syncNightPickerFromInputs()'>"
        "</div></div></div>",
        hex_night, (unsigned int)cfg->night_color_r, (unsigned int)cfg->night_color_g, (unsigned int)cfg->night_color_b
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin-bottom:16px;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid #334155;font-size:11px;color:#cbd5e1'>"
        "Быстрые пресеты: "
        "<button type='button' class='btn btn-sm' style='margin:2px;background:#f59e0b;color:#000' onclick='setPreset(255,180,60)'>Теплый белый (2700K)</button> "
        "<button type='button' class='btn btn-sm' style='margin:2px;background:#fef08a;color:#000' onclick='setPreset(255,240,200)'>Нейтральный (4000K)</button> "
        "<button type='button' class='btn btn-sm' style='margin:2px;background:#38bdf8;color:#000' onclick='setPreset(0,180,255)'>Ледяной синий</button> "
        "<button type='button' class='btn btn-sm' style='margin:2px;background:#a855f7;color:#fff' onclick='setPreset(180,50,255)'>Неон Небула</button> "
        "<button type='button' class='btn btn-sm' style='margin:2px;background:#10b981;color:#000' onclick='setPreset(0,255,120)'>Изумруд</button>"
        "</div>"
        "<div style='margin-top:14px;padding-top:10px;border-top:1px dashed #334155;text-align:right'>"
        "<button type='submit' class='btn btn-success btn-sm'>💾 Сохранить этот раздел</button>"
        "</div></div></details>"
    );

    /* СЕКЦИЯ 5: Независимые датчики движения */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec'><summary>📡 5. Датчики движения и выводы GPIO</summary><div class='sec-body'>"
        "<div style='margin-bottom:12px;padding:10px 14px;background:#0b1329;border-radius:8px;border:1px solid #1d4ed8;font-size:12px'>"
        "<div style='font-weight:600;color:#60a5fa;margin-bottom:4px'>Текущие замеры ультразвука HC-SR04 в реальном времени:</div>"
        "<div>Нижний датчик: <strong id='set_d_bot' style='color:#38bdf8'>--</strong> см | Верхний датчик: <strong id='set_d_top' style='color:#38bdf8'>--</strong> см</div>"
        "</div>"

        /* БЛОК НИЖНЕГО ДАТЧИКА */
        "<div style='background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px'>"
        "<h3 style='margin:0 0 10px 0;color:#38bdf8;font-size:14px'>⬇️ Настройки НИЖНЕГО датчика (Вход снизу)</h3>"
        "<div class='grid'>"
        "<div class='form-group'><label>Тип нижнего датчика</label><select name='sb_type' id='sb_type_sel' onchange='updateSensorFormVisibility()'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>PIR / Оптический / Радар (Цифровой сигнал)</option>"
        "<option value='1' %s>Ультразвуковой HC-SR04 (Дистанция)</option></select></div>",
        cfg->sensor_bottom_type == 0 ? "selected" : "",
        cfg->sensor_bottom_type == 1 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>GPIO сигнала (TRIG)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='gpio_sb' value='%u'></div></div>", (unsigned int)cfg->sensor_bottom_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid' id='sb_sr04_fields'>"
        "<div class='form-group'><label>GPIO ECHO (для HC-SR04)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='echo_b' value='%u'></div>", (unsigned int)cfg->sensor_bottom_echo_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Порог срабатывания снизу (см)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='sb_threshold' value='%u' min='10' max='300'></div></div>", (unsigned int)cfg->sensor_bottom_threshold_cm);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid' id='sb_pir_fields'>"
        "<div class='form-group'><label>Активный уровень (для PIR)</label><select name='sb_high'>");
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>HIGH (3.3V при движении)</option>"
        "<option value='0' %s>LOW (GND / Замыкание на минус)</option></select></div></div>",
        cfg->sensor_bottom_active_high ? "selected" : "",
        !cfg->sensor_bottom_active_high ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);
    httpd_resp_sendstr_chunk(req, "</div>");

    /* БЛОК ВЕРХНЕГО ДАТЧИКА */
    httpd_resp_sendstr_chunk(req,
        "<div style='background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px'>"
        "<h3 style='margin:0 0 10px 0;color:#38bdf8;font-size:14px'>⬆️ Настройки ВЕРХНЕГО датчика (Вход сверху)</h3>"
        "<div class='grid'>"
        "<div class='form-group'><label>Тип верхнего датчика</label><select name='st_type' id='st_type_sel' onchange='updateSensorFormVisibility()'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>PIR / Оптический / Радар (Цифровой сигнал)</option>"
        "<option value='1' %s>Ультразвуковой HC-SR04 (Дистанция)</option></select></div>",
        cfg->sensor_top_type == 0 ? "selected" : "",
        cfg->sensor_top_type == 1 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>GPIO сигнала (TRIG)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='gpio_st' value='%u'></div></div>", (unsigned int)cfg->sensor_top_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid' id='st_sr04_fields'>"
        "<div class='form-group'><label>GPIO ECHO (для HC-SR04)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='echo_t' value='%u'></div>", (unsigned int)cfg->sensor_top_echo_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Порог срабатывания сверху (см)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='st_threshold' value='%u' min='10' max='300'></div></div>", (unsigned int)cfg->sensor_top_threshold_cm);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid' id='st_pir_fields'>"
        "<div class='form-group'><label>Активный уровень (для PIR)</label><select name='st_high'>");
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>HIGH (3.3V при движении)</option>"
        "<option value='0' %s>LOW (GND / Замыкание на минус)</option></select></div></div>",
        cfg->sensor_top_active_high ? "selected" : "",
        !cfg->sensor_top_active_high ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);
    httpd_resp_sendstr_chunk(req, "</div>");

    /* ОБЩИЕ ПАРАМЕТРЫ И СБРОС */
    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div class='form-group'><label>GPIO ленты WS2812</label>"
    );
    snprintf(buf, sizeof(buf), "<input type='number' name='gpio_led' value='%u'></div>", (unsigned int)cfg->led_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Фильтр дребезга (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='debounce' value='%u' min='10' max='500'></div></div>", (unsigned int)cfg->sensor_debounce_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin:10px 0;padding:10px;background:#0f172a;border-radius:8px;border:1px solid #334155'>"
        "<button type='button' class='btn btn-warning' style='width:100%' onclick=\"fetch('/api/trigger?dir=reset_sensors').then(()=>{alert('Состояние датчиков сброшено!')})\">🔄 Сбросить состояние датчиков прямо сейчас</button>"
        "</div>"
        "<div style='margin-top:14px;padding-top:10px;border-top:1px dashed #334155;text-align:right'>"
        "<button type='submit' class='btn btn-success btn-sm'>💾 Сохранить этот раздел</button>"
        "</div></div></details>"
    );

    /* СЕКЦИЯ 6: Астротаймер и NTP */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec'><summary>☀️ 6. Интернет-время и Астротаймер (Закат / Восход)</summary><div class='sec-body'>"
        "<div class='grid'>"
        "<div class='form-group'><label>Синхронизация времени NTP</label><select name='ntp_en'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Включена</option>"
        "<option value='0' %s>Выключена</option></select></div>",
        cfg->ntp_enabled ? "selected" : "",
        !cfg->ntp_enabled ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Часовой пояс UTC (+/-)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='tz' value='%d' min='-12' max='14'></div></div>", (int)cfg->timezone_offset);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>NTP Сервер времени</label>");
    snprintf(buf, sizeof(buf), "<input type='text' name='ntp_srv' value='%s' maxlength='63'></div>", cfg->ntp_server);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Широта (Latitude, °)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' step='0.0001' name='lat' value='%.4f'></div>", cfg->latitude);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Долгота (Longitude, °)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' step='0.0001' name='lon' value='%.4f'></div></div>", cfg->longitude);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='form-group'><label>Режим автоматического включения / расписания</label><select name='sched_mode'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>🌅 Астрономический (по закату и восходу солнца)</option>"
        "<option value='1' %s>⏰ Фиксированное время (по часам)</option>"
        "<option value='2' %s>🌕 Всегда включен ночной режим</option>"
        "<option value='3' %s>🌑 Выключен (только по датчикам днем)</option></select></div>",
        cfg->schedule_mode == 0 ? "selected" : "",
        cfg->schedule_mode == 1 ? "selected" : "",
        cfg->schedule_mode == 2 ? "selected" : "",
        cfg->schedule_mode == 3 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div class='form-group'><label>Смещение от заката (мин, +/-)</label>"
    );
    snprintf(buf, sizeof(buf), "<input type='number' name='sunset_off' value='%d' min='-180' max='180'></div>", (int)cfg->sunset_offset_min);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Смещение от восхода (мин, +/-)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='sunrise_off' value='%d' min='-180' max='180'></div></div>", (int)cfg->sunrise_offset_min);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div class='form-group'><label>Фиксированное вкл (ЧЧ:ММ)</label>"
    );
    snprintf(buf, sizeof(buf), "<div style='display:flex;gap:4px'><input type='number' name='on_h' value='%u' min='0' max='23'>:<input type='number' name='on_m' value='%u' min='0' max='59'></div></div>",
             (unsigned int)cfg->fixed_on_hour, (unsigned int)cfg->fixed_on_minute);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Фиксированное выкл (ЧЧ:ММ)</label>");
    snprintf(buf, sizeof(buf), "<div style='display:flex;gap:4px'><input type='number' name='off_h' value='%u' min='0' max='23'>:<input type='number' name='off_m' value='%u' min='0' max='59'></div></div></div>",
             (unsigned int)cfg->fixed_off_hour, (unsigned int)cfg->fixed_off_minute);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin-top:14px;padding-top:10px;border-top:1px dashed #334155;text-align:right'>"
        "<button type='submit' class='btn btn-success btn-sm'>💾 Сохранить этот раздел</button>"
        "</div></div></details>"
    );

    /* ГЛАВНАЯ КНОПКА СОХРАНЕНИЯ ВНИЗУ И СКРИПТЫ */
    httpd_resp_sendstr_chunk(req,
        "<button type='submit' class='btn btn-success' style='width:100%;padding:14px;font-size:16px;margin:16px 0'>💾 Сохранить ВСЕ настройки</button>"
        "</form>"
        "<script>"
        "function toggleAll(open){"
        "    var list = document.querySelectorAll('details.st-sec, details');"
        "    for(var i=0; i<list.length; i++){"
        "        if(open){ list[i].setAttribute('open', ''); }"
        "        else { list[i].removeAttribute('open'); }"
        "    }"
        "}"
        "function syncColorFromPicker(){"
        "    var h=document.getElementById('color_picker_main').value;"
        "    document.getElementById('cr_in').value=parseInt(h.substr(1,2),16);"
        "    document.getElementById('cg_in').value=parseInt(h.substr(3,2),16);"
        "    document.getElementById('cb_in').value=parseInt(h.substr(5,2),16);"
        "}"
        "function syncPickerFromInputs(){"
        "    var r=Math.min(255,Math.max(0,parseInt(document.getElementById('cr_in').value)||0));"
        "    var g=Math.min(255,Math.max(0,parseInt(document.getElementById('cg_in').value)||0));"
        "    var b=Math.min(255,Math.max(0,parseInt(document.getElementById('cb_in').value)||0));"
        "    var h='#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);"
        "    document.getElementById('color_picker_main').value=h;"
        "}"
        "function syncNightColorFromPicker(){"
        "    var h=document.getElementById('color_picker_night').value;"
        "    document.getElementById('ncr_in').value=parseInt(h.substr(1,2),16);"
        "    document.getElementById('ncg_in').value=parseInt(h.substr(3,2),16);"
        "    document.getElementById('ncb_in').value=parseInt(h.substr(5,2),16);"
        "}"
        "function syncNightPickerFromInputs(){"
        "    var r=Math.min(255,Math.max(0,parseInt(document.getElementById('ncr_in').value)||0));"
        "    var g=Math.min(255,Math.max(0,parseInt(document.getElementById('ncg_in').value)||0));"
        "    var b=Math.min(255,Math.max(0,parseInt(document.getElementById('ncb_in').value)||0));"
        "    var h='#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);"
        "    document.getElementById('color_picker_night').value=h;"
        "}"
        "function setPreset(r,g,b){"
        "    document.getElementById('cr_in').value=r;"
        "    document.getElementById('cg_in').value=g;"
        "    document.getElementById('cb_in').value=b;"
        "    syncPickerFromInputs();"
        "}"
        "function updateSensorFormVisibility(){"
        "    var sbT = document.getElementById('sb_type_sel').value;"
        "    var stT = document.getElementById('st_type_sel').value;"
        "    document.getElementById('sb_sr04_fields').style.display = (sbT === '1') ? 'grid' : 'none';"
        "    document.getElementById('sb_pir_fields').style.display = (sbT === '0') ? 'grid' : 'none';"
        "    document.getElementById('st_sr04_fields').style.display = (stT === '1') ? 'grid' : 'none';"
        "    document.getElementById('st_pir_fields').style.display = (stT === '0') ? 'grid' : 'none';"
        "}"
        "function pollLiveDistances(){"
        "    var xhr = new XMLHttpRequest();"
        "    xhr.open('GET', '/api/state', true);"
        "    xhr.onload = function(){"
        "        if(xhr.status === 200){"
        "            try {"
        "                var d = JSON.parse(xhr.responseText);"
        "                var botEl = document.getElementById('set_d_bot');"
        "                var topEl = document.getElementById('set_d_top');"
        "                if(botEl && topEl){"
        "                    botEl.innerText = (d.bottom_dist >= 400 || d.bottom_dist === 999) ? '>400' : d.bottom_dist;"
        "                    topEl.innerText = (d.top_dist >= 400 || d.top_dist === 999) ? '>400' : d.top_dist;"
        "                }"
        "            } catch(e){}"
        "        }"
        "    };"
        "    xhr.send();"
        "}"
        "setInterval(pollLiveDistances, 800);"
        "setTimeout(updateSensorFormVisibility, 50);"
        "</script>"
    );

    return web_send_html_footer(req);
}

esp_err_t settings_post_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    char post_buf[1536] = {0};
    int total_len = req->content_len;
    if (total_len >= (int)sizeof(post_buf)) total_len = (int)sizeof(post_buf) - 1;

    int cur_len = 0;
    while (cur_len < total_len) {
        int received = httpd_req_recv(req, post_buf + cur_len, total_len - cur_len);
        if (received <= 0) break;
        cur_len += received;
    }
    post_buf[cur_len] = '\0';

    cfg->steps = (uint16_t)web_get_post_param_int(post_buf, "steps", cfg->steps);
    cfg->pixels_per_step = (uint16_t)web_get_post_param_int(post_buf, "pixels", cfg->pixels_per_step);
    cfg->strip_zigzag = (web_get_post_param_int(post_buf, "zigzag", 0) == 1);
    cfg->brightness = (uint8_t)web_get_post_param_int(post_buf, "brightness", cfg->brightness);
    cfg->night_brightness = (uint8_t)web_get_post_param_int(post_buf, "night_brightness", cfg->night_brightness);

    cfg->enable_first_step = (web_get_post_param_int(post_buf, "en_first", 1) == 1);
    cfg->enable_last_step = (web_get_post_param_int(post_buf, "en_last", 1) == 1);
    cfg->night_first_step = (web_get_post_param_int(post_buf, "night_first", 1) == 1);
    cfg->night_last_step = (web_get_post_param_int(post_buf, "night_last", 1) == 1);

    cfg->step_on_time_ms = (uint16_t)web_get_post_param_int(post_buf, "step_on", cfg->step_on_time_ms);
    cfg->step_off_time_ms = (uint16_t)web_get_post_param_int(post_buf, "step_off", cfg->step_off_time_ms);
        char hold_sec_str[32] = {0};
    if (web_get_post_param(post_buf, "hold_sec", hold_sec_str, sizeof(hold_sec_str))) {
        float sec = (float)atof(hold_sec_str);
        if (sec >= 1.0f && sec <= 600.0f) {
            cfg->hold_time_ms = (uint32_t)(sec * 1000.0f);
        }
    } else {
        cfg->hold_time_ms = (uint32_t)web_get_post_param_int(post_buf, "hold", cfg->hold_time_ms);
    }
    if (cfg->hold_time_ms < 1000) cfg->hold_time_ms = 4000;

    cfg->anim_effect = (uint8_t)web_get_post_param_int(post_buf, "anim_eff", cfg->anim_effect);
    cfg->hold_effect = (uint8_t)web_get_post_param_int(post_buf, "hold_eff", cfg->hold_effect);
    cfg->off_effect = (uint8_t)web_get_post_param_int(post_buf, "off_eff", cfg->off_effect);

    cfg->color_r = (uint8_t)web_get_post_param_int(post_buf, "cr", cfg->color_r);
    cfg->color_g = (uint8_t)web_get_post_param_int(post_buf, "cg", cfg->color_g);
    cfg->color_b = (uint8_t)web_get_post_param_int(post_buf, "cb", cfg->color_b);
    cfg->night_color_r = (uint8_t)web_get_post_param_int(post_buf, "ncr", cfg->night_color_r);
    cfg->night_color_g = (uint8_t)web_get_post_param_int(post_buf, "ncg", cfg->night_color_g);
    cfg->night_color_b = (uint8_t)web_get_post_param_int(post_buf, "ncb", cfg->night_color_b);

    /* Независимые датчики */
    cfg->sensor_bottom_type = (uint8_t)web_get_post_param_int(post_buf, "sb_type", cfg->sensor_bottom_type);
    cfg->sensor_top_type = (uint8_t)web_get_post_param_int(post_buf, "st_type", cfg->sensor_top_type);
    cfg->sensor_bottom_threshold_cm = (uint16_t)web_get_post_param_int(post_buf, "sb_threshold", cfg->sensor_bottom_threshold_cm);
    cfg->sensor_top_threshold_cm = (uint16_t)web_get_post_param_int(post_buf, "st_threshold", cfg->sensor_top_threshold_cm);
    cfg->sensor_bottom_active_high = (web_get_post_param_int(post_buf, "sb_high", 1) == 1);
    cfg->sensor_top_active_high = (web_get_post_param_int(post_buf, "st_high", 1) == 1);
    cfg->sensor_type = cfg->sensor_bottom_type;
    cfg->ultrasonic_trigger_distance_cm = cfg->sensor_bottom_threshold_cm;

    cfg->led_gpio = (uint8_t)web_get_post_param_int(post_buf, "gpio_led", cfg->led_gpio);
    cfg->sensor_bottom_gpio = (uint8_t)web_get_post_param_int(post_buf, "gpio_sb", cfg->sensor_bottom_gpio);
    cfg->sensor_top_gpio = (uint8_t)web_get_post_param_int(post_buf, "gpio_st", cfg->sensor_top_gpio);
    cfg->sensor_bottom_echo_gpio = (uint8_t)web_get_post_param_int(post_buf, "echo_b", cfg->sensor_bottom_echo_gpio);
    cfg->sensor_top_echo_gpio = (uint8_t)web_get_post_param_int(post_buf, "echo_t", cfg->sensor_top_echo_gpio);
    cfg->sensor_debounce_ms = (uint16_t)web_get_post_param_int(post_buf, "debounce", cfg->sensor_debounce_ms);

    cfg->ntp_enabled = (web_get_post_param_int(post_buf, "ntp_en", 1) == 1);
    cfg->timezone_offset = (int8_t)web_get_post_param_int(post_buf, "tz", cfg->timezone_offset);
    web_get_post_param(post_buf, "ntp_srv", cfg->ntp_server, sizeof(cfg->ntp_server));

    char lat_str[32] = {0};
    if (web_get_post_param(post_buf, "lat", lat_str, sizeof(lat_str))) cfg->latitude = (float)atof(lat_str);
    char lon_str[32] = {0};
    if (web_get_post_param(post_buf, "lon", lon_str, sizeof(lon_str))) cfg->longitude = (float)atof(lon_str);

    cfg->schedule_mode = (uint8_t)web_get_post_param_int(post_buf, "sched_mode", cfg->schedule_mode);
    cfg->sunset_offset_min = (int16_t)web_get_post_param_int(post_buf, "sunset_off", cfg->sunset_offset_min);
    cfg->sunrise_offset_min = (int16_t)web_get_post_param_int(post_buf, "sunrise_off", cfg->sunrise_offset_min);
    cfg->fixed_on_hour = (uint8_t)web_get_post_param_int(post_buf, "on_h", cfg->fixed_on_hour);
    cfg->fixed_on_minute = (uint8_t)web_get_post_param_int(post_buf, "on_m", cfg->fixed_on_minute);
    cfg->fixed_off_hour = (uint8_t)web_get_post_param_int(post_buf, "off_h", cfg->fixed_off_hour);
    cfg->fixed_off_minute = (uint8_t)web_get_post_param_int(post_buf, "off_m", cfg->fixed_off_minute);

    settings_save(cfg);
    staircase_apply_settings(cfg);

    ESP_LOGI(TAG, "Settings saved to NVS and applied to running controller");

    httpd_resp_set_status(req, "303 See Other");
    httpd_resp_set_hdr(req, "Location", "/settings?saved=1");
    return httpd_resp_send(req, NULL, 0);
}
