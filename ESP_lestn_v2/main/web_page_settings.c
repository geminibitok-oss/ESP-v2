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

    httpd_resp_sendstr_chunk(req,
        "<div class='card'>"
        "<h2>Параметры лестницы</h2>"
        "<form method='POST' action='/settings'>"
        "<div class='grid'>"
        "<div class='form-group'><label>Количество ступеней</label>"
    );

    char buf[1024];
    snprintf(buf, sizeof(buf), "<input type='number' name='steps' value='%u' min='1' max='50'></div>", (unsigned int)cfg->steps);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Диодов на ступень</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='pixels' value='%u' min='1' max='50'></div></div>", (unsigned int)cfg->pixels_per_step);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Яркость (0-100%)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='brightness' value='%u' min='1' max='100'></div>", (unsigned int)cfg->brightness);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Ночная яркость (%)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='night_brightness' value='%u' min='1' max='100'></div></div>", (unsigned int)cfg->night_brightness);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<h2>🪜 Подсветка первой и последней ступени</h2>"
        "<div class='grid'>"
        "<div class='form-group'><label>Первая ступень (Снизу, #1)</label><select name='en_first'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Включена в основных анимациях</option>"
        "<option value='0' %s>Отключена (полностью выключена)</option></select></div>",
        cfg->enable_first_step ? "selected" : "",
        !cfg->enable_first_step ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Последняя ступень (Сверху, #N)</label><select name='en_last'>");
    snprintf(buf, sizeof(buf),
        "<option value='1' %s>Включена в основных анимациях</option>"
        "<option value='0' %s>Отключена (полностью выключена)</option></select></div></div>",
        cfg->enable_last_step ? "selected" : "",
        !cfg->enable_last_step ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div class='form-group'><label>Дежурный ночник первой ступени</label><select name='night_first'>"
    );
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

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Задержка включения (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='step_on' value='%u' min='20' max='5000'></div>", (unsigned int)cfg->step_on_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Задержка выключения (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='step_off' value='%u' min='20' max='5000'></div>", (unsigned int)cfg->step_off_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Время удержания (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='hold' value='%u' min='500' max='60000'></div></div>", (unsigned int)cfg->hold_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<h2>Эффекты анимации</h2><div class='grid'><div class='form-group'><label>Эффект включения</label><select name='anim_eff'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Классическая волна</option>"
        "<option value='1' %s>Плавный подъем (Fade Wave)</option>"
        "<option value='2' %s>Штора (Края / Центр)</option>"
        "<option value='3' %s>Метеор (Бегущая комета)</option>"
        "<option value='4' %s>Радужная волна</option>"
        "<option value='5' %s>Огонь / Камин</option></select></div>",
        cfg->anim_effect == 0 ? "selected" : "",
        cfg->anim_effect == 1 ? "selected" : "",
        cfg->anim_effect == 2 ? "selected" : "",
        cfg->anim_effect == 3 ? "selected" : "",
        cfg->anim_effect == 4 ? "selected" : "",
        cfg->anim_effect == 5 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Эффект удержания света</label><select name='hold_eff'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Статичный ровный свет</option>"
        "<option value='1' %s>Плавное дыхание (Breathe)</option>"
        "<option value='2' %s>Шиммер (Мерцание звезд)</option>"
        "<option value='3' %s>Радужный перелив</option>"
        "<option value='4' %s>Живая свеча</option></select></div>",
        cfg->hold_effect == 0 ? "selected" : "",
        cfg->hold_effect == 1 ? "selected" : "",
        cfg->hold_effect == 2 ? "selected" : "",
        cfg->hold_effect == 3 ? "selected" : "",
        cfg->hold_effect == 4 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Эффект выключения</label><select name='off_eff'>");
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>Волна вслед за шагами</option>"
        "<option value='1' %s>Плавное общее затухание</option></select></div></div>",
        cfg->off_effect == 0 ? "selected" : "",
        cfg->off_effect == 1 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<h2>Цвет подсветки (RGB)</h2><div class='grid'><div class='form-group'><label>Красный (R)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='cr' value='%u' min='0' max='255'></div>", (unsigned int)cfg->color_r);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Зеленый (G)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='cg' value='%u' min='0' max='255'></div>", (unsigned int)cfg->color_g);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Синий (B)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='cb' value='%u' min='0' max='255'></div></div>", (unsigned int)cfg->color_b);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<h2>Датчики и GPIO</h2>"
        "<div class='grid'>"
        "<div class='form-group'><label>Тип датчиков</label><select name='sensor_type'>"
    );
    snprintf(buf, sizeof(buf),
        "<option value='0' %s>PIR / Оптический (HIGH/LOW)</option>"
        "<option value='1' %s>Ультразвуковой HC-SR04 (см)</option></select></div>",
        cfg->sensor_type == 0 ? "selected" : "",
        cfg->sensor_type == 1 ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Порог HC-SR04 (см)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='us_trigger_dist' value='%u' min='10' max='300'></div></div>", (unsigned int)cfg->ultrasonic_trigger_distance_cm);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>Макс. дистанция HC-SR04 (см)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='us_max_dist' value='%u' min='50' max='400'></div>", (unsigned int)cfg->ultrasonic_max_distance_cm);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>GPIO ленты WS2812</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='gpio_led' value='%u'></div></div>", (unsigned int)cfg->led_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>GPIO нижнего датчика (TRIG)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='gpio_sb' value='%u'></div>", (unsigned int)cfg->sensor_bottom_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>GPIO нижнего ECHO (HC-SR04)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='echo_b' value='%u'></div></div>", (unsigned int)cfg->sensor_bottom_echo_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div class='form-group'><label>GPIO верхнего датчика (TRIG)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='gpio_st' value='%u'></div>", (unsigned int)cfg->sensor_top_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>GPIO верхнего ECHO (HC-SR04)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='echo_t' value='%u'></div></div>", (unsigned int)cfg->sensor_top_echo_gpio);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='margin:12px 0;padding:12px;background:#0f172a;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:13px;font-weight:600;color:#fcd34d;margin-bottom:4px'>Ручной сброс датчиков</div>"
        "<div style='font-size:12px;color:#94a3b8;margin-bottom:8px'>Сбрасывает текущее состояние и защелки датчиков в режим ожидания.</div>"
        "<button type='button' class='btn btn-warning' onclick=\"fetch('/api/trigger?dir=reset_sensors').then(()=>{alert('Состояние датчиков сброшено!')})\">🔄 Сбросить состояние датчиков прямо сейчас</button>"
        "</div>"
    );

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div class='form-group'><label>Активный уровень датчиков</label><select name='active_high'>"
    );
    snprintf(buf, sizeof(buf), "<option value='1' %s>HIGH (3.3V / PIR датчик)</option><option value='0' %s>LOW (GND / Оптический)</option></select></div>",
        cfg->sensor_active_high ? "selected" : "",
        !cfg->sensor_active_high ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Фильтр дребезга (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='debounce' value='%u' min='10' max='500'></div></div>", (unsigned int)cfg->sensor_debounce_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<h2>☀️ Интернет-время и Астротаймер (Закат / Восход)</h2>"
        "<div class='grid'>"
        "<div class='form-group'><label>NTP синхронизация времени</label><select name='ntp_en'>"
    );
    snprintf(buf, sizeof(buf), "<option value='1' %s>Включена</option><option value='0' %s>Выключена</option></select></div>",
        cfg->ntp_enabled ? "selected" : "",
        !cfg->ntp_enabled ? "selected" : ""
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Часовой пояс (UTC смещение, час)</label>");
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
        "<button type='submit' class='btn btn-success' style='width:100%;margin-top:10px'>💾 Сохранить настройки</button>"
        "</form>"
        "</div>"
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
    cfg->brightness = (uint8_t)web_get_post_param_int(post_buf, "brightness", cfg->brightness);
    cfg->night_brightness = (uint8_t)web_get_post_param_int(post_buf, "night_brightness", cfg->night_brightness);
    cfg->enable_first_step = (web_get_post_param_int(post_buf, "en_first", 1) == 1);
    cfg->enable_last_step = (web_get_post_param_int(post_buf, "en_last", 1) == 1);
    cfg->night_first_step = (web_get_post_param_int(post_buf, "night_first", 1) == 1);
    cfg->night_last_step = (web_get_post_param_int(post_buf, "night_last", 1) == 1);
    cfg->step_on_time_ms = (uint16_t)web_get_post_param_int(post_buf, "step_on", cfg->step_on_time_ms);
    cfg->step_off_time_ms = (uint16_t)web_get_post_param_int(post_buf, "step_off", cfg->step_off_time_ms);
    cfg->hold_time_ms = (uint16_t)web_get_post_param_int(post_buf, "hold", cfg->hold_time_ms);

    cfg->anim_effect = (uint8_t)web_get_post_param_int(post_buf, "anim_eff", cfg->anim_effect);
    cfg->hold_effect = (uint8_t)web_get_post_param_int(post_buf, "hold_eff", cfg->hold_effect);
    cfg->off_effect = (uint8_t)web_get_post_param_int(post_buf, "off_eff", cfg->off_effect);

    cfg->color_r = (uint8_t)web_get_post_param_int(post_buf, "cr", cfg->color_r);
    cfg->color_g = (uint8_t)web_get_post_param_int(post_buf, "cg", cfg->color_g);
    cfg->color_b = (uint8_t)web_get_post_param_int(post_buf, "cb", cfg->color_b);

    cfg->led_gpio = (uint8_t)web_get_post_param_int(post_buf, "gpio_led", cfg->led_gpio);
    cfg->sensor_bottom_gpio = (uint8_t)web_get_post_param_int(post_buf, "gpio_sb", cfg->sensor_bottom_gpio);
    cfg->sensor_top_gpio = (uint8_t)web_get_post_param_int(post_buf, "gpio_st", cfg->sensor_top_gpio);
    cfg->sensor_bottom_echo_gpio = (uint8_t)web_get_post_param_int(post_buf, "echo_b", cfg->sensor_bottom_echo_gpio);
    cfg->sensor_top_echo_gpio = (uint8_t)web_get_post_param_int(post_buf, "echo_t", cfg->sensor_top_echo_gpio);

    cfg->sensor_type = (uint8_t)web_get_post_param_int(post_buf, "sensor_type", cfg->sensor_type);
    cfg->ultrasonic_trigger_distance_cm = (uint16_t)web_get_post_param_int(post_buf, "us_trigger_dist", cfg->ultrasonic_trigger_distance_cm);
    cfg->ultrasonic_max_distance_cm = (uint16_t)web_get_post_param_int(post_buf, "us_max_dist", cfg->ultrasonic_max_distance_cm);

    cfg->sensor_active_high = (web_get_post_param_int(post_buf, "active_high", 1) == 1);
    cfg->sensor_debounce_ms = (uint16_t)web_get_post_param_int(post_buf, "debounce", cfg->sensor_debounce_ms);

    /* Time & Astro settings */
    cfg->ntp_enabled = (web_get_post_param_int(post_buf, "ntp_en", 1) == 1);
    cfg->timezone_offset = (int8_t)web_get_post_param_int(post_buf, "tz", cfg->timezone_offset);
    web_get_post_param(post_buf, "ntp_srv", cfg->ntp_server, sizeof(cfg->ntp_server));
    cfg->latitude = web_get_post_param_float(post_buf, "lat", cfg->latitude);
    cfg->longitude = web_get_post_param_float(post_buf, "lon", cfg->longitude);

    cfg->schedule_mode = (uint8_t)web_get_post_param_int(post_buf, "sched_mode", cfg->schedule_mode);
    cfg->sunset_offset_min = (int16_t)web_get_post_param_int(post_buf, "sunset_off", cfg->sunset_offset_min);
    cfg->sunrise_offset_min = (int16_t)web_get_post_param_int(post_buf, "sunrise_off", cfg->sunrise_offset_min);

    cfg->fixed_on_hour = (uint8_t)web_get_post_param_int(post_buf, "on_h", cfg->fixed_on_hour);
    cfg->fixed_on_minute = (uint8_t)web_get_post_param_int(post_buf, "on_m", cfg->fixed_on_minute);
    cfg->fixed_off_hour = (uint8_t)web_get_post_param_int(post_buf, "off_h", cfg->fixed_off_hour);
    cfg->fixed_off_minute = (uint8_t)web_get_post_param_int(post_buf, "off_m", cfg->fixed_off_minute);

    settings_save(cfg);
    staircase_apply_settings(cfg);

    extern void time_astro_apply_settings(const staircase_settings_t *settings);
    time_astro_apply_settings(cfg);

    ESP_LOGI(TAG, "New settings saved: steps=%u, pixels_per_step=%u, lat=%.4f, lon=%.4f",
             cfg->steps, cfg->pixels_per_step, cfg->latitude, cfg->longitude);

    httpd_resp_set_status(req, "303 See Other");
    httpd_resp_set_hdr(req, "Location", "/settings");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}
