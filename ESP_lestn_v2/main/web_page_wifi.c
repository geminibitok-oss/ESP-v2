#include "web_routes.h"

static const char *TAG = "WEB_WIFI";
static staircase_settings_t *cfg = NULL;

void web_wifi_set_settings(staircase_settings_t *settings)
{
    cfg = settings;
}

esp_err_t wifi_get_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    web_send_html_header(req, "Настройка Wi-Fi");

    httpd_resp_sendstr_chunk(req, "<div class='card'><h2>Сеть Wi-Fi</h2>");

    char buf[1024];
    snprintf(buf, sizeof(buf),
        "<p>Текущий IP: <strong>%s</strong> (%s)</p><form method='POST' action='/wifi'>",
        wifi_manager_get_ip(),
        wifi_manager_is_ap_mode() ? "Точка доступа" : "Подключено к роутеру"
    );
    httpd_resp_sendstr_chunk(req, buf);

    snprintf(buf, sizeof(buf),
        "<div class='form-group'><label>Имя сети (SSID)</label><input type='text' name='ssid' value='%s' required></div>",
        cfg->wifi_ssid
    );
    httpd_resp_sendstr_chunk(req, buf);

    snprintf(buf, sizeof(buf),
        "<div class='form-group'><label>Пароль</label><input type='password' name='pass' value='%s' placeholder='••••••••'></div>",
        cfg->wifi_password
    );
    httpd_resp_sendstr_chunk(req, buf);

    snprintf(buf, sizeof(buf),
        "<div class='form-group'><label>Имя устройства (mDNS)</label><input type='text' name='hostname' value='%s'></div>",
        cfg->hostname
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<button type='submit' class='btn btn-success' style='width:100%;margin-top:10px'>💾 Сохранить и перезагрузить</button>"
        "</form>"
        "</div>"
    );

    return web_send_html_footer(req);
}

esp_err_t wifi_post_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    char post_buf[512] = {0};
    int total_len = req->content_len;
    if (total_len >= (int)sizeof(post_buf)) total_len = (int)sizeof(post_buf) - 1;

    int cur_len = 0;
    while (cur_len < total_len) {
        int received = httpd_req_recv(req, post_buf + cur_len, total_len - cur_len);
        if (received <= 0) break;
        cur_len += received;
    }
    post_buf[cur_len] = '\0';

    web_get_post_param(post_buf, "ssid", cfg->wifi_ssid, sizeof(cfg->wifi_ssid));
    web_get_post_param(post_buf, "pass", cfg->wifi_password, sizeof(cfg->wifi_password));
    web_get_post_param(post_buf, "hostname", cfg->hostname, sizeof(cfg->hostname));

    settings_save(cfg);
    ESP_LOGI(TAG, "Wi-Fi settings saved, rebooting to connect to '%s'...", cfg->wifi_ssid);

    web_send_html_header(req, "Перезагрузка...");
    httpd_resp_sendstr_chunk(req,
        "<div class='card'>"
        "<h2>Настройки Wi-Fi сохранены!</h2>"
        "<p>Устройство перезагружается для подключения к сети...</p>"
        "<p>Пожалуйста, подождите 10 секунд.</p>"
        "</div>"
    );
    web_send_html_footer(req);

    web_schedule_restart(1500);
    return ESP_OK;
}
