#include "web_routes.h"

static const char *TAG = "WEB_INDEX";
static staircase_settings_t *cfg = NULL;

void web_index_set_settings(staircase_settings_t *settings)
{
    cfg = settings;
}

esp_err_t index_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    web_send_html_header(req, "Управление");

    httpd_resp_sendstr_chunk(req, "<div class='card'><h2>Состояние лестницы</h2>");

    char buf[1024];
    snprintf(buf, sizeof(buf), "<p>Статус FSM: <span id='stair-state' class='badge badge-blue'>%s</span></p>", staircase_get_state_str());
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div style='background:#0b1329;border:1px solid #1e3a8a;padding:12px;border-radius:8px;margin-bottom:12px'>"
        "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'>"
        "<span style='font-size:13px;color:#93c5fd;font-weight:600'>🕒 Время сети (NTP):</span>"
        "<span id='clock-time' style='font-family:monospace;font-weight:bold;color:#f8fafc'>Синхронизация...</span>"
        "</div>"
        "<div style='display:flex;justify-content:space-between;align-items:center;font-size:13px'>"
        "<span>🌅 Восход: <strong id='sun-rise' style='color:#fde047'>--:--</strong> | 🌇 Закат: <strong id='sun-set' style='color:#fb923c'>--:--</strong></span>"
        "<span id='night-badge' class='badge badge-blue'>--</span>"
        "</div>"
        "<div style='margin-top:6px;font-size:12px;color:#94a3b8' id='next-switch-txt'></div>"
        "</div>"
    );

    snprintf(buf, sizeof(buf), "<p>Таймер удержания: <strong id='hold-time'>%u мс</strong></p>", (unsigned int)staircase_get_hold_remaining_ms());
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:12px;border-radius:8px;text-align:center'>"
        "<div style='font-weight:600;margin-bottom:4px'>Нижний датчик</div>"
        "<span id='sensor-bottom' class='badge badge-red'>НЕТ</span>"
        "<div id='dist-box-bottom' style='font-size:12px;color:#38bdf8;margin-top:6px;font-family:monospace'>"
        "Дистанция: <strong id='dist-bottom'>--</strong> см"
        "</div>"
        "</div>"
        "<div style='background:#0f172a;padding:12px;border-radius:8px;text-align:center'>"
        "<div style='font-weight:600;margin-bottom:4px'>Верхний датчик</div>"
        "<span id='sensor-top' class='badge badge-red'>НЕТ</span>"
        "<div id='dist-box-top' style='font-size:12px;color:#38bdf8;margin-top:6px;font-family:monospace'>"
        "Дистанция: <strong id='dist-top'>--</strong> см"
        "</div>"
        "</div>"
        "</div>"
    );

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<button class='btn btn-success' onclick=\"fetch('/api/trigger?dir=bottom').then(updateState)\">🚶 Пройти снизу</button>"
        "<button class='btn btn-success' onclick=\"fetch('/api/trigger?dir=top').then(updateState)\">🚶 Пройти сверху</button>"
        "<button class='btn' onclick=\"fetch('/api/trigger?dir=all_on').then(updateState)\">💡 Включить всё</button>"
        "<button class='btn btn-danger' onclick=\"fetch('/api/trigger?dir=all_off').then(updateState)\">🌑 Выключить всё</button>"
        "</div>"
        "<div style='margin-top:8px'>"
        "<button class='btn btn-warning' style='width:100%' onclick=\"fetch('/api/trigger?dir=reset_sensors').then(updateState)\">🔄 Сбросить состояние датчиков</button>"
        "</div>"
        "</div>"
    );

    snprintf(buf, sizeof(buf), "<div class='card'><h2>Ступени (%u шт.)</h2><div id='steps-list'>", (unsigned int)cfg->steps);
    httpd_resp_sendstr_chunk(req, buf);

    /* Список ступеней */
    for (uint16_t s = 0; s < cfg->steps; s++)
    {
        bool on = staircase_led_step_is_on(s);
        snprintf(buf, sizeof(buf),
            "<div class='step-row'>"
            "<span>Ступень #%u</span>"
            "<div>"
            "<span class='badge %s' id='step-badge-%u'>%s</span> "
            "<button class='btn btn-sm' onclick=\"fetch('/api/trigger?dir=toggle&step=%u').then(updateState)\">Переключить</button>"
            "</div>"
            "</div>",
            (unsigned int)(s + 1),
            on ? "badge-green" : "badge-red",
            (unsigned int)s,
            on ? "ВКЛ" : "ВЫКЛ",
            (unsigned int)s
        );
        httpd_resp_sendstr_chunk(req, buf);
    }

    const char *script =
        "</div></div>"
        "<script>"
        "function updateState(){"
        "fetch('/api/state').then(r=>r.json()).then(d=>{"
        "document.getElementById('stair-state').innerText=d.state;"
        "document.getElementById('hold-time').innerText=d.hold_ms+' мс';"
        "if(d.current_time){document.getElementById('clock-time').innerText=d.current_time+(d.time_synced?' (NTP)':' (RTC)');}"
        "if(d.sunrise){document.getElementById('sun-rise').innerText=d.sunrise;}"
        "if(d.sunset){document.getElementById('sun-set').innerText=d.sunset;}"
        "var nb=document.getElementById('night-badge');"
        "if(nb){nb.className='badge '+(d.is_night?'badge-blue':'badge-green');nb.innerText=d.is_night?'НОЧНОЙ РЕЖИМ':'ДНЕВНОЙ РЕЖИМ';}"
        "if(d.next_switch){document.getElementById('next-switch-txt').innerText='Авто-переключение: '+d.next_switch;}"
        "var sb=document.getElementById('sensor-bottom');"
        "sb.className='badge '+(d.bottom_sensor?'badge-green':'badge-red');"
        "sb.innerText=d.bottom_sensor?'АКТИВЕН':'НЕТ';"
        "var st=document.getElementById('sensor-top');"
        "st.className='badge '+(d.top_sensor?'badge-green':'badge-red');"
        "st.innerText=d.top_sensor?'АКТИВЕН':'НЕТ';"
        "if(d.steps){d.steps.forEach((on,i)=>{"
        "var el=document.getElementById('step-badge-'+i);"
        "if(el){el.className='badge '+(on?'badge-green':'badge-red');el.innerText=on?'ВКЛ':'ВЫКЛ';}"
        "});}"
        "});}"
        "setInterval(updateState,800);"
        "updateState();"
        "</script>";
    httpd_resp_sendstr_chunk(req, script);

    return web_send_html_footer(req);
}
