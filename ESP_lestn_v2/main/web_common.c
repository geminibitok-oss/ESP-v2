#include "web_common.h"

static const char *TAG = "WEB_COMMON";

static void restart_timer_cb(void *arg)
{
    ESP_LOGI(TAG, "Rebooting system now...");
    esp_restart();
}

void web_schedule_restart(uint32_t delay_ms)
{
    esp_timer_create_args_t timer_args = {
        .callback = restart_timer_cb,
        .name = "restart_timer"
    };
    esp_timer_handle_t timer;
    if (esp_timer_create(&timer_args, &timer) == ESP_OK) {
        esp_timer_start_once(timer, (uint64_t)delay_ms * 1000);
    }
}

void web_url_decode(char *dst, const char *src, size_t max_len)
{
    char a, b;
    size_t written = 0;
    while (*src && written < max_len - 1)
    {
        if (*src == '%' &&
            ((a = src[1]) && (b = src[2])) &&
            (isxdigit((int)a) && isxdigit((int)b)))
        {
            if (a >= 'a') a -= 'a' - 'A';
            if (a >= 'A') a -= ('A' - 10);
            else a -= '0';

            if (b >= 'a') b -= 'a' - 'A';
            if (b >= 'A') b -= ('A' - 10);
            else b -= '0';

            *dst++ = (char)(16 * a + b);
            src += 3;
        }
        else if (*src == '+')
        {
            *dst++ = ' ';
            src++;
        }
        else
        {
            *dst++ = *src++;
        }
        written++;
    }
    *dst = '\0';
}

bool web_get_post_param(const char *buf, const char *key, char *dest, size_t dest_len)
{
    char search_key[64];
    snprintf(search_key, sizeof(search_key), "%s=", key);

    const char *start = strstr(buf, search_key);
    if (!start && strncmp(buf, search_key, strlen(search_key)) != 0) {
        return false;
    }
    if (!start) start = buf;

    start += strlen(search_key);
    const char *end = strchr(start, '&');
    size_t len = end ? (size_t)(end - start) : strlen(start);

    char temp[128];
    if (len >= sizeof(temp)) len = sizeof(temp) - 1;
    strncpy(temp, start, len);
    temp[len] = '\0';

    web_url_decode(dest, temp, dest_len);
    return true;
}

int web_get_post_param_int(const char *buf, const char *key, int default_val)
{
    char str[32];
    if (web_get_post_param(buf, key, str, sizeof(str))) {
        return atoi(str);
    }
    return default_val;
}

float web_get_post_param_float(const char *buf, const char *key, float default_val)
{
    char str[32];
    if (web_get_post_param(buf, key, str, sizeof(str))) {
        return (float)atof(str);
    }
    return default_val;
}

esp_err_t web_send_html_header(httpd_req_t *req, const char *title)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    
    httpd_resp_sendstr_chunk(req,
        "<!DOCTYPE html><html lang='ru'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    );

    char chunk[256];
    snprintf(chunk, sizeof(chunk), "<title>%s | ESP Lestn v2</title>", title);
    httpd_resp_sendstr_chunk(req, chunk);

    httpd_resp_sendstr_chunk(req,
        "<style>"
        "body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:0;padding:16px;background:#0f172a;color:#f8fafc;line-height:1.5}"
        ".wrap{max-width:680px;margin:0 auto}"
        ".card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 4px 12px rgba(0,0,0,0.3);border:1px solid #334155}"
        "h1,h2,h3{margin:0 0 12px 0;font-weight:600}"
        "h1{font-size:22px;color:#38bdf8}h2{font-size:18px;color:#cbd5e1}"
        ".nav{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}"
        ".nav a{padding:8px 16px;border-radius:8px;background:#334155;color:#f8fafc;text-decoration:none;font-size:14px;font-weight:500}"
        ".nav a.active{background:#0284c7;color:#fff}"
        ".btn{display:inline-block;padding:10px 18px;border-radius:8px;border:none;background:#0284c7;color:#fff;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center}"
        ".btn-sm{padding:6px 12px;font-size:12px}"
        ".btn-danger{background:#dc2626}.btn-success{background:#16a34a}.btn-warning{background:#d97706}"
        ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}"
        ".form-group{margin-bottom:14px}"
        "label{display:block;margin-bottom:4px;font-size:13px;color:#94a3b8;font-weight:500}"
        "input,select{width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#f8fafc;font-size:14px}"
        ".badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:12px;font-weight:600}"
        ".badge-green{background:#064e3b;color:#34d399}.badge-red{background:#7f1d1d;color:#f87171}.badge-blue{background:#0c4a6e;color:#38bdf8}"
        ".step-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155}"
        ".step-row:last-child{border-bottom:none}"
        "</style></head><body><div class='wrap'>"
        "<h1>✨ Умная лестница ESP-Lestn v2</h1>"
        "<div class='nav'>"
        "<a href='/'>Главная</a>"
        "<a href='/settings'>Настройки</a>"
        "<a href='/wifi'>Wi-Fi</a>"
        "</div>"
    );
    return ESP_OK;
}

esp_err_t web_send_html_footer(httpd_req_t *req)
{
    httpd_resp_sendstr_chunk(req, "</div></body></html>");
    return httpd_resp_sendstr_chunk(req, NULL);
}
