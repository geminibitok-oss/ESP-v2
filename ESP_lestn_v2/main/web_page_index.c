#include "web_routes.h"

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
    snprintf(buf, sizeof(buf), "<p>Статус FSM: <span id='stair-state' class='badge badge-blue'>%s</span></p>", staircase_get_state_str_ru());
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

    snprintf(buf, sizeof(buf), "<p>⏱ Таймер удержания света: <strong id='hold-time' style='color:#38bdf8'>%.1f сек</strong></p>", (float)staircase_get_hold_remaining_ms() / 1000.0f);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:12px;border-radius:8px;text-align:center'>"
        "<div style='font-weight:600;margin-bottom:4px'>Нижний датчик</div>"
        "<span id='sensor-bottom' class='badge badge-red'>НЕТ</span>"
        "<div id='dist-box-bottom' style='display:none;font-size:12px;color:#38bdf8;margin-top:6px;font-family:monospace'>"
        "📏 Дистанция: <strong id='dist-bottom'>--</strong> см"
        "</div>"
        "</div>"
        "<div style='background:#0f172a;padding:12px;border-radius:8px;text-align:center'>"
        "<div style='font-weight:600;margin-bottom:4px'>Верхний датчик</div>"
        "<span id='sensor-top' class='badge badge-red'>НЕТ</span>"
        "<div id='dist-box-top' style='display:none;font-size:12px;color:#38bdf8;margin-top:6px;font-family:monospace'>"
        "📏 Дистанция: <strong id='dist-top'>--</strong> см"
        "</div>"
        "</div>"
        "</div>"
    );

    /* КНОПКИ УПРАВЛЕНИЯ (БЕЗ КНОПКИ СБРОСА ДАТЧИКОВ) */
    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<button class='btn btn-success' onclick=\"fetch('/api/trigger?dir=bottom').then(updateState)\">🚶 Пройти снизу (Тест)</button>"
        "<button class='btn btn-success' onclick=\"fetch('/api/trigger?dir=top').then(updateState)\">🚶 Пройти сверху (Тест)</button>"
        "<button class='btn' onclick=\"fetch('/api/trigger?dir=all_on').then(updateState)\">💡 Включить всё</button>"
        "<button class='btn btn-danger' onclick=\"fetch('/api/trigger?dir=all_off').then(updateState)\">🌑 Выключить всё</button>"
        "</div>"
        "<div style='margin-top:10px'>"
        "<button id='party-btn' class='btn' style='width:100%;padding:12px;font-size:15px;background:#a855f7' onclick=\"handlePartyClick()\">🎉 Режим «Праздник» (Бесконечный эффект)</button>"
        "</div>"
        "</div>"
    );

    /* ВСПЛЫВАЮЩЕЕ ОКНО (МОДАЛКА) ВЫБОРА РЕЖИМА ПРАЗДНИКА */
    httpd_resp_sendstr_chunk(req,
        "<div id='party-modal' style='display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:16px'>"
        "<div style='background:#1e293b;border:1px solid #3b82f6;border-radius:12px;max-width:440px;width:100%;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.8)'>"
        "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:14px'>"
        "<h3 style='margin:0;font-size:18px;color:#f8fafc'>🎉 Выбор эффекта праздника</h3>"
        "<button type='button' style='background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer' onclick='closePartyModal()'>✕</button>"
        "</div>"
        "<p style='font-size:13px;color:#cbd5e1;margin-bottom:14px'>Выберите анимацию, которая будет бесконечно переливаться на лестнице:</p>"
        "<div style='display:grid;gap:8px;margin-bottom:18px'>"
        "<button class='btn' style='background:#6366f1;text-align:left;padding:10px 14px' onclick='startParty(0)'>🌈 1. Радужный плавный перелив</button>"
        "<button class='btn' style='background:#06b6d4;text-align:left;padding:10px 14px' onclick='startParty(1)'>🌌 2. Северное сияние (Аврора)</button>"
        "<button class='btn' style='background:#f97316;text-align:left;padding:10px 14px' onclick='startParty(2)'>🔥 3. Живой огонь / Лава</button>"
        "<button class='btn' style='background:#ec4899;text-align:left;padding:10px 14px' onclick='startParty(3)'>⚡ 4. Неоновый пульс (Cyber Wave)</button>"
        "<button class='btn' style='background:#eab308;color:#000;text-align:left;padding:10px 14px' onclick='startParty(4)'>✨ 5. Мерцание звезд (Золотой шиммер)</button>"
        "<button class='btn' style='background:#10b981;text-align:left;padding:10px 14px' onclick='startParty(5)'>🌊 6. Бегущая волна (Основной цвет)</button>"
        "</div>"
        "<div style='text-align:right'>"
        "<button type='button' class='btn btn-sm' style='background:#475569' onclick='closePartyModal()'>Отмена</button>"
        "</div>"
        "</div></div>"
    );

    snprintf(buf, sizeof(buf), "<div class='card'><h2>Ступени (%u шт.)</h2><div id='steps-list'>", (unsigned int)cfg->steps);
    httpd_resp_sendstr_chunk(req, buf);

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
        "var isPartyActive = false;"
        "function handlePartyClick(){"
        "  if (isPartyActive) {"
        "    fetch('/api/trigger?dir=party_off').then(updateState);"
        "  } else {"
        "    document.getElementById('party-modal').style.display = 'flex';"
        "  }"
        "}"
        "function closePartyModal(){"
        "  document.getElementById('party-modal').style.display = 'none';"
        "}"
        "function startParty(effId){"
        "  closePartyModal();"
        "  fetch('/api/trigger?dir=party_on&eff=' + effId).then(updateState);"
        "}"
        "function updateState(){"
        "  fetch('/api/state').then(function(r){return r.json();}).then(function(d){"
        "    document.getElementById('stair-state').innerText = d.state;"
        "    var pBtn = document.getElementById('party-btn');"
        "    if(pBtn && d.is_party !== undefined){"
        "      isPartyActive = d.is_party;"
        "      pBtn.innerText = d.is_party ? '🛑 Отключить режим «Праздник»' : '🎉 Режим «Праздник» (Бесконечный эффект)';"
        "      pBtn.style.background = d.is_party ? '#dc2626' : '#a855f7';"
        "    }"
        "    document.getElementById('hold-time').innerText = (d.hold_ms > 0 ? (d.hold_ms / 1000).toFixed(1) + ' сек' : '0.0 сек');"
        "    if(d.current_time){ document.getElementById('clock-time').innerText = d.current_time + (d.time_synced ? ' (NTP)' : ' (RTC)'); }"
        "    if(d.sunrise){ document.getElementById('sun-rise').innerText = d.sunrise; }"
        "    if(d.sunset){ document.getElementById('sun-set').innerText = d.sunset; }"
        "    var nb = document.getElementById('night-badge');"
        "    if(nb){ nb.className = 'badge ' + (d.is_night ? 'badge-blue' : 'badge-green'); nb.innerText = d.is_night ? 'НОЧНОЙ РЕЖИМ' : 'ДНЕВНОЙ РЕЖИМ'; }"
        "    if(d.next_switch){ document.getElementById('next-switch-txt').innerText = 'Авто-переключение: ' + d.next_switch; }"
        "    var sb = document.getElementById('sensor-bottom');"
        "    sb.className = 'badge ' + (d.bottom_sensor ? 'badge-green' : 'badge-red');"
        "    sb.innerText = d.bottom_sensor ? 'АКТИВЕН' : 'НЕТ';"
        "    var st = document.getElementById('sensor-top');"
        "    st.className = 'badge ' + (d.top_sensor ? 'badge-green' : 'badge-red');"
        "    st.innerText = d.top_sensor ? 'АКТИВЕН' : 'НЕТ';"
        "    var bBox = document.getElementById('dist-box-bottom');"
        "    var bVal = document.getElementById('dist-bottom');"
        "    if(bBox && bVal){"
        "      if(d.sensor_bottom_type === 1){"
        "        bBox.style.display = 'block';"
        "        bVal.innerText = (d.bottom_dist >= 400 || d.bottom_dist === 999) ? '>400' : d.bottom_dist;"
        "      } else { bBox.style.display = 'none'; }"
        "    }"
        "    var tBox = document.getElementById('dist-box-top');"
        "    var tVal = document.getElementById('dist-top');"
        "    if(tBox && tVal){"
        "      if(d.sensor_top_type === 1){"
        "        tBox.style.display = 'block';"
        "        tVal.innerText = (d.top_dist >= 400 || d.top_dist === 999) ? '>400' : d.top_dist;"
        "      } else { tBox.style.display = 'none'; }"
        "    }"
        "    if(d.steps){"
        "      d.steps.forEach(function(on, i){"
        "        var el = document.getElementById('step-badge-' + i);"
        "        if(el){ el.className = 'badge ' + (on ? 'badge-green' : 'badge-red'); el.innerText = on ? 'ВКЛ' : 'ВЫКЛ'; }"
        "      });"
        "    }"
        "  });"
        "}"
        "setInterval(updateState, 800);"
        "updateState();"
        "</script>";

    httpd_resp_sendstr_chunk(req, script);

    return web_send_html_footer(req);
}
