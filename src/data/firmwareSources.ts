export interface FirmwareFile {
  name: string;
  path: string;
  category: 'core' | 'driver' | 'web' | 'config';
  description: string;
  code: string;
}

export const FIRMWARE_FILES: FirmwareFile[] = [
  {
    name: 'main.c',
    path: 'main/main.c',
    category: 'core',
    description: 'Главная точка входа. Инициализирует NVS, настройки, LED, датчики, Wi-Fi и запускает FreeRTOS задачи.',
    code: `#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "esp_event.h"
#include "esp_netif.h"

#include "settings.h"
#include "staircase_led.h"
#include "sensors.h"
#include "staircase.h"
#include "wifi_manager.h"
#include "web_server.h"

static const char *TAG = "STAIR_MAIN";

void app_main(void)
{
    // Отключаем спам внутренних предупреждений Wi-Fi драйвера
    esp_log_level_set("wifi", ESP_LOG_ERROR);
    esp_log_level_set("wifi_init", ESP_LOG_ERROR);

    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "   ESP32 Smart Staircase Controller    ");
    ESP_LOGI(TAG, "              Version 2.0               ");
    ESP_LOGI(TAG, "========================================");

    // 1. Инициализация NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // 2. Инициализация сетевого стека
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // 3. Загрузка настроек
    staircase_settings_t settings;
    settings_init(&settings);
    settings_load(&settings);

    // 4. Инициализация аппаратных компонентов
    ESP_ERROR_CHECK(staircase_led_init(&settings));
    ESP_ERROR_CHECK(sensors_init(&settings));

    // 5. Инициализация и запуск конечного автомата лестницы
    ESP_ERROR_CHECK(staircase_init(&settings));

    // 6. Запуск Wi-Fi
    ESP_ERROR_CHECK(wifi_manager_init(&settings));

    // 7. Запуск веб-сервера
    ESP_ERROR_CHECK(web_server_start(&settings));

    ESP_LOGI(TAG, "Staircase system started successfully! Free heap: %lu bytes", esp_get_free_heap_size());
}`
  },
  {
    name: 'staircase.h',
    path: 'main/staircase.h',
    category: 'core',
    description: 'Интерфейс конечного автомата (FSM) управления сценариями лестницы.',
    code: `#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

typedef enum {
    STAIRCASE_STATE_IDLE = 0,
    STAIRCASE_STATE_ON_UP,
    STAIRCASE_STATE_ON_DOWN,
    STAIRCASE_STATE_HOLD,
    STAIRCASE_STATE_OFF_UP,
    STAIRCASE_STATE_OFF_DOWN,
    STAIRCASE_STATE_MANUAL
} staircase_state_t;

esp_err_t staircase_init(staircase_settings_t *settings);
void staircase_apply_settings(const staircase_settings_t *settings);
staircase_state_t staircase_get_state(void);
const char *staircase_get_state_str(void);
uint32_t staircase_get_hold_remaining_ms(void);

void staircase_trigger_bottom(void);
void staircase_trigger_top(void);
void staircase_set_manual_on(void);
void staircase_set_manual_off(void);
void staircase_reset_sensors(void);`
  },
  {
    name: 'staircase.c',
    path: 'main/staircase.c',
    category: 'core',
    description: 'Реализация FSM лестницы (анимация снизу вверх / сверху вниз, удержание, ночной режим).',
    code: `#include "staircase.h"
#include "staircase_led.h"
#include "sensors.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "STAIR_FSM";

static staircase_settings_t cfg;
static staircase_state_t current_state = STAIRCASE_STATE_IDLE;
static int64_t hold_start_time = 0;
static TaskHandle_t fsm_task_handle = NULL;

static const char* state_names[] = {
    "IDLE",
    "ON_UP",
    "ON_DOWN",
    "HOLD",
    "OFF_UP",
    "OFF_DOWN",
    "MANUAL"
};

const char *staircase_get_state_str(void)
{
    return state_names[current_state];
}

staircase_state_t staircase_get_state(void)
{
    return current_state;
}

uint32_t staircase_get_hold_remaining_ms(void)
{
    if (current_state != STAIRCASE_STATE_HOLD) return 0;
    int64_t elapsed = (esp_timer_get_time() - hold_start_time) / 1000;
    if (elapsed >= cfg.hold_time_ms) return 0;
    return (uint32_t)(cfg.hold_time_ms - elapsed);
}

void staircase_apply_settings(const staircase_settings_t *settings)
{
    cfg = *settings;
    ESP_LOGI(TAG, "Settings applied to FSM");
}

void staircase_trigger_bottom(void)
{
    if (current_state == STAIRCASE_STATE_IDLE || current_state == STAIRCASE_STATE_OFF_UP || current_state == STAIRCASE_STATE_OFF_DOWN) {
        current_state = STAIRCASE_STATE_ON_UP;
        ESP_LOGI(TAG, "Triggered from BOTTOM -> state: ON_UP");
    } else if (current_state == STAIRCASE_STATE_HOLD) {
        hold_start_time = esp_timer_get_time();
        ESP_LOGI(TAG, "Hold time reset by BOTTOM sensor");
    }
}

void staircase_trigger_top(void)
{
    if (current_state == STAIRCASE_STATE_IDLE || current_state == STAIRCASE_STATE_OFF_UP || current_state == STAIRCASE_STATE_OFF_DOWN) {
        current_state = STAIRCASE_STATE_ON_DOWN;
        ESP_LOGI(TAG, "Triggered from TOP -> state: ON_DOWN");
    } else if (current_state == STAIRCASE_STATE_HOLD) {
        hold_start_time = esp_timer_get_time();
        ESP_LOGI(TAG, "Hold time reset by TOP sensor");
    }
}

void staircase_set_manual_on(void)
{
    current_state = STAIRCASE_STATE_MANUAL;
    staircase_led_all_on(cfg.brightness, cfg.color_r, cfg.color_g, cfg.color_b);
    ESP_LOGI(TAG, "Manual ALL ON activated");
}

void staircase_set_manual_off(void)
{
    current_state = STAIRCASE_STATE_IDLE;
    staircase_led_all_off();
    ESP_LOGI(TAG, "Manual ALL OFF activated");
}

static void fsm_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Staircase FSM Task started");

    while (1)
    {
        switch (current_state)
        {
            case STAIRCASE_STATE_IDLE:
                if (sensor_bottom_active()) {
                    staircase_trigger_bottom();
                } else if (sensor_top_active()) {
                    staircase_trigger_top();
                }
                vTaskDelay(pdMS_TO_TICKS(50));
                break;

            case STAIRCASE_STATE_ON_UP:
                for (uint16_t step = 0; step < cfg.steps; step++) {
                    staircase_led_set_step(step, true, cfg.brightness, cfg.color_r, cfg.color_g, cfg.color_b);
                    vTaskDelay(pdMS_TO_TICKS(cfg.step_on_time_ms));
                    if (current_state == STAIRCASE_STATE_MANUAL) break;
                }
                if (current_state == STAIRCASE_STATE_ON_UP) {
                    current_state = STAIRCASE_STATE_HOLD;
                    hold_start_time = esp_timer_get_time();
                    ESP_LOGI(TAG, "All steps turned ON (UP) -> entering HOLD");
                }
                break;

            case STAIRCASE_STATE_ON_DOWN:
                for (int step = (int)cfg.steps - 1; step >= 0; step--) {
                    staircase_led_set_step((uint16_t)step, true, cfg.brightness, cfg.color_r, cfg.color_g, cfg.color_b);
                    vTaskDelay(pdMS_TO_TICKS(cfg.step_on_time_ms));
                    if (current_state == STAIRCASE_STATE_MANUAL) break;
                }
                if (current_state == STAIRCASE_STATE_ON_DOWN) {
                    current_state = STAIRCASE_STATE_HOLD;
                    hold_start_time = esp_timer_get_time();
                    ESP_LOGI(TAG, "All steps turned ON (DOWN) -> entering HOLD");
                }
                break;

            case STAIRCASE_STATE_HOLD:
                if (sensor_bottom_active() || sensor_top_active()) {
                    hold_start_time = esp_timer_get_time();
                }
                if (staircase_get_hold_remaining_ms() == 0) {
                    current_state = STAIRCASE_STATE_OFF_UP;
                    ESP_LOGI(TAG, "HOLD expired -> entering OFF_UP");
                }
                vTaskDelay(pdMS_TO_TICKS(50));
                break;

            case STAIRCASE_STATE_OFF_UP:
                for (uint16_t step = 0; step < cfg.steps; step++) {
                    if (sensor_bottom_active() || sensor_top_active()) {
                        current_state = STAIRCASE_STATE_HOLD;
                        hold_start_time = esp_timer_get_time();
                        staircase_led_all_on(cfg.brightness, cfg.color_r, cfg.color_g, cfg.color_b);
                        break;
                    }
                    staircase_led_set_step(step, false, 0, 0, 0, 0);
                    vTaskDelay(pdMS_TO_TICKS(cfg.step_off_time_ms));
                }
                if (current_state == STAIRCASE_STATE_OFF_UP) {
                    current_state = STAIRCASE_STATE_IDLE;
                    staircase_led_all_off();
                    ESP_LOGI(TAG, "Finished turning OFF -> IDLE");
                }
                break;

            case STAIRCASE_STATE_OFF_DOWN:
                for (int step = (int)cfg.steps - 1; step >= 0; step--) {
                    if (sensor_bottom_active() || sensor_top_active()) {
                        current_state = STAIRCASE_STATE_HOLD;
                        hold_start_time = esp_timer_get_time();
                        staircase_led_all_on(cfg.brightness, cfg.color_r, cfg.color_g, cfg.color_b);
                        break;
                    }
                    staircase_led_set_step((uint16_t)step, false, 0, 0, 0, 0);
                    vTaskDelay(pdMS_TO_TICKS(cfg.step_off_time_ms));
                }
                if (current_state == STAIRCASE_STATE_OFF_DOWN) {
                    current_state = STAIRCASE_STATE_IDLE;
                    staircase_led_all_off();
                    ESP_LOGI(TAG, "Finished turning OFF -> IDLE");
                }
                break;

            case STAIRCASE_STATE_MANUAL:
                vTaskDelay(pdMS_TO_TICKS(100));
                break;
        }
    }
}

esp_err_t staircase_init(staircase_settings_t *settings)
{
    cfg = *settings;
    xTaskCreate(fsm_task, "stair_fsm_task", 4096, NULL, 5, &fsm_task_handle);
    return ESP_OK;
}

void staircase_reset_sensors(void)
{
    ESP_LOGI(TAG, "Manual sensor reset requested");
    current_state = STAIRCASE_STATE_IDLE;
    if (cfg.night_mode) {
        staircase_led_apply_night_mode(&cfg);
    } else {
        staircase_led_clear();
    }
}`
  },
  {
    name: 'staircase_led.h',
    path: 'main/staircase_led.h',
    category: 'driver',
    description: 'Интерфейс драйвера светодиодной ленты WS2812B (ESP-IDF led_strip RMT).',
    code: `#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t staircase_led_init(const staircase_settings_t *settings);
void staircase_led_set_step(uint16_t step_idx, bool on, uint8_t brightness, uint8_t r, uint8_t g, uint8_t b);
void staircase_led_toggle_step(uint16_t step_idx);
bool staircase_led_step_is_on(uint16_t step_idx);
void staircase_led_all_on(uint8_t brightness, uint8_t r, uint8_t g, uint8_t b);
void staircase_led_all_off(void);
void staircase_led_clear(void);`
  },
  {
    name: 'led_strip.c',
    path: 'main/led_strip.c',
    category: 'driver',
    description: 'Драйвер адресной светодиодной ленты WS2812B через ESP-IDF RMT драйвер.',
    code: `#include "staircase_led.h"
#include "led_strip.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "LED_STRIP";

static led_strip_handle_t led_strip = NULL;
static uint16_t total_leds = 0;
static uint16_t num_steps = 0;
static uint16_t leds_per_step = 0;
static bool *step_states = NULL;

esp_err_t staircase_led_init(const staircase_settings_t *settings)
{
    num_steps = settings->steps;
    leds_per_step = settings->pixels_per_step;
    total_leds = num_steps * leds_per_step;

    if (step_states) {
        free(step_states);
    }
    step_states = (bool*)calloc(num_steps, sizeof(bool));

    led_strip_config_t strip_config = {
        .strip_gpio_num = settings->led_gpio,
        .max_leds = total_leds,
        .led_model = LED_MODEL_WS2812,
        .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
        .flags = {
            .invert_out = false,
        }
    };

    led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10 * 1000 * 1000,
        .flags = {
            .with_dma = false,
        }
    };

    ESP_ERROR_CHECK(led_strip_new_rmt_device(&strip_config, &rmt_config, &led_strip));
    led_strip_clear(led_strip);
    ESP_LOGI(TAG, "LED strip initialized: %d steps, %d pixels/step, total %d pixels on GPIO %d",
             num_steps, leds_per_step, total_leds, settings->led_gpio);
    return ESP_OK;
}

void staircase_led_set_step(uint16_t step_idx, bool on, uint8_t brightness, uint8_t r, uint8_t g, uint8_t b)
{
    if (!led_strip || step_idx >= num_steps) return;

    step_states[step_idx] = on;
    uint16_t start_led = step_idx * leds_per_step;

    uint8_t adj_r = on ? (uint8_t)((r * brightness) / 100) : 0;
    uint8_t adj_g = on ? (uint8_t)((g * brightness) / 100) : 0;
    uint8_t adj_b = on ? (uint8_t)((b * brightness) / 100) : 0;

    for (uint16_t i = 0; i < leds_per_step; i++) {
        led_strip_set_pixel(led_strip, start_led + i, adj_r, adj_g, adj_b);
    }
    led_strip_refresh(led_strip);
}

void staircase_led_toggle_step(uint16_t step_idx)
{
    if (step_idx >= num_steps) return;
    bool current = step_states[step_idx];
    staircase_led_set_step(step_idx, !current, 80, 255, 255, 255);
}

bool staircase_led_step_is_on(uint16_t step_idx)
{
    if (!step_states || step_idx >= num_steps) return false;
    return step_states[step_idx];
}

void staircase_led_all_on(uint8_t brightness, uint8_t r, uint8_t g, uint8_t b)
{
    if (!led_strip) return;
    uint8_t adj_r = (uint8_t)((r * brightness) / 100);
    uint8_t adj_g = (uint8_t)((g * brightness) / 100);
    uint8_t adj_b = (uint8_t)((b * brightness) / 100);

    for (uint16_t i = 0; i < total_leds; i++) {
        led_strip_set_pixel(led_strip, i, adj_r, adj_g, adj_b);
    }
    for (uint16_t s = 0; s < num_steps; s++) {
        step_states[s] = true;
    }
    led_strip_refresh(led_strip);
}

void staircase_led_all_off(void)
{
    if (!led_strip) return;
    led_strip_clear(led_strip);
    if (step_states) {
        memset(step_states, 0, num_steps * sizeof(bool));
    }
}

void staircase_led_clear(void)
{
    staircase_led_all_off();
}`
  },
  {
    name: 'web_common.h',
    path: 'main/web_common.h',
    category: 'web',
    description: 'Общие функции веб-сервера (шаблонизатор страниц, URL-декодер, таймер перезагрузки).',
    code: `#ifndef WEB_COMMON_H
#define WEB_COMMON_H

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include <ctype.h>

#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "esp_timer.h"

#include "settings.h"
#include "staircase_led.h"
#include "staircase.h"
#include "sensors.h"
#include "wifi_manager.h"

#ifdef __cplusplus
extern "C" {
#endif

void web_url_decode(char *dst, const char *src, size_t max_len);
bool web_get_post_param(const char *buf, const char *key, char *dest, size_t dest_len);
int web_get_post_param_int(const char *buf, const char *key, int default_val);
void web_schedule_restart(uint32_t delay_ms);

esp_err_t web_send_html_header(httpd_req_t *req, const char *title);
esp_err_t web_send_html_footer(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_COMMON_H`
  },
  {
    name: 'web_common.c',
    path: 'main/web_common.c',
    category: 'web',
    description: 'Реализация общих утилит HTTP-сервера и HTML-лейаута.',
    code: `#include "web_common.h"

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
        "<a href='/update'>OTA Обновление</a>"
        "</div>"
    );
    return ESP_OK;
}

esp_err_t web_send_html_footer(httpd_req_t *req)
{
    httpd_resp_sendstr_chunk(req, "</div></body></html>");
    return httpd_resp_sendstr_chunk(req, NULL);
}`
  },
  {
    name: 'web_routes.h',
    path: 'main/web_routes.h',
    category: 'web',
    description: 'Интерфейсы отдельных обработчиков HTTP-маршрутов.',
    code: `#ifndef WEB_ROUTES_H
#define WEB_ROUTES_H

#include "web_common.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Главная страница */
esp_err_t index_handler(httpd_req_t *req);

/* Настройки */
esp_err_t settings_get_handler(httpd_req_t *req);
esp_err_t settings_post_handler(httpd_req_t *req);

/* Wi-Fi */
esp_err_t wifi_get_handler(httpd_req_t *req);
esp_err_t wifi_post_handler(httpd_req_t *req);

/* REST API */
esp_err_t api_state_handler(httpd_req_t *req);
esp_err_t api_trigger_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_ROUTES_H`
  },
  {
    name: 'web_page_index.c',
    path: 'main/web_page_index.c',
    category: 'web',
    description: 'Обработчик главной страницы (дашборд состояния, кнопки ручного запуска ступеней).',
    code: `#include "web_routes.h"

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

    snprintf(buf, sizeof(buf), "<p>Таймер удержания: <strong id='hold-time'>%u мс</strong></p>", (unsigned int)staircase_get_hold_remaining_ms());
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='grid'><div style='background:#0f172a;padding:12px;border-radius:8px;text-align:center'><div>Нижний датчик</div>");
    snprintf(buf, sizeof(buf), "<span id='sensor-bottom' class='badge %s'>%s</span><div id='sensor-bottom-dist' style='font-size:11px;color:#94a3b8;margin-top:4px'>%s</div></div>",
        sensor_bottom_active() ? "badge-green" : "badge-red",
        sensor_bottom_active() ? "АКТИВЕН" : "НЕТ",
        sensor_is_ultrasonic() ? "HC-SR04" : "PIR / Оптика");
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div style='background:#0f172a;padding:12px;border-radius:8px;text-align:center'><div>Верхний датчик</div>");
    snprintf(buf, sizeof(buf), "<span id='sensor-top' class='badge %s'>%s</span><div id='sensor-top-dist' style='font-size:11px;color:#94a3b8;margin-top:4px'>%s</div></div></div>",
        sensor_top_active() ? "badge-green" : "badge-red",
        sensor_top_active() ? "АКТИВЕН" : "НЕТ",
        sensor_is_ultrasonic() ? "HC-SR04" : "PIR / Оптика");
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<div class='grid'>"
        "<button class='btn btn-success' onclick=\\"fetch('/api/trigger?dir=bottom').then(updateState)\\">🚶 Пройти снизу</button>"
        "<button class='btn btn-success' onclick=\\"fetch('/api/trigger?dir=top').then(updateState)\\">🚶 Пройти сверху</button>"
        "<button class='btn' onclick=\\"fetch('/api/trigger?dir=all_on').then(updateState)\\">💡 Включить всё</button>"
        "<button class='btn btn-danger' onclick=\\"fetch('/api/trigger?dir=all_off').then(updateState)\\">🌑 Выключить всё</button>"
        "</div>"
        "<div style='margin-top:8px'><button class='btn btn-warning' style='width:100%' onclick=\"fetch('/api/trigger?dir=reset_sensors').then(updateState)\">🔄 Сбросить состояние датчиков</button></div>"
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
            "<button class='btn btn-sm' onclick=\\"fetch('/api/trigger?dir=toggle&step=%u').then(updateState)\\">Переключить</button>"
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
        "var sb=document.getElementById('sensor-bottom');"
        "sb.className='badge '+(d.bottom_sensor?'badge-green':'badge-red');"
        "sb.innerText=d.bottom_sensor?'АКТИВЕН':'НЕТ';"
        "var st=document.getElementById('sensor-top');"
        "st.className='badge '+(d.top_sensor?'badge-green':'badge-red');"
        "st.innerText=d.top_sensor?'АКТИВЕН':'НЕТ';"
        "if(d.sensor_type===1){"
        "var d1=document.getElementById('sensor-bottom-dist');"
        "if(d1) d1.innerText='Дистанция: '+(d.bottom_dist_cm<900?d.bottom_dist_cm+' см':'--');"
        "var d2=document.getElementById('sensor-top-dist');"
        "if(d2) d2.innerText='Дистанция: '+(d.top_dist_cm<900?d.top_dist_cm+' см':'--');"
        "}"
        "if(d.steps){d.steps.forEach((on,i)=>{"
        "var el=document.getElementById('step-badge-'+i);"
        "if(el){el.className='badge '+(on?'badge-green':'badge-red');el.innerText=on?'ВКЛ':'ВЫКЛ';}"
        "});}"
        "});}"
        "setInterval(updateState,800);"
        "</script>";
    httpd_resp_sendstr_chunk(req, script);

    return web_send_html_footer(req);
}`
  },
  {
    name: 'web_page_settings.c',
    path: 'main/web_page_settings.c',
    category: 'web',
    description: 'Обработчик страницы настроек параметров лестницы, таймингов, GPIO и яркости.',
    code: `#include "web_routes.h"

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

    /* СЕКЦИЯ 3: Световые эффекты и тайминги */
    httpd_resp_sendstr_chunk(req,
        "<details class='st-sec'><summary>✨ 3. Световые эффекты и тайминги</summary><div class='sec-body'>"
        "<div class='grid'><div class='form-group'><label>Задержка включения (мс)</label>"
    );
    snprintf(buf, sizeof(buf), "<input type='number' name='step_on' value='%u' min='20' max='5000'></div>", (unsigned int)cfg->step_on_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Задержка выключения (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='step_off' value='%u' min='20' max='5000'></div>", (unsigned int)cfg->step_off_time_ms);
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req, "<div class='form-group'><label>Время удержания (мс)</label>");
    snprintf(buf, sizeof(buf), "<input type='number' name='hold' value='%u' min='500' max='60000'></div></div>", (unsigned int)cfg->hold_time_ms);
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
    cfg->hold_time_ms = (uint16_t)web_get_post_param_int(post_buf, "hold", cfg->hold_time_ms);

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
    httpd_resp_set_hdr(req, "Location", "/settings");
    return httpd_resp_send(req, NULL, 0);
}
`
  },
  {
    name: 'web_page_wifi.c',
    path: 'main/web_page_wifi.c',
    category: 'web',
    description: 'Обработчик страницы настройки Wi-Fi (SSID, пароль, mDNS имя, перезагрузка).',
    code: `#include "web_routes.h"

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

    snprintf(buf, sizeof(buf),
        "<p>Текущий IP: <strong>%s</strong> (%s)</p>"
        "<form id='wf' onsubmit='event.preventDefault();saveWifi();'>",
        wifi_manager_get_ip(),
        wifi_manager_is_ap_mode() ? "Точка доступа" : "Подключено к роутеру"
    );
    httpd_resp_sendstr_chunk(req, buf);

    snprintf(buf, sizeof(buf),
        "<div class='form-group'><label>Имя сети (SSID)</label><input type='text' id='ssid' name='ssid' value='%s' required></div>",
        cfg->wifi_ssid
    );
    httpd_resp_sendstr_chunk(req, buf);

    snprintf(buf, sizeof(buf),
        "<div class='form-group'><label>Пароль</label><input type='password' id='pass' name='pass' value='%s' placeholder='••••••••'></div>",
        cfg->wifi_password
    );
    httpd_resp_sendstr_chunk(req, buf);

    snprintf(buf, sizeof(buf),
        "<div class='form-group'><label>Имя устройства (mDNS)</label><input type='text' id='hostname' name='hostname' value='%s'></div>",
        cfg->hostname
    );
    httpd_resp_sendstr_chunk(req, buf);

    httpd_resp_sendstr_chunk(req,
        "<button type='submit' id='sbtn' class='btn btn-success' style='width:100%;margin-top:10px'>💾 Сохранить и перезагрузить</button>"
        "</form>"
        "<div id='res' style='display:none;margin-top:12px;padding:12px;background:#064e3b;border-radius:8px;color:#34d399;font-size:13px;text-align:center'>"
        "✅ Настройки сохранены! ESP32 перезагружается для подключения к сети..."
        "</div>"
        "<script>"
        "function saveWifi(){"
        "var b=document.getElementById('sbtn');b.disabled=true;b.innerText='Сохранение...';"
        "var s=document.getElementById('ssid').value;"
        "var p=document.getElementById('pass').value;"
        "var h=document.getElementById('hostname').value;"
        "var body='ssid='+encodeURIComponent(s)+'&pass='+encodeURIComponent(p)+'&hostname='+encodeURIComponent(h);"
        "var x=new XMLHttpRequest();x.open('POST','/wifi',true);"
        "x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');"
        "x.onload=function(){document.getElementById('wf').style.display='none';document.getElementById('res').style.display='block';};"
        "x.onerror=function(){document.getElementById('wf').style.display='none';document.getElementById('res').style.display='block';};"
        "x.send(body);"
        "}"
        "</script>"
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
}`
  },
  {
    name: 'web_api.c',
    path: 'main/web_api.c',
    category: 'web',
    description: 'REST API обработчики (/api/state получение JSON состояния, /api/trigger вызов анимаций).',
    code: `#include "web_routes.h"

static const char *TAG = "WEB_API";
static staircase_settings_t *cfg = NULL;

void web_api_set_settings(staircase_settings_t *settings)
{
    cfg = settings;
}

esp_err_t api_state_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    httpd_resp_set_type(req, "application/json");

    char json[1536];
    int offset = snprintf(json, sizeof(json),
        "{\"state\":\"%s\",\"hold_ms\":%u,\"bottom_sensor\":%s,\"top_sensor\":%s,\"sensor_type\":%u,\"bottom_dist_cm\":%u,\"top_dist_cm\":%u,\"heap\":%lu,\"steps\":[",
        staircase_get_state_str(),
        (unsigned int)staircase_get_hold_remaining_ms(),
        sensor_bottom_active() ? "true" : "false",
        sensor_top_active() ? "true" : "false",
        (unsigned int)cfg->sensor_type,
        (unsigned int)sensor_bottom_distance_cm(),
        (unsigned int)sensor_top_distance_cm(),
        (unsigned long)esp_get_free_heap_size()
    );

    for (uint16_t s = 0; s < cfg->steps && offset < (int)sizeof(json) - 16; s++) {
        bool on = staircase_led_step_is_on(s);
        offset += snprintf(json + offset, sizeof(json) - offset, "%s%s", s > 0 ? "," : "", on ? "true" : "false");
    }

    snprintf(json + offset, sizeof(json) - offset, "]}");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

esp_err_t api_trigger_handler(httpd_req_t *req)
{
    char query[128] = {0};
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK)
    {
        char dir[32] = {0};
        if (httpd_query_key_value(query, "dir", dir, sizeof(dir)) == ESP_OK)
        {
            if (strcmp(dir, "bottom") == 0) {
                staircase_trigger_bottom();
            } else if (strcmp(dir, "top") == 0) {
                staircase_trigger_top();
            } else if (strcmp(dir, "all_on") == 0) {
                staircase_set_manual_on();
            } else if (strcmp(dir, "all_off") == 0) {
                staircase_set_manual_off();
            } else if (strcmp(dir, "reset_sensors") == 0) {
                sensors_reset_state();
                staircase_reset_sensors();
            } else if (strcmp(dir, "toggle") == 0) {
                char step_str[16] = {0};
                if (httpd_query_key_value(query, "step", step_str, sizeof(step_str)) == ESP_OK) {
                    uint16_t step_idx = (uint16_t)atoi(step_str);
                    staircase_led_toggle_step(step_idx);
                }
            }
        }
    }

    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, "{\"status\":\"ok\"}");
}`
  },
  {
    name: 'web_server.c',
    path: 'main/web_server.c',
    category: 'web',
    description: 'Главная точка регистрации эндпоинтов и запуска HTTP сервера ESP-IDF.',
    code: `#include "web_server.h"
#include "web_routes.h"
#include "web_common.h"

static const char *TAG = "WEB_SERVER";
static httpd_handle_t server = NULL;

extern void web_index_set_settings(staircase_settings_t *settings);
extern void web_settings_set_settings(staircase_settings_t *settings);
extern void web_wifi_set_settings(staircase_settings_t *settings);
extern void web_api_set_settings(staircase_settings_t *settings);

esp_err_t web_server_start(staircase_settings_t *settings)
{
    web_index_set_settings(settings);
    web_settings_set_settings(settings);
    web_wifi_set_settings(settings);
    web_api_set_settings(settings);

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 16;
    config.stack_size = 8192;
    config.lru_purge_enable = true;
    config.max_resp_headers = 16;

    ESP_LOGI(TAG, "Starting HTTP Web Server on port %d...", config.server_port);

    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return err;
    }

    httpd_uri_t uri_index = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_get = { .uri = "/settings", .method = HTTP_GET, .handler = settings_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_post = { .uri = "/settings", .method = HTTP_POST, .handler = settings_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_get = { .uri = "/wifi", .method = HTTP_GET, .handler = wifi_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_post = { .uri = "/wifi", .method = HTTP_POST, .handler = wifi_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_state = { .uri = "/api/state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_trigger = { .uri = "/api/trigger", .method = HTTP_GET, .handler = api_trigger_handler, .user_ctx = NULL };

    /* OTA Обновление прошивки */
    httpd_uri_t uri_ota_page = { .uri = "/update", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_page_alt = { .uri = "/ota", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post = { .uri = "/api/ota", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post_update = { .uri = "/update", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_status = { .uri = "/api/ota/status", .method = HTTP_GET, .handler = ota_status_handler, .user_ctx = NULL };

    /* Для обратной совместимости */
    httpd_uri_t uri_led_state = { .uri = "/led-state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };

    httpd_register_uri_handler(server, &uri_index);
    httpd_register_uri_handler(server, &uri_settings_get);
    httpd_register_uri_handler(server, &uri_settings_post);
    httpd_register_uri_handler(server, &uri_wifi_get);
    httpd_register_uri_handler(server, &uri_wifi_post);
    httpd_register_uri_handler(server, &uri_api_state);
    httpd_register_uri_handler(server, &uri_api_trigger);
    httpd_register_uri_handler(server, &uri_ota_page);
    httpd_register_uri_handler(server, &uri_ota_page_alt);
    httpd_register_uri_handler(server, &uri_ota_post);
    httpd_register_uri_handler(server, &uri_ota_post_update);
    httpd_register_uri_handler(server, &uri_ota_status);
    httpd_register_uri_handler(server, &uri_led_state);

    ESP_LOGI(TAG, "Web server started with endpoints: /, /settings, /wifi, /update, /api/state, /api/ota");
    return ESP_OK;
}`
  },
  {
    name: 'web_server.h',
    path: 'main/web_server.h',
    category: 'web',
    description: 'Интерфейс веб-сервера управления.',
    code: `#pragma once

#include "esp_err.h"
#include "settings.h"

esp_err_t web_server_start(staircase_settings_t *settings);`
  },
  {
    name: 'sensors.h',
    path: 'main/sensors.h',
    category: 'driver',
    description: 'Интерфейс драйвера датчиков присутствия (цифровые PIR/оптические и ультразвуковые HC-SR04).',
    code: `#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t sensors_init(const staircase_settings_t *settings);
bool sensor_bottom_active(void);
bool sensor_top_active(void);
int sensor_bottom_level(void);
int sensor_top_level(void);

// Функции для работы с ультразвуковыми дальномерами HC-SR04
uint16_t sensor_bottom_distance_cm(void);
uint16_t sensor_top_distance_cm(void);
bool sensor_is_ultrasonic(void);
void sensors_reset_state(void);`
  },
  {
    name: 'sensors.c',
    path: 'main/sensors.c',
    category: 'driver',
    description: 'Драйвер датчиков присутствия: цифровой режим (PIR/оптика с подавлением дребезга) и ультразвуковой режим HC-SR04 (эхолокация в см с фильтрацией шумов).',
    code: `#include "sensors.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "SENSORS";

static staircase_settings_t cfg;
static int64_t last_bottom_change_us = 0;
static int64_t last_top_change_us = 0;
static bool last_bottom_state = false;
static bool last_top_state = false;

static uint16_t bottom_dist_cm = 999;
static uint16_t top_dist_cm = 999;

// Измерение расстояния дальномером HC-SR04 (в сантиметрах)
static uint16_t measure_hcsr04_distance(gpio_num_t trig_pin, gpio_num_t echo_pin, uint16_t max_dist_cm)
{
    // 1. Короткий импульс TRIG 10 мкс
    gpio_set_level(trig_pin, 0);
    esp_rom_delay_us(4);
    gpio_set_level(trig_pin, 1);
    esp_rom_delay_us(10);
    gpio_set_level(trig_pin, 0);

    // 2. Ожидание начала импульса ECHO (HIGH) с таймаутом ~10 мс
    int64_t start_wait = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 0) {
        if ((esp_timer_get_time() - start_wait) > 10000) {
            return 999; // Таймаут старта
        }
    }

    // 3. Измерение длительности импульса ECHO
    int64_t echo_start = esp_timer_get_time();
    int64_t max_echo_time = echo_start + (int64_t)max_dist_cm * 58 + 2000;

    while (gpio_get_level(echo_pin) == 1) {
        if (esp_timer_get_time() > max_echo_time) {
            return 999; // Превышение максимальной дистанции
        }
    }
    int64_t echo_end = esp_timer_get_time();
    int64_t duration_us = echo_end - echo_start;

    // Скорость звука ~ 343 м/с -> 1 см за 58.2 мкс
    uint16_t dist = (uint16_t)(duration_us / 58);
    if (dist < 2 || dist > max_dist_cm) {
        return 999;
    }
    return dist;
}

// Фоновая задача опроса ультразвуковых датчиков HC-SR04
static void ultrasonic_task(void *pvParameters)
{
    ESP_LOGI(TAG, "HC-SR04 Ultrasonic background polling task started");

    while (1)
    {
        if (cfg.sensor_type == 1) {
            // Опрос нижнего датчика HC-SR04 (TRIG = cfg.sensor_bottom_gpio, ECHO = cfg.sensor_bottom_echo_gpio)
            uint16_t d_bot = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_bottom_gpio,
                (gpio_num_t)cfg.sensor_bottom_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            bottom_dist_cm = d_bot;
            last_bottom_state = (d_bot > 0 && d_bot <= cfg.ultrasonic_trigger_distance_cm);

            vTaskDelay(pdMS_TO_TICKS(25)); // Задержка между ультразвуковыми пингами

            // Опрос верхнего датчика HC-SR04 (TRIG = cfg.sensor_top_gpio, ECHO = cfg.sensor_top_echo_gpio)
            uint16_t d_top = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_top_gpio,
                (gpio_num_t)cfg.sensor_top_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            top_dist_cm = d_top;
            last_top_state = (d_top > 0 && d_top <= cfg.ultrasonic_trigger_distance_cm);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

esp_err_t sensors_init(const staircase_settings_t *settings)
{
    cfg = *settings;

    if (cfg.sensor_type == 1) {
        // Конфигурация для HC-SR04:
        // TRIG пины как ВЫХОДЫ
        gpio_config_t trig_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&trig_conf));
        gpio_set_level((gpio_num_t)cfg.sensor_bottom_gpio, 0);
        gpio_set_level((gpio_num_t)cfg.sensor_top_gpio, 0);

        // ECHO пины как ВХОДЫ с подтяжкой к земле
        gpio_config_t echo_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_echo_gpio) | (1ULL << cfg.sensor_top_echo_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_ENABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&echo_conf));

        xTaskCreate(ultrasonic_task, "ultrasonic_task", 3072, NULL, 4, NULL);

        ESP_LOGI(TAG, "HC-SR04 Sensors initialized: Bottom TRIG=%d/ECHO=%d, Top TRIG=%d/ECHO=%d, Trigger=%d cm",
                 cfg.sensor_bottom_gpio, cfg.sensor_bottom_echo_gpio,
                 cfg.sensor_top_gpio, cfg.sensor_top_echo_gpio,
                 cfg.ultrasonic_trigger_distance_cm);
    } else {
        // Конфигурация для цифровых PIR / оптических датчиков
        gpio_config_t io_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = cfg.sensor_active_high ? GPIO_PULLUP_DISABLE : GPIO_PULLUP_ENABLE,
            .pull_down_en = cfg.sensor_active_high ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&io_conf));

        ESP_LOGI(TAG, "PIR/Optical Sensors initialized: Bottom GPIO %d, Top GPIO %d (Active: %s, Debounce: %d ms)",
                 cfg.sensor_bottom_gpio, cfg.sensor_top_gpio,
                 cfg.sensor_active_high ? "HIGH" : "LOW",
                 cfg.sensor_debounce_ms);
    }

    return ESP_OK;
}

int sensor_bottom_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_bottom_gpio);
}

int sensor_top_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_top_gpio);
}

uint16_t sensor_bottom_distance_cm(void)
{
    return bottom_dist_cm;
}

uint16_t sensor_top_distance_cm(void)
{
    return top_dist_cm;
}

bool sensor_is_ultrasonic(void)
{
    return (cfg.sensor_type == 1);
}

bool sensor_bottom_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_bottom_state;
    }

    int level = sensor_bottom_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_bottom_state) {
        if ((now_us - last_bottom_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_bottom_state = raw_active;
            last_bottom_change_us = now_us;
        }
    }
    return last_bottom_state;
}

bool sensor_top_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_top_state;
    }

    int level = sensor_top_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_top_state) {
        if ((now_us - last_top_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_top_state = raw_active;
            last_top_change_us = now_us;
        }
    }
    return last_top_state;
}

void sensors_reset_state(void)
{
    last_bottom_state = false;
    last_top_state = false;
    bottom_dist_cm = 999;
    top_dist_cm = 999;
    ESP_LOGI(TAG, "Sensors manually reset to idle state");
}`
  },
  {
    name: 'settings.h',
    path: 'main/settings.h',
    category: 'core',
    description: 'Структура конфигурации и интерфейс сохранения в энергонезависимую память (NVS).',
    code: `#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    uint16_t steps;
    uint16_t pixels_per_step;
    uint8_t brightness;
    uint8_t night_brightness;
    uint16_t step_on_time_ms;
    uint16_t step_off_time_ms;
    uint16_t hold_time_ms;
    uint8_t color_r;
    uint8_t color_g;
    uint8_t color_b;
    uint8_t led_gpio;
    uint8_t sensor_bottom_gpio;
    uint8_t sensor_top_gpio;
    bool sensor_active_high;
    uint16_t sensor_debounce_ms;
    bool night_mode;
    // Управление первой и последней ступенью
    bool enable_first_step;
    bool enable_last_step;
    bool night_first_step;
    bool night_last_step;
    char wifi_ssid[32];
    char wifi_password[64];
    char hostname[32];
    // Датчики: 0 = Цифровой PIR / Оптический, 1 = Ультразвуковой HC-SR04
    uint8_t sensor_type;
    uint8_t sensor_bottom_echo_gpio;
    uint8_t sensor_top_echo_gpio;
    uint16_t ultrasonic_trigger_distance_cm;
    uint16_t ultrasonic_max_distance_cm;
    // Время NTP и Астротаймер
    bool ntp_enabled;
    char ntp_server[64];
    int8_t timezone_offset;
    float latitude;
    float longitude;
    uint8_t schedule_mode;
    int16_t sunset_offset_min;
    int16_t sunrise_offset_min;
    uint8_t fixed_on_hour;
    uint8_t fixed_on_minute;
    uint8_t fixed_off_hour;
    uint8_t fixed_off_minute;
} staircase_settings_t;

void settings_init(staircase_settings_t *settings);
esp_err_t settings_load(staircase_settings_t *settings);
esp_err_t settings_save(const staircase_settings_t *settings);
esp_err_t settings_reset_defaults(staircase_settings_t *settings);`
  },
  {
    name: 'settings.c',
    path: 'main/settings.c',
    category: 'core',
    description: 'Сохранение и загрузка настроек лестницы в ESP32 NVS.',
    code: `#include "settings.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "SETTINGS";
static const char *NVS_NAMESPACE = "stair_cfg";

void settings_init(staircase_settings_t *settings)
{
    settings->steps = 18;
    settings->pixels_per_step = 1;
    settings->brightness = 80;
    settings->night_brightness = 20;
    settings->step_on_time_ms = 150;
    settings->step_off_time_ms = 150;
    settings->hold_time_ms = 5000;
    settings->color_r = 255;
    settings->color_g = 220;
    settings->color_b = 180;
    settings->led_gpio = 4;
    settings->sensor_bottom_gpio = 23;
    settings->sensor_top_gpio = 22;
    settings->sensor_active_high = true;
    settings->sensor_debounce_ms = 50;
    settings->night_mode = false;
    settings->enable_first_step = true;
    settings->enable_last_step = true;
    settings->night_first_step = true;
    settings->night_last_step = true;
    strncpy(settings->wifi_ssid, "ESP-Lestn", sizeof(settings->wifi_ssid));
    settings->wifi_password[0] = '\0';
    strncpy(settings->hostname, "esp-lestn", sizeof(settings->hostname));

    // Настройки датчиков HC-SR04
    settings->sensor_type = 0; // 0 = PIR / Оптика, 1 = HC-SR04
    settings->sensor_bottom_echo_gpio = 18;
    settings->sensor_top_echo_gpio = 19;
    settings->ultrasonic_trigger_distance_cm = 80;
    settings->ultrasonic_max_distance_cm = 200;

    // Астрономическое время
    settings->ntp_enabled = true;
    strncpy(settings->ntp_server, "pool.ntp.org", sizeof(settings->ntp_server));
    settings->timezone_offset = 3;
    settings->latitude = 55.7558f;
    settings->longitude = 37.6173f;
    settings->schedule_mode = 0;
    settings->sunset_offset_min = 0;
    settings->sunrise_offset_min = 0;
    settings->fixed_on_hour = 22;
    settings->fixed_on_minute = 0;
    settings->fixed_off_hour = 7;
    settings->fixed_off_minute = 0;
}

esp_err_t settings_load(staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No saved settings found in NVS, using defaults");
        return err;
    }

    size_t required_size = sizeof(staircase_settings_t);
    err = nvs_get_blob(nvs_h, "config", settings, &required_size);
    nvs_close(nvs_h);

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Settings successfully loaded from NVS");
    } else {
        ESP_LOGE(TAG, "Failed to read blob from NVS: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t settings_save(const staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for writing: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_blob(nvs_h, "config", settings, sizeof(staircase_settings_t));
    if (err == ESP_OK) {
        err = nvs_commit(nvs_h);
        ESP_LOGI(TAG, "Settings successfully saved and committed to NVS");
    } else {
        ESP_LOGE(TAG, "Failed to write blob to NVS: %s", esp_err_to_name(err));
    }

    nvs_close(nvs_h);
    return err;
}

esp_err_t settings_reset_defaults(staircase_settings_t *settings)
{
    settings_init(settings);
    return settings_save(settings);
}`
  },
  {
    name: 'wifi_manager.c',
    path: 'main/wifi_manager.c',
    category: 'driver',
    description: 'Управление Wi-Fi (автопереключение STA -> AP, mDNS, статический/DHCP IP).',
    code: `#include "wifi_manager.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "mdns.h"

static const char *TAG = "WIFI_MGR";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t wifi_event_group;
static staircase_settings_t *cfg = NULL;
static bool is_ap = true;
static char current_ip[16] = "192.168.4.1";
static int retry_num = 0;
#define MAX_STA_RETRIES 5

static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (retry_num < MAX_STA_RETRIES) {
            esp_wifi_connect();
            retry_num++;
            ESP_LOGI(TAG, "Retrying Wi-Fi STA connection (%d/%d)...", retry_num, MAX_STA_RETRIES);
        } else {
            xEventGroupSetBits(wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "Failed to connect to STA. Falling back to AP mode.");
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        snprintf(current_ip, sizeof(current_ip), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "Connected to Wi-Fi! IP: %s", current_ip);
        printf("\r\n===================================================\r\n");
        printf(" [UART / WI-FI] ESP32 ПОЛУЧИЛ IP-АДРЕС В СЕТИ:\r\n");
        printf(" >>>  IP: %s  <<<\r\n", current_ip);
        printf(" Веб-интерфейс: http://%s\r\n", current_ip);
        printf("===================================================\r\n\r\n");
        fflush(stdout);
        retry_num = 0;
        is_ap = false;
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_manager_start_ap(void)
{
    wifi_config_t wifi_config = {
        .ap = {
            .ssid = "ESP-Lestn",
            .ssid_len = strlen("ESP-Lestn"),
            .channel = 1,
            .password = "",
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    is_ap = true;
    strncpy(current_ip, "192.168.4.1", sizeof(current_ip));
    ESP_LOGI(TAG, "Access Point started: SSID='ESP-Lestn', IP=%s", current_ip);
    return ESP_OK;
}

static esp_err_t start_sta_internal(void)
{
    retry_num = 0;
    wifi_config_t wifi_config = {0};
    strncpy((char*)wifi_config.sta.ssid, cfg->wifi_ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char*)wifi_config.sta.password, cfg->wifi_password, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to Wi-Fi SSID: '%s'...", cfg->wifi_ssid);

    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            pdMS_TO_TICKS(15000));

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to SSID:%s", cfg->wifi_ssid);
        return ESP_OK;
    } else {
        ESP_LOGW(TAG, "Falling back to AP mode");
        esp_wifi_stop();
        return wifi_manager_start_ap();
    }
}

esp_err_t wifi_manager_init(staircase_settings_t *settings)
{
    cfg = settings;
    wifi_event_group = xEventGroupCreate();

    esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));

    // Инициализация mDNS
    mdns_init();
    mdns_hostname_set(cfg->hostname[0] ? cfg->hostname : "esp-lestn");
    mdns_instance_name_set("ESP32 Smart Staircase");

    if (cfg->wifi_ssid[0] != '\0' && strcmp(cfg->wifi_ssid, "ESP-Lestn") != 0) {
        return start_sta_internal();
    } else {
        return wifi_manager_start_ap();
    }
}

bool wifi_manager_is_connected(void)
{
    return !is_ap;
}

const char *wifi_manager_get_ip(void)
{
    return current_ip;
}

bool wifi_manager_is_ap_mode(void)
{
    return is_ap;
}

esp_err_t wifi_manager_reconnect_sta(void)
{
    if (cfg == NULL || cfg->wifi_ssid[0] == '\0') return ESP_ERR_INVALID_STATE;
    return start_sta_internal();
}`
  },
  {
    name: 'wifi_manager.h',
    path: 'main/wifi_manager.h',
    category: 'driver',
    description: 'Интерфейс управления Wi-Fi подсистемой.',
    code: `#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t wifi_manager_init(staircase_settings_t *settings);
bool wifi_manager_is_connected(void);
const char *wifi_manager_get_ip(void);
bool wifi_manager_is_ap_mode(void);
esp_err_t wifi_manager_start_ap(void);
esp_err_t wifi_manager_reconnect_sta(void);`
  },
  {
    name: 'time_astro.h',
    path: 'main/time_astro.h',
    category: 'core',
    description: 'Заголовочный файл сервиса времени NTP и астрономического расчета заката/восхода солнца (NOAA).',
    code: `#ifndef TIME_ASTRO_H
#define TIME_ASTRO_H

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*time_astro_state_cb_t)(bool is_night);

typedef struct {
    bool synced;
    char time_str[32];
    char sunrise_str[16];
    char sunset_str[16];
    bool is_night_time;
    char next_switch_str[32];
} time_astro_status_t;

esp_err_t time_astro_init(staircase_settings_t *settings, time_astro_state_cb_t cb);
void time_astro_apply_settings(const staircase_settings_t *settings);
bool time_astro_is_synced(void);
bool time_astro_is_night(void);
void time_astro_get_status(time_astro_status_t *status);

#ifdef __cplusplus
}
#endif

#endif // TIME_ASTRO_H`
  },
  {
    name: 'time_astro.c',
    path: 'main/time_astro.c',
    category: 'core',
    description: 'Реализация SNTP клиента, алгоритма NOAA для заката/восхода и фоновой задачи переключения режимов.',
    code: `#include "time_astro.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_sntp.h"

static const char *TAG = "TIME_ASTRO";

static staircase_settings_t *cfg = NULL;
static time_astro_state_cb_t state_callback = NULL;
static bool sntp_initialized = false;
static bool time_is_synced = false;
static bool current_night_state = false;

// Расчет времени заката и восхода по алгоритму NOAA
static void calculate_solar_times(time_t current_time, float lat, float lon, int tz_offset,
                                  int *sunrise_min, int *sunset_min)
{
    struct tm timeinfo;
    localtime_r(&current_time, &timeinfo);
    int day_of_year = timeinfo.tm_yday + 1;

    const double PI_D = 3.14159265358979323846;
    const double DEG2RAD = PI_D / 180.0;
    const double RAD2DEG = 180.0 / PI_D;

    double B = (360.0 / 365.0) * (day_of_year - 81) * DEG2RAD;
    double eot = 9.87 * sin(2 * B) - 7.53 * cos(B) - 1.5 * sin(B);
    double decl = 23.45 * sin((360.0 / 365.0) * (day_of_year - 81) * DEG2RAD);
    double decl_rad = decl * DEG2RAD;
    double lat_rad = (double)lat * DEG2RAD;

    double zenith = 90.8333 * DEG2RAD;
    double cos_ha = (cos(zenith) - sin(lat_rad) * sin(decl_rad)) / (cos(lat_rad) * cos(decl_rad));
    if (cos_ha > 1.0) cos_ha = 1.0;
    if (cos_ha < -1.0) cos_ha = -1.0;

    double ha_deg = acos(cos_ha) * RAD2DEG;
    double ha_hours = ha_deg / 15.0;

    double solar_noon = 12.0 - ((double)lon / 15.0) - (eot / 60.0) + (double)tz_offset;
    double sunrise_hour = solar_noon - ha_hours;
    double sunset_hour = solar_noon + ha_hours;

    while (sunrise_hour < 0.0) sunrise_hour += 24.0;
    while (sunrise_hour >= 24.0) sunrise_hour -= 24.0;
    while (sunset_hour < 0.0) sunset_hour += 24.0;
    while (sunset_hour >= 24.0) sunset_hour -= 24.0;

    if (sunrise_min) *sunrise_min = (int)round(sunrise_hour * 60.0);
    if (sunset_min) *sunset_min = (int)round(sunset_hour * 60.0);
}

// Фоновая задача проверки времени и переключения дня/ночи
static void astro_task(void *arg)
{
    while (1)
    {
        vTaskDelay(pdMS_TO_TICKS(15000));
        if (!cfg) continue;

        time_t now;
        time(&now);
        struct tm timeinfo;
        localtime_r(&now, &timeinfo);

        if (timeinfo.tm_year > (2020 - 1900)) {
            time_is_synced = true;
        }

        bool should_be_night = false;
        int cur_min = timeinfo.tm_hour * 60 + timeinfo.tm_min;

        if (cfg->schedule_mode == 0 && time_is_synced) {
            int sunrise_m = 360, sunset_m = 1200;
            calculate_solar_times(now, cfg->latitude, cfg->longitude, cfg->timezone_offset, &sunrise_m, &sunset_m);
            int on_time = sunset_m + cfg->sunset_offset_min;
            int off_time = sunrise_m + cfg->sunrise_offset_min;
            while (on_time < 0) on_time += 1440;
            while (on_time >= 1440) on_time -= 1440;
            while (off_time < 0) off_time += 1440;
            while (off_time >= 1440) off_time -= 1440;

            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 1 && time_is_synced) {
            int on_time = cfg->fixed_on_hour * 60 + cfg->fixed_on_minute;
            int off_time = cfg->fixed_off_hour * 60 + cfg->fixed_off_minute;
            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 2) {
            should_be_night = true;
        } else {
            should_be_night = false;
        }

        if (should_be_night != current_night_state) {
            current_night_state = should_be_night;
            if (state_callback) state_callback(current_night_state);
        }
    }
}`
  },
  {
    name: 'web_ota.h',
    path: 'main/web_ota.h',
    category: 'web',
    description: 'Интерфейс обновления прошивки ESP32 по воздуху (OTA по Wi-Fi через HTTP POST).',
    code: `#ifndef WEB_OTA_H
#define WEB_OTA_H

#include "web_common.h"
#include "esp_ota_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Обработчик GET запроса для отображения HTML страницы OTA обновления */
esp_err_t ota_page_handler(httpd_req_t *req);

/* Обработчик POST запроса для прошивки бинарного файла (.bin) по воздуху (OTA) */
esp_err_t ota_post_handler(httpd_req_t *req);

/* Обработчик GET запроса для получения информации о текущих разделах OTA и версии */
esp_err_t ota_status_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_OTA_H`
  },
  {
    name: 'web_ota.c',
    path: 'main/web_ota.c',
    category: 'web',
    description: 'Драйвер OTA прошивки: прием .bin через веб-сервер, запись во второй OTA слот и перезагрузка.',
    code: `#include "web_ota.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"

static const char *TAG = "WEB_OTA";
#define OTA_BUFF_SIZE 1024

esp_err_t ota_page_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t app_info;
    if (esp_ota_get_partition_description(running, &app_info) != ESP_OK) {
        strncpy(app_info.version, "2.0.0", sizeof(app_info.version));
    }

    web_send_html_header(req, "Обновление (OTA)");

    // 1. Stats and manual file upload card
    char html[2048];
    snprintf(html, sizeof(html),
        "<div class='card'>"
        "<h2>🔄 Беспроводное обновление (OTA)</h2>"
        "<p style='font-size:13px;color:#94a3b8;margin-bottom:12px'>"
        "Загрузка файла прошивки <code>ESP_lestn_v2.bin</code> прямо через браузер без подключения USB кабеля."
        "</p>"
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Текущий слот</div>"
        "<strong style='color:#38bdf8'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Слот для записи</div>"
        "<strong style='color:#34d399'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Версия</div>"
        "<strong id='cur_ver_tag' style='color:#f8fafc'>v%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Свободно RAM</div>"
        "<strong style='color:#fbbf24'>%lu КБ</strong>"
        "</div>"
        "</div>"
        "</div>",
        running ? running->label : "ota_0",
        update ? update->label : "ota_1",
        app_info.version,
        (unsigned long)(esp_get_free_heap_size() / 1024)
    );
    httpd_resp_sendstr_chunk(req, html);

    // 2. Direct GitHub Releases Updater Card
    httpd_resp_sendstr_chunk(req,
        "<div class='card' style='border-color:#0284c7'>"
        "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'>"
        "<h3 style='margin:0;color:#38bdf8'>📦 Обновление из GitHub Releases</h3>"
        "<button class='btn btn-sm' onclick='loadGitHubReleases()'>🔄 Проверить версии</button>"
        "</div>"
        "<p style='font-size:12px;color:#94a3b8;margin-bottom:12px'>"
        "Выберите нужную версию прошивки из репозитория <b>geminibitok-oss/ESP-v2</b>."
        "</p>"
        "<div id='gh_status' style='font-size:12px;color:#cbd5e1;margin-bottom:10px;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid #334155'>"
        "Загрузка версий..."
        "</div>"
        "<div style='margin-bottom:12px'>"
        "<label for='rel_select' style='font-size:12px;color:#94a3b8'>Доступные релизы:</label>"
        "<select id='rel_select' style='margin-bottom:8px' onchange='onSelectRelease()'>"
        "<option value='latest'>latest (Свежая сборка)</option>"
        "</select>"
        "</div>"
        "<div style='display:flex;gap:8px;flex-wrap:wrap'>"
        "<a id='gh_dl_link' class='btn' style='flex:1;background:#0284c7;text-align:center;text-decoration:none' target='_blank' download>📥 Скачать ESP_lestn_v2.bin</a>"
        "</div>"
        "<div style='font-size:11px;color:#94a3b8;margin-top:8px'>"
        "💡 Нажмите <b>«📥 Скачать ESP_lestn_v2.bin»</b>, затем выберите скачанный файл в блоке ниже и нажмите <b>«🚀 Загрузить и обновить ESP32»</b>."
        "</div>"
        "</div>"
    );

    // 3. Local file upload card
    httpd_resp_sendstr_chunk(req,
        "<div class='card'>"
        "<h3>📁 Загрузить файл прошивки в память ESP32</h3>"
        "<div style='margin-top:10px'>"
        "<input type='file' id='ota_file' accept='.bin' style='margin-bottom:12px'>"
        "<button id='up_btn' class='btn' style='width:100%;background:#16a34a' onclick='startOTA()'>🚀 Загрузить и обновить ESP32</button>"
        "</div>"
        "<div id='prg_box' style='display:none;margin-top:14px'>"
        "<div style='display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px'>"
        "<span id='st_txt'>Запись во Flash память...</span><span id='pct'>0%</span>"
        "</div>"
        "<div style='background:#0f172a;height:8px;border-radius:4px;overflow:hidden;border:1px solid #334155'>"
        "<div id='bar' style='background:#0284c7;width:0%;height:100%;transition:width 0.2s'></div>"
        "</div>"
        "</div>"
        "</div>"
    );

    // 4. Client-side JavaScript logic
    httpd_resp_sendstr_chunk(req,
        "<script>"
        "var ghReleases=[];"
        "function updateDlLink(tag){"
        "var a=document.getElementById('gh_dl_link');"
        "a.href='https://github.com/geminibitok-oss/ESP-v2/releases/download/'+tag+'/ESP_lestn_v2.bin';"
        "a.innerHTML='📥 Скачать ESP_lestn_v2.bin ('+tag+')';"
        "}"
        "function loadGitHubReleases(){"
        "var st=document.getElementById('gh_status');st.innerHTML='⏳ Запрос релизов с api.github.com...';"
        "var xhr=new XMLHttpRequest();xhr.open('GET','https://api.github.com/repos/geminibitok-oss/ESP-v2/releases?per_page=15',true);"
        "xhr.onload=function(){if(xhr.status==200){try{"
        "ghReleases=JSON.parse(xhr.responseText);"
        "var sel=document.getElementById('rel_select');sel.innerHTML='';"
        "if(ghReleases&&ghReleases.length>0){"
        "for(var i=0;i<ghReleases.length;i++){"
        "var r=ghReleases[i];"
        "var opt=document.createElement('option');opt.value=r.tag_name;"
        "opt.text=r.tag_name+(r.tag_name==='latest'?' (Свежая автосборка)':' - '+(r.name||'Релиз'));"
        "sel.appendChild(opt);"
        "}"
        "updateDlLink(ghReleases[0].tag_name);"
        "st.innerHTML='✅ Найдено релизов: <b>'+ghReleases.length+'</b>. Выберите версию и скачайте бинарник в 1 клик.';"
        "}else{"
        "st.innerHTML='ℹ️ Доступен базовый релиз latest.';"
        "updateDlLink('latest');"
        "}"
        "}catch(e){st.innerHTML='Ошибка парсинга: '+e;}}"
        "else{st.innerHTML='⚠️ GitHub API ответил: '+xhr.status;updateDlLink('latest');}};"
        "xhr.onerror=function(){st.innerHTML='⚠️ Нет прямого доступа к api.github.com.';updateDlLink('latest');};"
        "xhr.send();"
        "}"
        "function onSelectRelease(){"
        "var sel=document.getElementById('rel_select');"
        "updateDlLink(sel.value||'latest');"
        "}"
        "function startOTA(){"
        "var f=document.getElementById('ota_file').files[0];"
        "if(!f){alert('Пожалуйста, выберите .bin файл');return;}"
        "var b=document.getElementById('up_btn');b.disabled=true;"
        "var p=document.getElementById('prg_box');p.style.display='block';"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "var xhr=new XMLHttpRequest();xhr.open('POST','/api/ota',true);"
        "xhr.upload.onprogress=function(e){if(e.lengthComputable){var pc=Math.round((e.loaded/e.total)*100);bar.style.width=pc+'%';pct.innerText=pc+'%';}};"
        "xhr.onload=function(){if(xhr.status==200){st.innerText='Успех! Контроллер перезагружается...';bar.style.background='#16a34a';"
        "var c=15;var ti=setInterval(function(){st.innerText='Перезагрузка... ('+c+'с)';if(--c<=0){clearInterval(ti);location.href='/';}},1000);"
        "}else{alert('Ошибка OTA: '+xhr.responseText);b.disabled=false;}};"
        "xhr.onerror=function(){alert('Сбой сети при передаче OTA');b.disabled=false;};"
        "xhr.send(f);"
        "}"
        "setTimeout(loadGitHubReleases, 300);"
        "</script>"
    );

    web_send_html_footer(req);
    return ESP_OK;
}

esp_err_t ota_status_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *configured = esp_ota_get_boot_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t running_app_info;
    if (esp_ota_get_partition_description(running, &running_app_info) != ESP_OK) {
        strncpy(running_app_info.version, "2.0.0", sizeof(running_app_info.version));
        strncpy(running_app_info.project_name, "ESP_lestn_v2", sizeof(running_app_info.project_name));
    }

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{"
        "\"project_name\":\"%s\","
        "\"version\":\"%s\","
        "\"running_partition\":\"%s\","
        "\"running_address\":\"0x%lx\","
        "\"boot_partition\":\"%s\","
        "\"next_update_partition\":\"%s\","
        "\"free_heap\":%lu"
        "}",
        running_app_info.project_name,
        running_app_info.version,
        running ? running->label : "unknown",
        running ? (unsigned long)running->address : 0,
        configured ? configured->label : "unknown",
        update ? update->label : "unknown",
        (unsigned long)esp_get_free_heap_size()
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
}

esp_err_t ota_post_handler(httpd_req_t *req)
{
    esp_ota_handle_t update_handle = 0;
    const esp_partition_t *update_partition = NULL;

    ESP_LOGI(TAG, "Starting Over-The-Air (OTA) firmware update...");

    update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "Passive OTA partition not found");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA partition not found");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Writing to partition subtype %d at offset 0x%lx (label: %s)",
             update_partition->subtype, (unsigned long)update_partition->address, update_partition->label);

    int total_len = req->content_len;
    if (total_len <= 0) {
        ESP_LOGE(TAG, "Content-Length not specified or invalid");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Content-Length header required");
        return ESP_FAIL;
    }

    esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "esp_ota_begin failed");
        return ESP_FAIL;
    }

    char *ota_write_data = (char *)malloc(OTA_BUFF_SIZE);
    if (!ota_write_data) {
        ESP_LOGE(TAG, "Failed to allocate OTA buffer");
        esp_ota_abort(update_handle);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_ERR_NO_MEM;
    }

    int remaining = total_len;
    bool is_first_chunk = true;

    while (remaining > 0) {
        int to_read = remaining > OTA_BUFF_SIZE ? OTA_BUFF_SIZE : remaining;
        int received = httpd_req_recv(req, ota_write_data, to_read);
        if (received <= 0) {
            if (received == HTTPD_SOCK_ERR_TIMEOUT) {
                continue; // Retry on timeout
            }
            ESP_LOGE(TAG, "File receive error: %d", received);
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA transfer interrupted");
            return ESP_FAIL;
        }

        if (is_first_chunk) {
            is_first_chunk = false;
            // Validate magic byte (0xE9 for ESP32 image)
            if ((uint8_t)ota_write_data[0] != 0xE9) {
                ESP_LOGE(TAG, "Invalid image magic byte: 0x%02X (expected 0xE9)", (uint8_t)ota_write_data[0]);
                free(ota_write_data);
                esp_ota_abort(update_handle);
                httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid firmware binary header");
                return ESP_FAIL;
            }
        }

        err = esp_ota_write(update_handle, (const void *)ota_write_data, received);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "esp_ota_write failed (%s)", esp_err_to_name(err));
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Flash write failed");
            return ESP_FAIL;
        }

        remaining -= received;
    }

    free(ota_write_data);

    err = esp_ota_end(update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Firmware validation failed");
        return ESP_FAIL;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to switch boot partition");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "OTA upgrade successful! Next boot partition: %s. Scheduling reboot in 1.5s...", update_partition->label);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    const char *resp = "{\"status\":\"success\",\"message\":\"Firmware successfully flashed. Rebooting ESP32...\"}";
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);

    // Schedule reboot after sending response
    web_schedule_restart(1500);

    return ESP_OK;
}
`
  },
  {
    name: 'web_server.c',
    path: 'main/web_server.c',
    category: 'web',
    description: 'Главная точка регистрации эндпоинтов и запуска HTTP сервера ESP-IDF.',
    code: `#include "web_server.h"
#include "web_routes.h"
#include "web_common.h"

static const char *TAG = "WEB_SERVER";
static httpd_handle_t server = NULL;

extern void web_index_set_settings(staircase_settings_t *settings);
extern void web_settings_set_settings(staircase_settings_t *settings);
extern void web_wifi_set_settings(staircase_settings_t *settings);
extern void web_api_set_settings(staircase_settings_t *settings);

esp_err_t web_server_start(staircase_settings_t *settings)
{
    web_index_set_settings(settings);
    web_settings_set_settings(settings);
    web_wifi_set_settings(settings);
    web_api_set_settings(settings);

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 16;
    config.stack_size = 8192;
    config.lru_purge_enable = true;
    config.max_resp_headers = 16;

    ESP_LOGI(TAG, "Starting HTTP Web Server on port %d...", config.server_port);

    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return err;
    }

    httpd_uri_t uri_index = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_get = { .uri = "/settings", .method = HTTP_GET, .handler = settings_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_post = { .uri = "/settings", .method = HTTP_POST, .handler = settings_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_get = { .uri = "/wifi", .method = HTTP_GET, .handler = wifi_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_post = { .uri = "/wifi", .method = HTTP_POST, .handler = wifi_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_state = { .uri = "/api/state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_trigger = { .uri = "/api/trigger", .method = HTTP_GET, .handler = api_trigger_handler, .user_ctx = NULL };

    /* OTA Обновление прошивки */
    httpd_uri_t uri_ota_page = { .uri = "/update", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_page_alt = { .uri = "/ota", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post = { .uri = "/api/ota", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post_update = { .uri = "/update", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_status = { .uri = "/api/ota/status", .method = HTTP_GET, .handler = ota_status_handler, .user_ctx = NULL };

    /* Для обратной совместимости */
    httpd_uri_t uri_led_state = { .uri = "/led-state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };

    httpd_register_uri_handler(server, &uri_index);
    httpd_register_uri_handler(server, &uri_settings_get);
    httpd_register_uri_handler(server, &uri_settings_post);
    httpd_register_uri_handler(server, &uri_wifi_get);
    httpd_register_uri_handler(server, &uri_wifi_post);
    httpd_register_uri_handler(server, &uri_api_state);
    httpd_register_uri_handler(server, &uri_api_trigger);
    httpd_register_uri_handler(server, &uri_ota_page);
    httpd_register_uri_handler(server, &uri_ota_page_alt);
    httpd_register_uri_handler(server, &uri_ota_post);
    httpd_register_uri_handler(server, &uri_ota_post_update);
    httpd_register_uri_handler(server, &uri_ota_status);
    httpd_register_uri_handler(server, &uri_led_state);

    ESP_LOGI(TAG, "Web server started with endpoints: /, /settings, /wifi, /update, /api/state, /api/ota");
    return ESP_OK;
}`
  },
  {
    name: 'web_server.h',
    path: 'main/web_server.h',
    category: 'web',
    description: 'Интерфейс веб-сервера управления.',
    code: `#pragma once

#include "esp_err.h"
#include "settings.h"

esp_err_t web_server_start(staircase_settings_t *settings);`
  },
  {
    name: 'sensors.h',
    path: 'main/sensors.h',
    category: 'driver',
    description: 'Интерфейс драйвера датчиков присутствия (цифровые PIR/оптические и ультразвуковые HC-SR04).',
    code: `#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t sensors_init(const staircase_settings_t *settings);
bool sensor_bottom_active(void);
bool sensor_top_active(void);
int sensor_bottom_level(void);
int sensor_top_level(void);

// Функции для работы с ультразвуковыми дальномерами HC-SR04
uint16_t sensor_bottom_distance_cm(void);
uint16_t sensor_top_distance_cm(void);
bool sensor_is_ultrasonic(void);
void sensors_reset_state(void);`
  },
  {
    name: 'sensors.c',
    path: 'main/sensors.c',
    category: 'driver',
    description: 'Драйвер датчиков присутствия: цифровой режим (PIR/оптика с подавлением дребезга) и ультразвуковой режим HC-SR04 (эхолокация в см с фильтрацией шумов).',
    code: `#include "sensors.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "SENSORS";

static staircase_settings_t cfg;
static int64_t last_bottom_change_us = 0;
static int64_t last_top_change_us = 0;
static bool last_bottom_state = false;
static bool last_top_state = false;

static uint16_t bottom_dist_cm = 999;
static uint16_t top_dist_cm = 999;

// Измерение расстояния дальномером HC-SR04 (в сантиметрах)
static uint16_t measure_hcsr04_distance(gpio_num_t trig_pin, gpio_num_t echo_pin, uint16_t max_dist_cm)
{
    // 1. Короткий импульс TRIG 10 мкс
    gpio_set_level(trig_pin, 0);
    esp_rom_delay_us(4);
    gpio_set_level(trig_pin, 1);
    esp_rom_delay_us(10);
    gpio_set_level(trig_pin, 0);

    // 2. Ожидание начала импульса ECHO (HIGH) с таймаутом ~10 мс
    int64_t start_wait = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 0) {
        if ((esp_timer_get_time() - start_wait) > 10000) {
            return 999; // Таймаут старта
        }
    }

    // 3. Измерение длительности импульса ECHO
    int64_t echo_start = esp_timer_get_time();
    int64_t max_echo_time = echo_start + (int64_t)max_dist_cm * 58 + 2000;

    while (gpio_get_level(echo_pin) == 1) {
        if (esp_timer_get_time() > max_echo_time) {
            return 999; // Превышение максимальной дистанции
        }
    }
    int64_t echo_end = esp_timer_get_time();
    int64_t duration_us = echo_end - echo_start;

    // Скорость звука ~ 343 м/с -> 1 см за 58.2 мкс
    uint16_t dist = (uint16_t)(duration_us / 58);
    if (dist < 2 || dist > max_dist_cm) {
        return 999;
    }
    return dist;
}

// Фоновая задача опроса ультразвуковых датчиков HC-SR04
static void ultrasonic_task(void *pvParameters)
{
    ESP_LOGI(TAG, "HC-SR04 Ultrasonic background polling task started");

    while (1)
    {
        if (cfg.sensor_type == 1) {
            // Опрос нижнего датчика HC-SR04 (TRIG = cfg.sensor_bottom_gpio, ECHO = cfg.sensor_bottom_echo_gpio)
            uint16_t d_bot = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_bottom_gpio,
                (gpio_num_t)cfg.sensor_bottom_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            bottom_dist_cm = d_bot;
            last_bottom_state = (d_bot > 0 && d_bot <= cfg.ultrasonic_trigger_distance_cm);

            vTaskDelay(pdMS_TO_TICKS(25)); // Задержка между ультразвуковыми пингами

            // Опрос верхнего датчика HC-SR04 (TRIG = cfg.sensor_top_gpio, ECHO = cfg.sensor_top_echo_gpio)
            uint16_t d_top = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_top_gpio,
                (gpio_num_t)cfg.sensor_top_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            top_dist_cm = d_top;
            last_top_state = (d_top > 0 && d_top <= cfg.ultrasonic_trigger_distance_cm);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

esp_err_t sensors_init(const staircase_settings_t *settings)
{
    cfg = *settings;

    if (cfg.sensor_type == 1) {
        // Конфигурация для HC-SR04:
        // TRIG пины как ВЫХОДЫ
        gpio_config_t trig_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&trig_conf));
        gpio_set_level((gpio_num_t)cfg.sensor_bottom_gpio, 0);
        gpio_set_level((gpio_num_t)cfg.sensor_top_gpio, 0);

        // ECHO пины как ВХОДЫ с подтяжкой к земле
        gpio_config_t echo_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_echo_gpio) | (1ULL << cfg.sensor_top_echo_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_ENABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&echo_conf));

        xTaskCreate(ultrasonic_task, "ultrasonic_task", 3072, NULL, 4, NULL);

        ESP_LOGI(TAG, "HC-SR04 Sensors initialized: Bottom TRIG=%d/ECHO=%d, Top TRIG=%d/ECHO=%d, Trigger=%d cm",
                 cfg.sensor_bottom_gpio, cfg.sensor_bottom_echo_gpio,
                 cfg.sensor_top_gpio, cfg.sensor_top_echo_gpio,
                 cfg.ultrasonic_trigger_distance_cm);
    } else {
        // Конфигурация для цифровых PIR / оптических датчиков
        gpio_config_t io_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = cfg.sensor_active_high ? GPIO_PULLUP_DISABLE : GPIO_PULLUP_ENABLE,
            .pull_down_en = cfg.sensor_active_high ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&io_conf));

        ESP_LOGI(TAG, "PIR/Optical Sensors initialized: Bottom GPIO %d, Top GPIO %d (Active: %s, Debounce: %d ms)",
                 cfg.sensor_bottom_gpio, cfg.sensor_top_gpio,
                 cfg.sensor_active_high ? "HIGH" : "LOW",
                 cfg.sensor_debounce_ms);
    }

    return ESP_OK;
}

int sensor_bottom_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_bottom_gpio);
}

int sensor_top_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_top_gpio);
}

uint16_t sensor_bottom_distance_cm(void)
{
    return bottom_dist_cm;
}

uint16_t sensor_top_distance_cm(void)
{
    return top_dist_cm;
}

bool sensor_is_ultrasonic(void)
{
    return (cfg.sensor_type == 1);
}

bool sensor_bottom_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_bottom_state;
    }

    int level = sensor_bottom_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_bottom_state) {
        if ((now_us - last_bottom_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_bottom_state = raw_active;
            last_bottom_change_us = now_us;
        }
    }
    return last_bottom_state;
}

bool sensor_top_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_top_state;
    }

    int level = sensor_top_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_top_state) {
        if ((now_us - last_top_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_top_state = raw_active;
            last_top_change_us = now_us;
        }
    }
    return last_top_state;
}

void sensors_reset_state(void)
{
    last_bottom_state = false;
    last_top_state = false;
    bottom_dist_cm = 999;
    top_dist_cm = 999;
    ESP_LOGI(TAG, "Sensors manually reset to idle state");
}`
  },
  {
    name: 'settings.h',
    path: 'main/settings.h',
    category: 'core',
    description: 'Структура конфигурации и интерфейс сохранения в энергонезависимую память (NVS).',
    code: `#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    uint16_t steps;
    uint16_t pixels_per_step;
    uint8_t brightness;
    uint8_t night_brightness;
    uint16_t step_on_time_ms;
    uint16_t step_off_time_ms;
    uint16_t hold_time_ms;
    uint8_t color_r;
    uint8_t color_g;
    uint8_t color_b;
    uint8_t led_gpio;
    uint8_t sensor_bottom_gpio;
    uint8_t sensor_top_gpio;
    bool sensor_active_high;
    uint16_t sensor_debounce_ms;
    bool night_mode;
    // Управление первой и последней ступенью
    bool enable_first_step;
    bool enable_last_step;
    bool night_first_step;
    bool night_last_step;
    char wifi_ssid[32];
    char wifi_password[64];
    char hostname[32];
    // Датчики: 0 = Цифровой PIR / Оптический, 1 = Ультразвуковой HC-SR04
    uint8_t sensor_type;
    uint8_t sensor_bottom_echo_gpio;
    uint8_t sensor_top_echo_gpio;
    uint16_t ultrasonic_trigger_distance_cm;
    uint16_t ultrasonic_max_distance_cm;
    // Время NTP и Астротаймер
    bool ntp_enabled;
    char ntp_server[64];
    int8_t timezone_offset;
    float latitude;
    float longitude;
    uint8_t schedule_mode;
    int16_t sunset_offset_min;
    int16_t sunrise_offset_min;
    uint8_t fixed_on_hour;
    uint8_t fixed_on_minute;
    uint8_t fixed_off_hour;
    uint8_t fixed_off_minute;
} staircase_settings_t;

void settings_init(staircase_settings_t *settings);
esp_err_t settings_load(staircase_settings_t *settings);
esp_err_t settings_save(const staircase_settings_t *settings);
esp_err_t settings_reset_defaults(staircase_settings_t *settings);`
  },
  {
    name: 'settings.c',
    path: 'main/settings.c',
    category: 'core',
    description: 'Сохранение и загрузка настроек лестницы в ESP32 NVS.',
    code: `#include "settings.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "SETTINGS";
static const char *NVS_NAMESPACE = "stair_cfg";

void settings_init(staircase_settings_t *settings)
{
    settings->steps = 18;
    settings->pixels_per_step = 1;
    settings->brightness = 80;
    settings->night_brightness = 20;
    settings->step_on_time_ms = 150;
    settings->step_off_time_ms = 150;
    settings->hold_time_ms = 5000;
    settings->color_r = 255;
    settings->color_g = 220;
    settings->color_b = 180;
    settings->led_gpio = 4;
    settings->sensor_bottom_gpio = 23;
    settings->sensor_top_gpio = 22;
    settings->sensor_active_high = true;
    settings->sensor_debounce_ms = 50;
    settings->night_mode = false;
    settings->enable_first_step = true;
    settings->enable_last_step = true;
    settings->night_first_step = true;
    settings->night_last_step = true;
    strncpy(settings->wifi_ssid, "ESP-Lestn", sizeof(settings->wifi_ssid));
    settings->wifi_password[0] = '\0';
    strncpy(settings->hostname, "esp-lestn", sizeof(settings->hostname));

    // Настройки датчиков HC-SR04
    settings->sensor_type = 0; // 0 = PIR / Оптика, 1 = HC-SR04
    settings->sensor_bottom_echo_gpio = 18;
    settings->sensor_top_echo_gpio = 19;
    settings->ultrasonic_trigger_distance_cm = 80;
    settings->ultrasonic_max_distance_cm = 200;

    // Астрономическое время
    settings->ntp_enabled = true;
    strncpy(settings->ntp_server, "pool.ntp.org", sizeof(settings->ntp_server));
    settings->timezone_offset = 3;
    settings->latitude = 55.7558f;
    settings->longitude = 37.6173f;
    settings->schedule_mode = 0;
    settings->sunset_offset_min = 0;
    settings->sunrise_offset_min = 0;
    settings->fixed_on_hour = 22;
    settings->fixed_on_minute = 0;
    settings->fixed_off_hour = 7;
    settings->fixed_off_minute = 0;
}

esp_err_t settings_load(staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No saved settings found in NVS, using defaults");
        return err;
    }

    size_t required_size = sizeof(staircase_settings_t);
    err = nvs_get_blob(nvs_h, "config", settings, &required_size);
    nvs_close(nvs_h);

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Settings successfully loaded from NVS");
    } else {
        ESP_LOGE(TAG, "Failed to read blob from NVS: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t settings_save(const staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for writing: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_blob(nvs_h, "config", settings, sizeof(staircase_settings_t));
    if (err == ESP_OK) {
        err = nvs_commit(nvs_h);
        ESP_LOGI(TAG, "Settings successfully saved and committed to NVS");
    } else {
        ESP_LOGE(TAG, "Failed to write blob to NVS: %s", esp_err_to_name(err));
    }

    nvs_close(nvs_h);
    return err;
}

esp_err_t settings_reset_defaults(staircase_settings_t *settings)
{
    settings_init(settings);
    return settings_save(settings);
}`
  },
  {
    name: 'wifi_manager.c',
    path: 'main/wifi_manager.c',
    category: 'driver',
    description: 'Управление Wi-Fi (автопереключение STA -> AP, mDNS, статический/DHCP IP).',
    code: `#include "wifi_manager.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "mdns.h"

static const char *TAG = "WIFI_MGR";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t wifi_event_group;
static staircase_settings_t *cfg = NULL;
static bool is_ap = true;
static char current_ip[16] = "192.168.4.1";
static int retry_num = 0;
#define MAX_STA_RETRIES 5

static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (retry_num < MAX_STA_RETRIES) {
            esp_wifi_connect();
            retry_num++;
            ESP_LOGI(TAG, "Retrying Wi-Fi STA connection (%d/%d)...", retry_num, MAX_STA_RETRIES);
        } else {
            xEventGroupSetBits(wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "Failed to connect to STA. Falling back to AP mode.");
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        snprintf(current_ip, sizeof(current_ip), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "Connected to Wi-Fi! IP: %s", current_ip);
        printf("\r\n===================================================\r\n");
        printf(" [UART / WI-FI] ESP32 ПОЛУЧИЛ IP-АДРЕС В СЕТИ:\r\n");
        printf(" >>>  IP: %s  <<<\r\n", current_ip);
        printf(" Веб-интерфейс: http://%s\r\n", current_ip);
        printf("===================================================\r\n\r\n");
        fflush(stdout);
        retry_num = 0;
        is_ap = false;
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_manager_start_ap(void)
{
    wifi_config_t wifi_config = {
        .ap = {
            .ssid = "ESP-Lestn",
            .ssid_len = strlen("ESP-Lestn"),
            .channel = 1,
            .password = "",
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    is_ap = true;
    strncpy(current_ip, "192.168.4.1", sizeof(current_ip));
    ESP_LOGI(TAG, "Access Point started: SSID='ESP-Lestn', IP=%s", current_ip);
    return ESP_OK;
}

static esp_err_t start_sta_internal(void)
{
    retry_num = 0;
    wifi_config_t wifi_config = {0};
    strncpy((char*)wifi_config.sta.ssid, cfg->wifi_ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char*)wifi_config.sta.password, cfg->wifi_password, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to Wi-Fi SSID: '%s'...", cfg->wifi_ssid);

    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            pdMS_TO_TICKS(15000));

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to SSID:%s", cfg->wifi_ssid);
        return ESP_OK;
    } else {
        ESP_LOGW(TAG, "Falling back to AP mode");
        esp_wifi_stop();
        return wifi_manager_start_ap();
    }
}

esp_err_t wifi_manager_init(staircase_settings_t *settings)
{
    cfg = settings;
    wifi_event_group = xEventGroupCreate();

    esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));

    // Инициализация mDNS
    mdns_init();
    mdns_hostname_set(cfg->hostname[0] ? cfg->hostname : "esp-lestn");
    mdns_instance_name_set("ESP32 Smart Staircase");

    if (cfg->wifi_ssid[0] != '\0' && strcmp(cfg->wifi_ssid, "ESP-Lestn") != 0) {
        return start_sta_internal();
    } else {
        return wifi_manager_start_ap();
    }
}

bool wifi_manager_is_connected(void)
{
    return !is_ap;
}

const char *wifi_manager_get_ip(void)
{
    return current_ip;
}

bool wifi_manager_is_ap_mode(void)
{
    return is_ap;
}

esp_err_t wifi_manager_reconnect_sta(void)
{
    if (cfg == NULL || cfg->wifi_ssid[0] == '\0') return ESP_ERR_INVALID_STATE;
    return start_sta_internal();
}`
  },
  {
    name: 'wifi_manager.h',
    path: 'main/wifi_manager.h',
    category: 'driver',
    description: 'Интерфейс управления Wi-Fi подсистемой.',
    code: `#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t wifi_manager_init(staircase_settings_t *settings);
bool wifi_manager_is_connected(void);
const char *wifi_manager_get_ip(void);
bool wifi_manager_is_ap_mode(void);
esp_err_t wifi_manager_start_ap(void);
esp_err_t wifi_manager_reconnect_sta(void);`
  },
  {
    name: 'time_astro.h',
    path: 'main/time_astro.h',
    category: 'core',
    description: 'Заголовочный файл сервиса времени NTP и астрономического расчета заката/восхода солнца (NOAA).',
    code: `#ifndef TIME_ASTRO_H
#define TIME_ASTRO_H

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*time_astro_state_cb_t)(bool is_night);

typedef struct {
    bool synced;
    char time_str[32];
    char sunrise_str[16];
    char sunset_str[16];
    bool is_night_time;
    char next_switch_str[32];
} time_astro_status_t;

esp_err_t time_astro_init(staircase_settings_t *settings, time_astro_state_cb_t cb);
void time_astro_apply_settings(const staircase_settings_t *settings);
bool time_astro_is_synced(void);
bool time_astro_is_night(void);
void time_astro_get_status(time_astro_status_t *status);

#ifdef __cplusplus
}
#endif

#endif // TIME_ASTRO_H`
  },
  {
    name: 'time_astro.c',
    path: 'main/time_astro.c',
    category: 'core',
    description: 'Реализация SNTP клиента, алгоритма NOAA для заката/восхода и фоновой задачи переключения режимов.',
    code: `#include "time_astro.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_sntp.h"

static const char *TAG = "TIME_ASTRO";

static staircase_settings_t *cfg = NULL;
static time_astro_state_cb_t state_callback = NULL;
static bool sntp_initialized = false;
static bool time_is_synced = false;
static bool current_night_state = false;

// Расчет времени заката и восхода по алгоритму NOAA
static void calculate_solar_times(time_t current_time, float lat, float lon, int tz_offset,
                                  int *sunrise_min, int *sunset_min)
{
    struct tm timeinfo;
    localtime_r(&current_time, &timeinfo);
    int day_of_year = timeinfo.tm_yday + 1;

    const double PI_D = 3.14159265358979323846;
    const double DEG2RAD = PI_D / 180.0;
    const double RAD2DEG = 180.0 / PI_D;

    double B = (360.0 / 365.0) * (day_of_year - 81) * DEG2RAD;
    double eot = 9.87 * sin(2 * B) - 7.53 * cos(B) - 1.5 * sin(B);
    double decl = 23.45 * sin((360.0 / 365.0) * (day_of_year - 81) * DEG2RAD);
    double decl_rad = decl * DEG2RAD;
    double lat_rad = (double)lat * DEG2RAD;

    double zenith = 90.8333 * DEG2RAD;
    double cos_ha = (cos(zenith) - sin(lat_rad) * sin(decl_rad)) / (cos(lat_rad) * cos(decl_rad));
    if (cos_ha > 1.0) cos_ha = 1.0;
    if (cos_ha < -1.0) cos_ha = -1.0;

    double ha_deg = acos(cos_ha) * RAD2DEG;
    double ha_hours = ha_deg / 15.0;

    double solar_noon = 12.0 - ((double)lon / 15.0) - (eot / 60.0) + (double)tz_offset;
    double sunrise_hour = solar_noon - ha_hours;
    double sunset_hour = solar_noon + ha_hours;

    while (sunrise_hour < 0.0) sunrise_hour += 24.0;
    while (sunrise_hour >= 24.0) sunrise_hour -= 24.0;
    while (sunset_hour < 0.0) sunset_hour += 24.0;
    while (sunset_hour >= 24.0) sunset_hour -= 24.0;

    if (sunrise_min) *sunrise_min = (int)round(sunrise_hour * 60.0);
    if (sunset_min) *sunset_min = (int)round(sunset_hour * 60.0);
}

// Фоновая задача проверки времени и переключения дня/ночи
static void astro_task(void *arg)
{
    while (1)
    {
        vTaskDelay(pdMS_TO_TICKS(15000));
        if (!cfg) continue;

        time_t now;
        time(&now);
        struct tm timeinfo;
        localtime_r(&now, &timeinfo);

        if (timeinfo.tm_year > (2020 - 1900)) {
            time_is_synced = true;
        }

        bool should_be_night = false;
        int cur_min = timeinfo.tm_hour * 60 + timeinfo.tm_min;

        if (cfg->schedule_mode == 0 && time_is_synced) {
            int sunrise_m = 360, sunset_m = 1200;
            calculate_solar_times(now, cfg->latitude, cfg->longitude, cfg->timezone_offset, &sunrise_m, &sunset_m);
            int on_time = sunset_m + cfg->sunset_offset_min;
            int off_time = sunrise_m + cfg->sunrise_offset_min;
            while (on_time < 0) on_time += 1440;
            while (on_time >= 1440) on_time -= 1440;
            while (off_time < 0) off_time += 1440;
            while (off_time >= 1440) off_time -= 1440;

            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 1 && time_is_synced) {
            int on_time = cfg->fixed_on_hour * 60 + cfg->fixed_on_minute;
            int off_time = cfg->fixed_off_hour * 60 + cfg->fixed_off_minute;
            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 2) {
            should_be_night = true;
        } else {
            should_be_night = false;
        }

        if (should_be_night != current_night_state) {
            current_night_state = should_be_night;
            if (state_callback) state_callback(current_night_state);
        }
    }
}`
  },
  {
    name: 'web_ota.h',
    path: 'main/web_ota.h',
    category: 'web',
    description: 'Интерфейс обновления прошивки ESP32 по воздуху (OTA по Wi-Fi через HTTP POST).',
    code: `#ifndef WEB_OTA_H
#define WEB_OTA_H

#include "web_common.h"
#include "esp_ota_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Обработчик GET запроса для отображения HTML страницы OTA обновления */
esp_err_t ota_page_handler(httpd_req_t *req);

/* Обработчик POST запроса для прошивки бинарного файла (.bin) по воздуху (OTA) */
esp_err_t ota_post_handler(httpd_req_t *req);

/* Обработчик GET запроса для получения информации о текущих разделах OTA и версии */
esp_err_t ota_status_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_OTA_H`
  },
  {
    name: 'web_ota.c',
    path: 'main/web_ota.c',
    category: 'web',
    description: 'Драйвер OTA прошивки: прием .bin через веб-сервер, запись во второй OTA слот и перезагрузка.',
    code: `#include "web_ota.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"

static const char *TAG = "WEB_OTA";
#define OTA_BUFF_SIZE 1024

esp_err_t ota_page_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t app_info;
    if (esp_ota_get_partition_description(running, &app_info) != ESP_OK) {
        strncpy(app_info.version, "2.0.0", sizeof(app_info.version));
    }

    web_send_html_header(req, "Обновление (OTA)");

    // 1. Stats and manual file upload card
    char html[2048];
    snprintf(html, sizeof(html),
        "<div class='card'>"
        "<h2>🔄 Беспроводное обновление (OTA)</h2>"
        "<p style='font-size:13px;color:#94a3b8;margin-bottom:12px'>"
        "Загрузка файла прошивки <code>ESP_lestn_v2.bin</code> прямо через браузер без подключения USB кабеля."
        "</p>"
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Текущий слот</div>"
        "<strong style='color:#38bdf8'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Слот для записи</div>"
        "<strong style='color:#34d399'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Версия</div>"
        "<strong id='cur_ver_tag' style='color:#f8fafc'>v%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Свободно RAM</div>"
        "<strong style='color:#fbbf24'>%lu КБ</strong>"
        "</div>"
        "</div>"
        "</div>",
        running ? running->label : "ota_0",
        update ? update->label : "ota_1",
        app_info.version,
        (unsigned long)(esp_get_free_heap_size() / 1024)
    );
    httpd_resp_sendstr_chunk(req, html);

    // 2. Direct GitHub Releases Updater Card
    httpd_resp_sendstr_chunk(req,
        "<div class='card' style='border-color:#0284c7'>"
        "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'>"
        "<h3 style='margin:0;color:#38bdf8'>📦 Обновление из GitHub Releases</h3>"
        "<button class='btn btn-sm' onclick='loadGitHubReleases()'>🔄 Проверить версии</button>"
        "</div>"
        "<p style='font-size:12px;color:#94a3b8;margin-bottom:12px'>"
        "Выберите нужную версию прошивки из репозитория <b>geminibitok-oss/ESP-v2</b>."
        "</p>"
        "<div id='gh_status' style='font-size:12px;color:#cbd5e1;margin-bottom:10px;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid #334155'>"
        "Загрузка версий..."
        "</div>"
        "<div style='margin-bottom:12px'>"
        "<label for='rel_select' style='font-size:12px;color:#94a3b8'>Доступные релизы:</label>"
        "<select id='rel_select' style='margin-bottom:8px' onchange='onSelectRelease()'>"
        "<option value='latest'>latest (Свежая сборка)</option>"
        "</select>"
        "</div>"
        "<div style='display:flex;gap:8px;flex-wrap:wrap'>"
        "<a id='gh_dl_link' class='btn' style='flex:1;background:#0284c7;text-align:center;text-decoration:none' target='_blank' download>📥 Скачать ESP_lestn_v2.bin</a>"
        "</div>"
        "<div style='font-size:11px;color:#94a3b8;margin-top:8px'>"
        "💡 Нажмите <b>«📥 Скачать ESP_lestn_v2.bin»</b>, затем выберите скачанный файл в блоке ниже и нажмите <b>«🚀 Загрузить и обновить ESP32»</b>."
        "</div>"
        "</div>"
    );

    // 3. Local file upload card
    httpd_resp_sendstr_chunk(req,
        "<div class='card'>"
        "<h3>📁 Загрузить файл прошивки в память ESP32</h3>"
        "<div style='margin-top:10px'>"
        "<input type='file' id='ota_file' accept='.bin' style='margin-bottom:12px'>"
        "<button id='up_btn' class='btn' style='width:100%;background:#16a34a' onclick='startOTA()'>🚀 Загрузить и обновить ESP32</button>"
        "</div>"
        "<div id='prg_box' style='display:none;margin-top:14px'>"
        "<div style='display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px'>"
        "<span id='st_txt'>Запись во Flash память...</span><span id='pct'>0%</span>"
        "</div>"
        "<div style='background:#0f172a;height:8px;border-radius:4px;overflow:hidden;border:1px solid #334155'>"
        "<div id='bar' style='background:#0284c7;width:0%;height:100%;transition:width 0.2s'></div>"
        "</div>"
        "</div>"
        "</div>"
    );

    // 4. Client-side JavaScript logic
    httpd_resp_sendstr_chunk(req,
        "<script>"
        "var ghReleases=[];"
        "function updateDlLink(tag){"
        "var a=document.getElementById('gh_dl_link');"
        "a.href='https://github.com/geminibitok-oss/ESP-v2/releases/download/'+tag+'/ESP_lestn_v2.bin';"
        "a.innerHTML='📥 Скачать ESP_lestn_v2.bin ('+tag+')';"
        "}"
        "function loadGitHubReleases(){"
        "var st=document.getElementById('gh_status');st.innerHTML='⏳ Запрос релизов с api.github.com...';"
        "var xhr=new XMLHttpRequest();xhr.open('GET','https://api.github.com/repos/geminibitok-oss/ESP-v2/releases?per_page=15',true);"
        "xhr.onload=function(){if(xhr.status==200){try{"
        "ghReleases=JSON.parse(xhr.responseText);"
        "var sel=document.getElementById('rel_select');sel.innerHTML='';"
        "if(ghReleases&&ghReleases.length>0){"
        "for(var i=0;i<ghReleases.length;i++){"
        "var r=ghReleases[i];"
        "var opt=document.createElement('option');opt.value=r.tag_name;"
        "opt.text=r.tag_name+(r.tag_name==='latest'?' (Свежая автосборка)':' - '+(r.name||'Релиз'));"
        "sel.appendChild(opt);"
        "}"
        "updateDlLink(ghReleases[0].tag_name);"
        "st.innerHTML='✅ Найдено релизов: <b>'+ghReleases.length+'</b>. Выберите версию и скачайте бинарник в 1 клик.';"
        "}else{"
        "st.innerHTML='ℹ️ Доступен базовый релиз latest.';"
        "updateDlLink('latest');"
        "}"
        "}catch(e){st.innerHTML='Ошибка парсинга: '+e;}}"
        "else{st.innerHTML='⚠️ GitHub API ответил: '+xhr.status;updateDlLink('latest');}};"
        "xhr.onerror=function(){st.innerHTML='⚠️ Нет прямого доступа к api.github.com.';updateDlLink('latest');};"
        "xhr.send();"
        "}"
        "function onSelectRelease(){"
        "var sel=document.getElementById('rel_select');"
        "updateDlLink(sel.value||'latest');"
        "}"
        "function startOTA(){"
        "var f=document.getElementById('ota_file').files[0];"
        "if(!f){alert('Пожалуйста, выберите .bin файл');return;}"
        "var b=document.getElementById('up_btn');b.disabled=true;"
        "var p=document.getElementById('prg_box');p.style.display='block';"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "var xhr=new XMLHttpRequest();xhr.open('POST','/api/ota',true);"
        "xhr.upload.onprogress=function(e){if(e.lengthComputable){var pc=Math.round((e.loaded/e.total)*100);bar.style.width=pc+'%';pct.innerText=pc+'%';}};"
        "xhr.onload=function(){if(xhr.status==200){st.innerText='Успех! Контроллер перезагружается...';bar.style.background='#16a34a';"
        "var c=15;var ti=setInterval(function(){st.innerText='Перезагрузка... ('+c+'с)';if(--c<=0){clearInterval(ti);location.href='/';}},1000);"
        "}else{alert('Ошибка OTA: '+xhr.responseText);b.disabled=false;}};"
        "xhr.onerror=function(){alert('Сбой сети при передаче OTA');b.disabled=false;};"
        "xhr.send(f);"
        "}"
        "setTimeout(loadGitHubReleases, 300);"
        "</script>"
    );

    web_send_html_footer(req);
    return ESP_OK;
}

esp_err_t ota_status_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *configured = esp_ota_get_boot_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t running_app_info;
    if (esp_ota_get_partition_description(running, &running_app_info) != ESP_OK) {
        strncpy(running_app_info.version, "2.0.0", sizeof(running_app_info.version));
        strncpy(running_app_info.project_name, "ESP_lestn_v2", sizeof(running_app_info.project_name));
    }

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{"
        "\"project_name\":\"%s\","
        "\"version\":\"%s\","
        "\"running_partition\":\"%s\","
        "\"running_address\":\"0x%lx\","
        "\"boot_partition\":\"%s\","
        "\"next_update_partition\":\"%s\","
        "\"free_heap\":%lu"
        "}",
        running_app_info.project_name,
        running_app_info.version,
        running ? running->label : "unknown",
        running ? (unsigned long)running->address : 0,
        configured ? configured->label : "unknown",
        update ? update->label : "unknown",
        (unsigned long)esp_get_free_heap_size()
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
}

esp_err_t ota_post_handler(httpd_req_t *req)
{
    esp_ota_handle_t update_handle = 0;
    const esp_partition_t *update_partition = NULL;

    ESP_LOGI(TAG, "Starting Over-The-Air (OTA) firmware update...");

    update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "Passive OTA partition not found");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA partition not found");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Writing to partition subtype %d at offset 0x%lx (label: %s)",
             update_partition->subtype, (unsigned long)update_partition->address, update_partition->label);

    int total_len = req->content_len;
    if (total_len <= 0) {
        ESP_LOGE(TAG, "Content-Length not specified or invalid");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Content-Length header required");
        return ESP_FAIL;
    }

    esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "esp_ota_begin failed");
        return ESP_FAIL;
    }

    char *ota_write_data = (char *)malloc(OTA_BUFF_SIZE);
    if (!ota_write_data) {
        ESP_LOGE(TAG, "Failed to allocate OTA buffer");
        esp_ota_abort(update_handle);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_ERR_NO_MEM;
    }

    int remaining = total_len;
    bool is_first_chunk = true;

    while (remaining > 0) {
        int to_read = remaining > OTA_BUFF_SIZE ? OTA_BUFF_SIZE : remaining;
        int received = httpd_req_recv(req, ota_write_data, to_read);
        if (received <= 0) {
            if (received == HTTPD_SOCK_ERR_TIMEOUT) {
                continue; // Retry on timeout
            }
            ESP_LOGE(TAG, "File receive error: %d", received);
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA transfer interrupted");
            return ESP_FAIL;
        }

        if (is_first_chunk) {
            is_first_chunk = false;
            // Validate magic byte (0xE9 for ESP32 image)
            if ((uint8_t)ota_write_data[0] != 0xE9) {
                ESP_LOGE(TAG, "Invalid image magic byte: 0x%02X (expected 0xE9)", (uint8_t)ota_write_data[0]);
                free(ota_write_data);
                esp_ota_abort(update_handle);
                httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid firmware binary header");
                return ESP_FAIL;
            }
        }

        err = esp_ota_write(update_handle, (const void *)ota_write_data, received);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "esp_ota_write failed (%s)", esp_err_to_name(err));
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Flash write failed");
            return ESP_FAIL;
        }

        remaining -= received;
    }

    free(ota_write_data);

    err = esp_ota_end(update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Firmware validation failed");
        return ESP_FAIL;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to switch boot partition");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "OTA upgrade successful! Next boot partition: %s. Scheduling reboot in 1.5s...", update_partition->label);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    const char *resp = "{\"status\":\"success\",\"message\":\"Firmware successfully flashed. Rebooting ESP32...\"}";
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);

    // Schedule reboot after sending response
    web_schedule_restart(1500);

    return ESP_OK;
}
`
  },
  {
    name: 'web_server.c',
    path: 'main/web_server.c',
    category: 'web',
    description: 'Главная точка регистрации эндпоинтов и запуска HTTP сервера ESP-IDF.',
    code: `#include "web_server.h"
#include "web_routes.h"
#include "web_common.h"

static const char *TAG = "WEB_SERVER";
static httpd_handle_t server = NULL;

extern void web_index_set_settings(staircase_settings_t *settings);
extern void web_settings_set_settings(staircase_settings_t *settings);
extern void web_wifi_set_settings(staircase_settings_t *settings);
extern void web_api_set_settings(staircase_settings_t *settings);

esp_err_t web_server_start(staircase_settings_t *settings)
{
    web_index_set_settings(settings);
    web_settings_set_settings(settings);
    web_wifi_set_settings(settings);
    web_api_set_settings(settings);

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 16;
    config.stack_size = 8192;
    config.lru_purge_enable = true;
    config.max_resp_headers = 16;

    ESP_LOGI(TAG, "Starting HTTP Web Server on port %d...", config.server_port);

    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return err;
    }

    httpd_uri_t uri_index = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_get = { .uri = "/settings", .method = HTTP_GET, .handler = settings_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_post = { .uri = "/settings", .method = HTTP_POST, .handler = settings_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_get = { .uri = "/wifi", .method = HTTP_GET, .handler = wifi_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_post = { .uri = "/wifi", .method = HTTP_POST, .handler = wifi_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_state = { .uri = "/api/state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_trigger = { .uri = "/api/trigger", .method = HTTP_GET, .handler = api_trigger_handler, .user_ctx = NULL };

    /* OTA Обновление прошивки */
    httpd_uri_t uri_ota_page = { .uri = "/update", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_page_alt = { .uri = "/ota", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post = { .uri = "/api/ota", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post_update = { .uri = "/update", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_status = { .uri = "/api/ota/status", .method = HTTP_GET, .handler = ota_status_handler, .user_ctx = NULL };

    /* Для обратной совместимости */
    httpd_uri_t uri_led_state = { .uri = "/led-state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };

    httpd_register_uri_handler(server, &uri_index);
    httpd_register_uri_handler(server, &uri_settings_get);
    httpd_register_uri_handler(server, &uri_settings_post);
    httpd_register_uri_handler(server, &uri_wifi_get);
    httpd_register_uri_handler(server, &uri_wifi_post);
    httpd_register_uri_handler(server, &uri_api_state);
    httpd_register_uri_handler(server, &uri_api_trigger);
    httpd_register_uri_handler(server, &uri_ota_page);
    httpd_register_uri_handler(server, &uri_ota_page_alt);
    httpd_register_uri_handler(server, &uri_ota_post);
    httpd_register_uri_handler(server, &uri_ota_post_update);
    httpd_register_uri_handler(server, &uri_ota_status);
    httpd_register_uri_handler(server, &uri_led_state);

    ESP_LOGI(TAG, "Web server started with endpoints: /, /settings, /wifi, /update, /api/state, /api/ota");
    return ESP_OK;
}`
  },
  {
    name: 'web_server.h',
    path: 'main/web_server.h',
    category: 'web',
    description: 'Интерфейс веб-сервера управления.',
    code: `#pragma once

#include "esp_err.h"
#include "settings.h"

esp_err_t web_server_start(staircase_settings_t *settings);`
  },
  {
    name: 'sensors.h',
    path: 'main/sensors.h',
    category: 'driver',
    description: 'Интерфейс драйвера датчиков присутствия (цифровые PIR/оптические и ультразвуковые HC-SR04).',
    code: `#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t sensors_init(const staircase_settings_t *settings);
bool sensor_bottom_active(void);
bool sensor_top_active(void);
int sensor_bottom_level(void);
int sensor_top_level(void);

// Функции для работы с ультразвуковыми дальномерами HC-SR04
uint16_t sensor_bottom_distance_cm(void);
uint16_t sensor_top_distance_cm(void);
bool sensor_is_ultrasonic(void);
void sensors_reset_state(void);`
  },
  {
    name: 'sensors.c',
    path: 'main/sensors.c',
    category: 'driver',
    description: 'Драйвер датчиков присутствия: цифровой режим (PIR/оптика с подавлением дребезга) и ультразвуковой режим HC-SR04 (эхолокация в см с фильтрацией шумов).',
    code: `#include "sensors.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "SENSORS";

static staircase_settings_t cfg;
static int64_t last_bottom_change_us = 0;
static int64_t last_top_change_us = 0;
static bool last_bottom_state = false;
static bool last_top_state = false;

static uint16_t bottom_dist_cm = 999;
static uint16_t top_dist_cm = 999;

// Измерение расстояния дальномером HC-SR04 (в сантиметрах)
static uint16_t measure_hcsr04_distance(gpio_num_t trig_pin, gpio_num_t echo_pin, uint16_t max_dist_cm)
{
    // 1. Короткий импульс TRIG 10 мкс
    gpio_set_level(trig_pin, 0);
    esp_rom_delay_us(4);
    gpio_set_level(trig_pin, 1);
    esp_rom_delay_us(10);
    gpio_set_level(trig_pin, 0);

    // 2. Ожидание начала импульса ECHO (HIGH) с таймаутом ~10 мс
    int64_t start_wait = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 0) {
        if ((esp_timer_get_time() - start_wait) > 10000) {
            return 999; // Таймаут старта
        }
    }

    // 3. Измерение длительности импульса ECHO
    int64_t echo_start = esp_timer_get_time();
    int64_t max_echo_time = echo_start + (int64_t)max_dist_cm * 58 + 2000;

    while (gpio_get_level(echo_pin) == 1) {
        if (esp_timer_get_time() > max_echo_time) {
            return 999; // Превышение максимальной дистанции
        }
    }
    int64_t echo_end = esp_timer_get_time();
    int64_t duration_us = echo_end - echo_start;

    // Скорость звука ~ 343 м/с -> 1 см за 58.2 мкс
    uint16_t dist = (uint16_t)(duration_us / 58);
    if (dist < 2 || dist > max_dist_cm) {
        return 999;
    }
    return dist;
}

// Фоновая задача опроса ультразвуковых датчиков HC-SR04
static void ultrasonic_task(void *pvParameters)
{
    ESP_LOGI(TAG, "HC-SR04 Ultrasonic background polling task started");

    while (1)
    {
        if (cfg.sensor_type == 1) {
            // Опрос нижнего датчика HC-SR04 (TRIG = cfg.sensor_bottom_gpio, ECHO = cfg.sensor_bottom_echo_gpio)
            uint16_t d_bot = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_bottom_gpio,
                (gpio_num_t)cfg.sensor_bottom_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            bottom_dist_cm = d_bot;
            last_bottom_state = (d_bot > 0 && d_bot <= cfg.ultrasonic_trigger_distance_cm);

            vTaskDelay(pdMS_TO_TICKS(25)); // Задержка между ультразвуковыми пингами

            // Опрос верхнего датчика HC-SR04 (TRIG = cfg.sensor_top_gpio, ECHO = cfg.sensor_top_echo_gpio)
            uint16_t d_top = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_top_gpio,
                (gpio_num_t)cfg.sensor_top_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            top_dist_cm = d_top;
            last_top_state = (d_top > 0 && d_top <= cfg.ultrasonic_trigger_distance_cm);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

esp_err_t sensors_init(const staircase_settings_t *settings)
{
    cfg = *settings;

    if (cfg.sensor_type == 1) {
        // Конфигурация для HC-SR04:
        // TRIG пины как ВЫХОДЫ
        gpio_config_t trig_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&trig_conf));
        gpio_set_level((gpio_num_t)cfg.sensor_bottom_gpio, 0);
        gpio_set_level((gpio_num_t)cfg.sensor_top_gpio, 0);

        // ECHO пины как ВХОДЫ с подтяжкой к земле
        gpio_config_t echo_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_echo_gpio) | (1ULL << cfg.sensor_top_echo_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_ENABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&echo_conf));

        xTaskCreate(ultrasonic_task, "ultrasonic_task", 3072, NULL, 4, NULL);

        ESP_LOGI(TAG, "HC-SR04 Sensors initialized: Bottom TRIG=%d/ECHO=%d, Top TRIG=%d/ECHO=%d, Trigger=%d cm",
                 cfg.sensor_bottom_gpio, cfg.sensor_bottom_echo_gpio,
                 cfg.sensor_top_gpio, cfg.sensor_top_echo_gpio,
                 cfg.ultrasonic_trigger_distance_cm);
    } else {
        // Конфигурация для цифровых PIR / оптических датчиков
        gpio_config_t io_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = cfg.sensor_active_high ? GPIO_PULLUP_DISABLE : GPIO_PULLUP_ENABLE,
            .pull_down_en = cfg.sensor_active_high ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&io_conf));

        ESP_LOGI(TAG, "PIR/Optical Sensors initialized: Bottom GPIO %d, Top GPIO %d (Active: %s, Debounce: %d ms)",
                 cfg.sensor_bottom_gpio, cfg.sensor_top_gpio,
                 cfg.sensor_active_high ? "HIGH" : "LOW",
                 cfg.sensor_debounce_ms);
    }

    return ESP_OK;
}

int sensor_bottom_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_bottom_gpio);
}

int sensor_top_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_top_gpio);
}

uint16_t sensor_bottom_distance_cm(void)
{
    return bottom_dist_cm;
}

uint16_t sensor_top_distance_cm(void)
{
    return top_dist_cm;
}

bool sensor_is_ultrasonic(void)
{
    return (cfg.sensor_type == 1);
}

bool sensor_bottom_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_bottom_state;
    }

    int level = sensor_bottom_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_bottom_state) {
        if ((now_us - last_bottom_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_bottom_state = raw_active;
            last_bottom_change_us = now_us;
        }
    }
    return last_bottom_state;
}

bool sensor_top_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_top_state;
    }

    int level = sensor_top_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_top_state) {
        if ((now_us - last_top_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_top_state = raw_active;
            last_top_change_us = now_us;
        }
    }
    return last_top_state;
}

void sensors_reset_state(void)
{
    last_bottom_state = false;
    last_top_state = false;
    bottom_dist_cm = 999;
    top_dist_cm = 999;
    ESP_LOGI(TAG, "Sensors manually reset to idle state");
}`
  },
  {
    name: 'settings.h',
    path: 'main/settings.h',
    category: 'core',
    description: 'Структура конфигурации и интерфейс сохранения в энергонезависимую память (NVS).',
    code: `#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    uint16_t steps;
    uint16_t pixels_per_step;
    uint8_t brightness;
    uint8_t night_brightness;
    uint16_t step_on_time_ms;
    uint16_t step_off_time_ms;
    uint16_t hold_time_ms;
    uint8_t color_r;
    uint8_t color_g;
    uint8_t color_b;
    uint8_t led_gpio;
    uint8_t sensor_bottom_gpio;
    uint8_t sensor_top_gpio;
    bool sensor_active_high;
    uint16_t sensor_debounce_ms;
    bool night_mode;
    // Управление первой и последней ступенью
    bool enable_first_step;
    bool enable_last_step;
    bool night_first_step;
    bool night_last_step;
    char wifi_ssid[32];
    char wifi_password[64];
    char hostname[32];
    // Датчики: 0 = Цифровой PIR / Оптический, 1 = Ультразвуковой HC-SR04
    uint8_t sensor_type;
    uint8_t sensor_bottom_echo_gpio;
    uint8_t sensor_top_echo_gpio;
    uint16_t ultrasonic_trigger_distance_cm;
    uint16_t ultrasonic_max_distance_cm;
    // Время NTP и Астротаймер
    bool ntp_enabled;
    char ntp_server[64];
    int8_t timezone_offset;
    float latitude;
    float longitude;
    uint8_t schedule_mode;
    int16_t sunset_offset_min;
    int16_t sunrise_offset_min;
    uint8_t fixed_on_hour;
    uint8_t fixed_on_minute;
    uint8_t fixed_off_hour;
    uint8_t fixed_off_minute;
} staircase_settings_t;

void settings_init(staircase_settings_t *settings);
esp_err_t settings_load(staircase_settings_t *settings);
esp_err_t settings_save(const staircase_settings_t *settings);
esp_err_t settings_reset_defaults(staircase_settings_t *settings);`
  },
  {
    name: 'settings.c',
    path: 'main/settings.c',
    category: 'core',
    description: 'Сохранение и загрузка настроек лестницы в ESP32 NVS.',
    code: `#include "settings.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "SETTINGS";
static const char *NVS_NAMESPACE = "stair_cfg";

void settings_init(staircase_settings_t *settings)
{
    settings->steps = 18;
    settings->pixels_per_step = 1;
    settings->brightness = 80;
    settings->night_brightness = 20;
    settings->step_on_time_ms = 150;
    settings->step_off_time_ms = 150;
    settings->hold_time_ms = 5000;
    settings->color_r = 255;
    settings->color_g = 220;
    settings->color_b = 180;
    settings->led_gpio = 4;
    settings->sensor_bottom_gpio = 23;
    settings->sensor_top_gpio = 22;
    settings->sensor_active_high = true;
    settings->sensor_debounce_ms = 50;
    settings->night_mode = false;
    settings->enable_first_step = true;
    settings->enable_last_step = true;
    settings->night_first_step = true;
    settings->night_last_step = true;
    strncpy(settings->wifi_ssid, "ESP-Lestn", sizeof(settings->wifi_ssid));
    settings->wifi_password[0] = '\0';
    strncpy(settings->hostname, "esp-lestn", sizeof(settings->hostname));

    // Настройки датчиков HC-SR04
    settings->sensor_type = 0; // 0 = PIR / Оптика, 1 = HC-SR04
    settings->sensor_bottom_echo_gpio = 18;
    settings->sensor_top_echo_gpio = 19;
    settings->ultrasonic_trigger_distance_cm = 80;
    settings->ultrasonic_max_distance_cm = 200;

    // Астрономическое время
    settings->ntp_enabled = true;
    strncpy(settings->ntp_server, "pool.ntp.org", sizeof(settings->ntp_server));
    settings->timezone_offset = 3;
    settings->latitude = 55.7558f;
    settings->longitude = 37.6173f;
    settings->schedule_mode = 0;
    settings->sunset_offset_min = 0;
    settings->sunrise_offset_min = 0;
    settings->fixed_on_hour = 22;
    settings->fixed_on_minute = 0;
    settings->fixed_off_hour = 7;
    settings->fixed_off_minute = 0;
}

esp_err_t settings_load(staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No saved settings found in NVS, using defaults");
        return err;
    }

    size_t required_size = sizeof(staircase_settings_t);
    err = nvs_get_blob(nvs_h, "config", settings, &required_size);
    nvs_close(nvs_h);

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Settings successfully loaded from NVS");
    } else {
        ESP_LOGE(TAG, "Failed to read blob from NVS: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t settings_save(const staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for writing: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_blob(nvs_h, "config", settings, sizeof(staircase_settings_t));
    if (err == ESP_OK) {
        err = nvs_commit(nvs_h);
        ESP_LOGI(TAG, "Settings successfully saved and committed to NVS");
    } else {
        ESP_LOGE(TAG, "Failed to write blob to NVS: %s", esp_err_to_name(err));
    }

    nvs_close(nvs_h);
    return err;
}

esp_err_t settings_reset_defaults(staircase_settings_t *settings)
{
    settings_init(settings);
    return settings_save(settings);
}`
  },
  {
    name: 'wifi_manager.c',
    path: 'main/wifi_manager.c',
    category: 'driver',
    description: 'Управление Wi-Fi (автопереключение STA -> AP, mDNS, статический/DHCP IP).',
    code: `#include "wifi_manager.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "mdns.h"

static const char *TAG = "WIFI_MGR";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t wifi_event_group;
static staircase_settings_t *cfg = NULL;
static bool is_ap = true;
static char current_ip[16] = "192.168.4.1";
static int retry_num = 0;
#define MAX_STA_RETRIES 5

static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (retry_num < MAX_STA_RETRIES) {
            esp_wifi_connect();
            retry_num++;
            ESP_LOGI(TAG, "Retrying Wi-Fi STA connection (%d/%d)...", retry_num, MAX_STA_RETRIES);
        } else {
            xEventGroupSetBits(wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "Failed to connect to STA. Falling back to AP mode.");
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        snprintf(current_ip, sizeof(current_ip), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "Connected to Wi-Fi! IP: %s", current_ip);
        printf("\r\n===================================================\r\n");
        printf(" [UART / WI-FI] ESP32 ПОЛУЧИЛ IP-АДРЕС В СЕТИ:\r\n");
        printf(" >>>  IP: %s  <<<\r\n", current_ip);
        printf(" Веб-интерфейс: http://%s\r\n", current_ip);
        printf("===================================================\r\n\r\n");
        fflush(stdout);
        retry_num = 0;
        is_ap = false;
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_manager_start_ap(void)
{
    wifi_config_t wifi_config = {
        .ap = {
            .ssid = "ESP-Lestn",
            .ssid_len = strlen("ESP-Lestn"),
            .channel = 1,
            .password = "",
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    is_ap = true;
    strncpy(current_ip, "192.168.4.1", sizeof(current_ip));
    ESP_LOGI(TAG, "Access Point started: SSID='ESP-Lestn', IP=%s", current_ip);
    return ESP_OK;
}

static esp_err_t start_sta_internal(void)
{
    retry_num = 0;
    wifi_config_t wifi_config = {0};
    strncpy((char*)wifi_config.sta.ssid, cfg->wifi_ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char*)wifi_config.sta.password, cfg->wifi_password, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to Wi-Fi SSID: '%s'...", cfg->wifi_ssid);

    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            pdMS_TO_TICKS(15000));

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to SSID:%s", cfg->wifi_ssid);
        return ESP_OK;
    } else {
        ESP_LOGW(TAG, "Falling back to AP mode");
        esp_wifi_stop();
        return wifi_manager_start_ap();
    }
}

esp_err_t wifi_manager_init(staircase_settings_t *settings)
{
    cfg = settings;
    wifi_event_group = xEventGroupCreate();

    esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));

    // Инициализация mDNS
    mdns_init();
    mdns_hostname_set(cfg->hostname[0] ? cfg->hostname : "esp-lestn");
    mdns_instance_name_set("ESP32 Smart Staircase");

    if (cfg->wifi_ssid[0] != '\0' && strcmp(cfg->wifi_ssid, "ESP-Lestn") != 0) {
        return start_sta_internal();
    } else {
        return wifi_manager_start_ap();
    }
}

bool wifi_manager_is_connected(void)
{
    return !is_ap;
}

const char *wifi_manager_get_ip(void)
{
    return current_ip;
}

bool wifi_manager_is_ap_mode(void)
{
    return is_ap;
}

esp_err_t wifi_manager_reconnect_sta(void)
{
    if (cfg == NULL || cfg->wifi_ssid[0] == '\0') return ESP_ERR_INVALID_STATE;
    return start_sta_internal();
}`
  },
  {
    name: 'wifi_manager.h',
    path: 'main/wifi_manager.h',
    category: 'driver',
    description: 'Интерфейс управления Wi-Fi подсистемой.',
    code: `#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t wifi_manager_init(staircase_settings_t *settings);
bool wifi_manager_is_connected(void);
const char *wifi_manager_get_ip(void);
bool wifi_manager_is_ap_mode(void);
esp_err_t wifi_manager_start_ap(void);
esp_err_t wifi_manager_reconnect_sta(void);`
  },
  {
    name: 'time_astro.h',
    path: 'main/time_astro.h',
    category: 'core',
    description: 'Заголовочный файл сервиса времени NTP и астрономического расчета заката/восхода солнца (NOAA).',
    code: `#ifndef TIME_ASTRO_H
#define TIME_ASTRO_H

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*time_astro_state_cb_t)(bool is_night);

typedef struct {
    bool synced;
    char time_str[32];
    char sunrise_str[16];
    char sunset_str[16];
    bool is_night_time;
    char next_switch_str[32];
} time_astro_status_t;

esp_err_t time_astro_init(staircase_settings_t *settings, time_astro_state_cb_t cb);
void time_astro_apply_settings(const staircase_settings_t *settings);
bool time_astro_is_synced(void);
bool time_astro_is_night(void);
void time_astro_get_status(time_astro_status_t *status);

#ifdef __cplusplus
}
#endif

#endif // TIME_ASTRO_H`
  },
  {
    name: 'time_astro.c',
    path: 'main/time_astro.c',
    category: 'core',
    description: 'Реализация SNTP клиента, алгоритма NOAA для заката/восхода и фоновой задачи переключения режимов.',
    code: `#include "time_astro.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_sntp.h"

static const char *TAG = "TIME_ASTRO";

static staircase_settings_t *cfg = NULL;
static time_astro_state_cb_t state_callback = NULL;
static bool sntp_initialized = false;
static bool time_is_synced = false;
static bool current_night_state = false;

// Расчет времени заката и восхода по алгоритму NOAA
static void calculate_solar_times(time_t current_time, float lat, float lon, int tz_offset,
                                  int *sunrise_min, int *sunset_min)
{
    struct tm timeinfo;
    localtime_r(&current_time, &timeinfo);
    int day_of_year = timeinfo.tm_yday + 1;

    const double PI_D = 3.14159265358979323846;
    const double DEG2RAD = PI_D / 180.0;
    const double RAD2DEG = 180.0 / PI_D;

    double B = (360.0 / 365.0) * (day_of_year - 81) * DEG2RAD;
    double eot = 9.87 * sin(2 * B) - 7.53 * cos(B) - 1.5 * sin(B);
    double decl = 23.45 * sin((360.0 / 365.0) * (day_of_year - 81) * DEG2RAD);
    double decl_rad = decl * DEG2RAD;
    double lat_rad = (double)lat * DEG2RAD;

    double zenith = 90.8333 * DEG2RAD;
    double cos_ha = (cos(zenith) - sin(lat_rad) * sin(decl_rad)) / (cos(lat_rad) * cos(decl_rad));
    if (cos_ha > 1.0) cos_ha = 1.0;
    if (cos_ha < -1.0) cos_ha = -1.0;

    double ha_deg = acos(cos_ha) * RAD2DEG;
    double ha_hours = ha_deg / 15.0;

    double solar_noon = 12.0 - ((double)lon / 15.0) - (eot / 60.0) + (double)tz_offset;
    double sunrise_hour = solar_noon - ha_hours;
    double sunset_hour = solar_noon + ha_hours;

    while (sunrise_hour < 0.0) sunrise_hour += 24.0;
    while (sunrise_hour >= 24.0) sunrise_hour -= 24.0;
    while (sunset_hour < 0.0) sunset_hour += 24.0;
    while (sunset_hour >= 24.0) sunset_hour -= 24.0;

    if (sunrise_min) *sunrise_min = (int)round(sunrise_hour * 60.0);
    if (sunset_min) *sunset_min = (int)round(sunset_hour * 60.0);
}

// Фоновая задача проверки времени и переключения дня/ночи
static void astro_task(void *arg)
{
    while (1)
    {
        vTaskDelay(pdMS_TO_TICKS(15000));
        if (!cfg) continue;

        time_t now;
        time(&now);
        struct tm timeinfo;
        localtime_r(&now, &timeinfo);

        if (timeinfo.tm_year > (2020 - 1900)) {
            time_is_synced = true;
        }

        bool should_be_night = false;
        int cur_min = timeinfo.tm_hour * 60 + timeinfo.tm_min;

        if (cfg->schedule_mode == 0 && time_is_synced) {
            int sunrise_m = 360, sunset_m = 1200;
            calculate_solar_times(now, cfg->latitude, cfg->longitude, cfg->timezone_offset, &sunrise_m, &sunset_m);
            int on_time = sunset_m + cfg->sunset_offset_min;
            int off_time = sunrise_m + cfg->sunrise_offset_min;
            while (on_time < 0) on_time += 1440;
            while (on_time >= 1440) on_time -= 1440;
            while (off_time < 0) off_time += 1440;
            while (off_time >= 1440) off_time -= 1440;

            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 1 && time_is_synced) {
            int on_time = cfg->fixed_on_hour * 60 + cfg->fixed_on_minute;
            int off_time = cfg->fixed_off_hour * 60 + cfg->fixed_off_minute;
            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 2) {
            should_be_night = true;
        } else {
            should_be_night = false;
        }

        if (should_be_night != current_night_state) {
            current_night_state = should_be_night;
            if (state_callback) state_callback(current_night_state);
        }
    }
}`
  },
  {
    name: 'web_ota.h',
    path: 'main/web_ota.h',
    category: 'web',
    description: 'Интерфейс обновления прошивки ESP32 по воздуху (OTA по Wi-Fi через HTTP POST).',
    code: `#ifndef WEB_OTA_H
#define WEB_OTA_H

#include "web_common.h"
#include "esp_ota_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Обработчик GET запроса для отображения HTML страницы OTA обновления */
esp_err_t ota_page_handler(httpd_req_t *req);

/* Обработчик POST запроса для прошивки бинарного файла (.bin) по воздуху (OTA) */
esp_err_t ota_post_handler(httpd_req_t *req);

/* Обработчик GET запроса для получения информации о текущих разделах OTA и версии */
esp_err_t ota_status_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_OTA_H`
  },
  {
    name: 'web_ota.c',
    path: 'main/web_ota.c',
    category: 'web',
    description: 'Драйвер OTA прошивки: прием .bin через веб-сервер, запись во второй OTA слот и перезагрузка.',
    code: `#include "web_ota.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"

static const char *TAG = "WEB_OTA";
#define OTA_BUFF_SIZE 1024

esp_err_t ota_page_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t app_info;
    if (esp_ota_get_partition_description(running, &app_info) != ESP_OK) {
        strncpy(app_info.version, "2.0.0", sizeof(app_info.version));
    }

    web_send_html_header(req, "Обновление (OTA)");

    // 1. Stats and manual file upload card
    char html[2048];
    snprintf(html, sizeof(html),
        "<div class='card'>"
        "<h2>🔄 Беспроводное обновление (OTA)</h2>"
        "<p style='font-size:13px;color:#94a3b8;margin-bottom:12px'>"
        "Загрузка файла прошивки <code>ESP_lestn_v2.bin</code> прямо через браузер без подключения USB кабеля."
        "</p>"
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Текущий слот</div>"
        "<strong style='color:#38bdf8'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Слот для записи</div>"
        "<strong style='color:#34d399'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Версия</div>"
        "<strong id='cur_ver_tag' style='color:#f8fafc'>v%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Свободно RAM</div>"
        "<strong style='color:#fbbf24'>%lu КБ</strong>"
        "</div>"
        "</div>"
        "</div>",
        running ? running->label : "ota_0",
        update ? update->label : "ota_1",
        app_info.version,
        (unsigned long)(esp_get_free_heap_size() / 1024)
    );
    httpd_resp_sendstr_chunk(req, html);

    // 2. Direct GitHub Releases Updater Card
    httpd_resp_sendstr_chunk(req,
        "<div class='card' style='border-color:#0284c7'>"
        "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'>"
        "<h3 style='margin:0;color:#38bdf8'>📦 Обновление из GitHub Releases</h3>"
        "<button class='btn btn-sm' onclick='loadGitHubReleases()'>🔄 Проверить версии</button>"
        "</div>"
        "<p style='font-size:12px;color:#94a3b8;margin-bottom:12px'>"
        "Автоматическая проверка релизов в репозитории <b>geminibitok-oss/ESP-v2</b> и установка выбранной версии в 1 клик."
        "</p>"
        "<div id='gh_status' style='font-size:12px;color:#cbd5e1;margin-bottom:10px;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid #334155'>"
        "Нажмите «Проверить версии» для загрузки списка релизов..."
        "</div>"
        "<div style='margin-bottom:12px'>"
        "<label for='rel_select' style='font-size:12px;color:#94a3b8'>Выберите какую версию установить:</label>"
        "<select id='rel_select' style='margin-bottom:8px' onchange='onSelectRelease()'>"
        "<option value='latest'>latest (Свежая автосборка)</option>"
        "</select>"
        "</div>"
        "<button id='gh_install_btn' class='btn' style='width:100%;background:#059669' onclick='installFromGitHub()'>⚡ Установить выбранную версию из GitHub</button>"
        "</div>"
    );

    // 3. Local file upload card
    httpd_resp_sendstr_chunk(req,
        "<div class='card'>"
        "<h3>📁 Или загрузите локальный файл (.bin) с компьютера</h3>"
        "<div style='margin-top:10px'>"
        "<input type='file' id='ota_file' accept='.bin' style='margin-bottom:12px'>"
        "<button id='up_btn' class='btn' style='width:100%' onclick='startOTA()'>🚀 Загрузить и обновить ESP32</button>"
        "</div>"
        "<div id='prg_box' style='display:none;margin-top:14px'>"
        "<div style='display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px'>"
        "<span id='st_txt'>Запись во Flash память...</span><span id='pct'>0%</span>"
        "</div>"
        "<div style='background:#0f172a;height:8px;border-radius:4px;overflow:hidden;border:1px solid #334155'>"
        "<div id='bar' style='background:#0284c7;width:0%;height:100%;transition:width 0.2s'></div>"
        "</div>"
        "</div>"
        "</div>"
    );

    // 4. Client-side JavaScript logic
    httpd_resp_sendstr_chunk(req,
        "<script>"
        "var ghReleases=[];"
        "function loadGitHubReleases(){"
        "var st=document.getElementById('gh_status');st.innerHTML='⏳ Запрос релизов с api.github.com...';"
        "var xhr=new XMLHttpRequest();xhr.open('GET','https://api.github.com/repos/geminibitok-oss/ESP-v2/releases?per_page=15',true);"
        "xhr.onload=function(){if(xhr.status==200){try{"
        "ghReleases=JSON.parse(xhr.responseText);"
        "var sel=document.getElementById('rel_select');sel.innerHTML='';"
        "if(ghReleases&&ghReleases.length>0){"
        "for(var i=0;i<ghReleases.length;i++){"
        "var r=ghReleases[i];"
        "var opt=document.createElement('option');opt.value=r.tag_name;"
        "opt.text=r.tag_name+(r.tag_name==='latest'?' (Свежая автосборка)':' - '+(r.name||'Релиз'));"
        "sel.appendChild(opt);"
        "}"
        "st.innerHTML='✅ Найдено релизов: <b>'+ghReleases.length+'</b>. Выберите версию ниже и нажмите кнопку установки.';"
        "}else{"
        "st.innerHTML='ℹ️ Доступен базовый релиз latest.';"
        "}"
        "}catch(e){st.innerHTML='Ошибка парсинга ответа GitHub: '+e;}}"
        "else{st.innerHTML='⚠️ GitHub API ответил статусом: '+xhr.status;}};"
        "xhr.onerror=function(){st.innerHTML='⚠️ Браузер не смог соединиться с api.github.com (проверьте доступ в интернет).';};"
        "xhr.send();"
        "}"
        "function onSelectRelease(){}"
        "function installFromGitHub(){"
        "var sel=document.getElementById('rel_select');var tag=sel.value||'latest';"
        "var binUrl='https://github.com/geminibitok-oss/ESP-v2/releases/download/'+tag+'/ESP_lestn_v2.bin';"
        "var b=document.getElementById('gh_install_btn');b.disabled=true;"
        "var p=document.getElementById('prg_box');p.style.display='block';"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "st.innerText='Загрузка бинарника '+tag+' из GitHub Releases...';"
        "var fetchXhr=new XMLHttpRequest();fetchXhr.open('GET',binUrl,true);fetchXhr.responseType='blob';"
        "fetchXhr.onprogress=function(e){if(e.lengthComputable){var pc=Math.round((e.loaded/e.total)*50);bar.style.width=pc+'%';pct.innerText=pc+'%';st.innerText='Скачивание '+tag+' из GitHub ('+pc+'%)...';}};"
        "fetchXhr.onload=function(){if(fetchXhr.status==200){"
        "var blob=fetchXhr.response;"
        "uploadBlobToEsp(blob,tag);"
        "}else{alert('Не удалось скачать '+tag+' из GitHub (статус '+fetchXhr.status+').');b.disabled=false;}};"
        "fetchXhr.onerror=function(){alert('Ошибка сети при скачивании с GitHub.');b.disabled=false;};"
        "fetchXhr.send();"
        "}"
        "function uploadBlobToEsp(blob,verTag){"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "st.innerText='Прошивка ESP32 версией '+verTag+'...';"
        "var xhr=new XMLHttpRequest();xhr.open('POST','/api/ota',true);"
        "xhr.upload.onprogress=function(e){if(e.lengthComputable){var pc=50+Math.round((e.loaded/e.total)*50);bar.style.width=pc+'%';pct.innerText=pc+'%';st.innerText='Запись '+verTag+' во Flash ('+pc+'%)...';}};"
        "xhr.onload=function(){if(xhr.status==200){"
        "st.innerText='Успех! Контроллер прошит на '+verTag+' и перезагружается...';bar.style.background='#16a34a';"
        "var c=15;var ti=setInterval(function(){st.innerText='Перезагрузка... ('+c+'с)';if(--c<=0){clearInterval(ti);location.href='/';}},1000);"
        "}else{alert('Ошибка OTA при записи: '+xhr.responseText);document.getElementById('gh_install_btn').disabled=false;}};"
        "xhr.onerror=function(){alert('Сбой сети при отправке прошивки в ESP32');document.getElementById('gh_install_btn').disabled=false;};"
        "xhr.send(blob);"
        "}"
        "function startOTA(){"
        "var f=document.getElementById('ota_file').files[0];"
        "if(!f){alert('Пожалуйста, выберите .bin файл');return;}"
        "var b=document.getElementById('up_btn');b.disabled=true;"
        "var p=document.getElementById('prg_box');p.style.display='block';"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "var xhr=new XMLHttpRequest();xhr.open('POST','/api/ota',true);"
        "xhr.upload.onprogress=function(e){if(e.lengthComputable){var pc=Math.round((e.loaded/e.total)*100);bar.style.width=pc+'%';pct.innerText=pc+'%';}};"
        "xhr.onload=function(){if(xhr.status==200){st.innerText='Успех! Контроллер перезагружается...';bar.style.background='#16a34a';"
        "var c=15;var ti=setInterval(function(){st.innerText='Перезагрузка... ('+c+'с)';if(--c<=0){clearInterval(ti);location.href='/';}},1000);"
        "}else{alert('Ошибка OTA: '+xhr.responseText);b.disabled=false;}};"
        "xhr.onerror=function(){alert('Сбой сети при передаче OTA');b.disabled=false;};"
        "xhr.send(f);"
        "}"
        "setTimeout(loadGitHubReleases, 400);"
        "</script>"
    );

    web_send_html_footer(req);
    return ESP_OK;
}

esp_err_t ota_status_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *configured = esp_ota_get_boot_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t running_app_info;
    if (esp_ota_get_partition_description(running, &running_app_info) != ESP_OK) {
        strncpy(running_app_info.version, "2.0.0", sizeof(running_app_info.version));
        strncpy(running_app_info.project_name, "ESP_lestn_v2", sizeof(running_app_info.project_name));
    }

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{"
        "\"project_name\":\"%s\","
        "\"version\":\"%s\","
        "\"running_partition\":\"%s\","
        "\"running_address\":\"0x%lx\","
        "\"boot_partition\":\"%s\","
        "\"next_update_partition\":\"%s\","
        "\"free_heap\":%lu"
        "}",
        running_app_info.project_name,
        running_app_info.version,
        running ? running->label : "unknown",
        running ? (unsigned long)running->address : 0,
        configured ? configured->label : "unknown",
        update ? update->label : "unknown",
        (unsigned long)esp_get_free_heap_size()
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
}

esp_err_t ota_post_handler(httpd_req_t *req)
{
    esp_ota_handle_t update_handle = 0;
    const esp_partition_t *update_partition = NULL;

    ESP_LOGI(TAG, "Starting Over-The-Air (OTA) firmware update...");

    update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "Passive OTA partition not found");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA partition not found");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Writing to partition subtype %d at offset 0x%lx (label: %s)",
             update_partition->subtype, (unsigned long)update_partition->address, update_partition->label);

    int total_len = req->content_len;
    if (total_len <= 0) {
        ESP_LOGE(TAG, "Content-Length not specified or invalid");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Content-Length header required");
        return ESP_FAIL;
    }

    esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "esp_ota_begin failed");
        return ESP_FAIL;
    }

    char *ota_write_data = (char *)malloc(OTA_BUFF_SIZE);
    if (!ota_write_data) {
        ESP_LOGE(TAG, "Failed to allocate OTA buffer");
        esp_ota_abort(update_handle);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_ERR_NO_MEM;
    }

    int remaining = total_len;
    bool is_first_chunk = true;

    while (remaining > 0) {
        int to_read = remaining > OTA_BUFF_SIZE ? OTA_BUFF_SIZE : remaining;
        int received = httpd_req_recv(req, ota_write_data, to_read);
        if (received <= 0) {
            if (received == HTTPD_SOCK_ERR_TIMEOUT) {
                continue; // Retry on timeout
            }
            ESP_LOGE(TAG, "File receive error: %d", received);
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA transfer interrupted");
            return ESP_FAIL;
        }

        if (is_first_chunk) {
            is_first_chunk = false;
            // Validate magic byte (0xE9 for ESP32 image)
            if ((uint8_t)ota_write_data[0] != 0xE9) {
                ESP_LOGE(TAG, "Invalid image magic byte: 0x%02X (expected 0xE9)", (uint8_t)ota_write_data[0]);
                free(ota_write_data);
                esp_ota_abort(update_handle);
                httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid firmware binary header");
                return ESP_FAIL;
            }
        }

        err = esp_ota_write(update_handle, (const void *)ota_write_data, received);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "esp_ota_write failed (%s)", esp_err_to_name(err));
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Flash write failed");
            return ESP_FAIL;
        }

        remaining -= received;
    }

    free(ota_write_data);

    err = esp_ota_end(update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Firmware validation failed");
        return ESP_FAIL;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to switch boot partition");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "OTA upgrade successful! Next boot partition: %s. Scheduling reboot in 1.5s...", update_partition->label);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    const char *resp = "{\"status\":\"success\",\"message\":\"Firmware successfully flashed. Rebooting ESP32...\"}";
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);

    // Schedule reboot after sending response
    web_schedule_restart(1500);

    return ESP_OK;
}
`
  },
  {
    name: 'web_server.c',
    path: 'main/web_server.c',
    category: 'web',
    description: 'Главная точка регистрации эндпоинтов и запуска HTTP сервера ESP-IDF.',
    code: `#include "web_server.h"
#include "web_routes.h"
#include "web_common.h"

static const char *TAG = "WEB_SERVER";
static httpd_handle_t server = NULL;

extern void web_index_set_settings(staircase_settings_t *settings);
extern void web_settings_set_settings(staircase_settings_t *settings);
extern void web_wifi_set_settings(staircase_settings_t *settings);
extern void web_api_set_settings(staircase_settings_t *settings);

esp_err_t web_server_start(staircase_settings_t *settings)
{
    web_index_set_settings(settings);
    web_settings_set_settings(settings);
    web_wifi_set_settings(settings);
    web_api_set_settings(settings);

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 16;
    config.stack_size = 8192;
    config.lru_purge_enable = true;
    config.max_resp_headers = 16;

    ESP_LOGI(TAG, "Starting HTTP Web Server on port %d...", config.server_port);

    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return err;
    }

    httpd_uri_t uri_index = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_get = { .uri = "/settings", .method = HTTP_GET, .handler = settings_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_post = { .uri = "/settings", .method = HTTP_POST, .handler = settings_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_get = { .uri = "/wifi", .method = HTTP_GET, .handler = wifi_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_post = { .uri = "/wifi", .method = HTTP_POST, .handler = wifi_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_state = { .uri = "/api/state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_trigger = { .uri = "/api/trigger", .method = HTTP_GET, .handler = api_trigger_handler, .user_ctx = NULL };

    /* OTA Обновление прошивки */
    httpd_uri_t uri_ota_page = { .uri = "/update", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_page_alt = { .uri = "/ota", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post = { .uri = "/api/ota", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post_update = { .uri = "/update", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_status = { .uri = "/api/ota/status", .method = HTTP_GET, .handler = ota_status_handler, .user_ctx = NULL };

    /* Для обратной совместимости */
    httpd_uri_t uri_led_state = { .uri = "/led-state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };

    httpd_register_uri_handler(server, &uri_index);
    httpd_register_uri_handler(server, &uri_settings_get);
    httpd_register_uri_handler(server, &uri_settings_post);
    httpd_register_uri_handler(server, &uri_wifi_get);
    httpd_register_uri_handler(server, &uri_wifi_post);
    httpd_register_uri_handler(server, &uri_api_state);
    httpd_register_uri_handler(server, &uri_api_trigger);
    httpd_register_uri_handler(server, &uri_ota_page);
    httpd_register_uri_handler(server, &uri_ota_page_alt);
    httpd_register_uri_handler(server, &uri_ota_post);
    httpd_register_uri_handler(server, &uri_ota_post_update);
    httpd_register_uri_handler(server, &uri_ota_status);
    httpd_register_uri_handler(server, &uri_led_state);

    ESP_LOGI(TAG, "Web server started with endpoints: /, /settings, /wifi, /update, /api/state, /api/ota");
    return ESP_OK;
}`
  },
  {
    name: 'web_server.h',
    path: 'main/web_server.h',
    category: 'web',
    description: 'Интерфейс веб-сервера управления.',
    code: `#pragma once

#include "esp_err.h"
#include "settings.h"

esp_err_t web_server_start(staircase_settings_t *settings);`
  },
  {
    name: 'sensors.h',
    path: 'main/sensors.h',
    category: 'driver',
    description: 'Интерфейс драйвера датчиков присутствия (цифровые PIR/оптические и ультразвуковые HC-SR04).',
    code: `#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t sensors_init(const staircase_settings_t *settings);
bool sensor_bottom_active(void);
bool sensor_top_active(void);
int sensor_bottom_level(void);
int sensor_top_level(void);

// Функции для работы с ультразвуковыми дальномерами HC-SR04
uint16_t sensor_bottom_distance_cm(void);
uint16_t sensor_top_distance_cm(void);
bool sensor_is_ultrasonic(void);
void sensors_reset_state(void);`
  },
  {
    name: 'sensors.c',
    path: 'main/sensors.c',
    category: 'driver',
    description: 'Драйвер датчиков присутствия: цифровой режим (PIR/оптика с подавлением дребезга) и ультразвуковой режим HC-SR04 (эхолокация в см с фильтрацией шумов).',
    code: `#include "sensors.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "SENSORS";

static staircase_settings_t cfg;
static int64_t last_bottom_change_us = 0;
static int64_t last_top_change_us = 0;
static bool last_bottom_state = false;
static bool last_top_state = false;

static uint16_t bottom_dist_cm = 999;
static uint16_t top_dist_cm = 999;

// Измерение расстояния дальномером HC-SR04 (в сантиметрах)
static uint16_t measure_hcsr04_distance(gpio_num_t trig_pin, gpio_num_t echo_pin, uint16_t max_dist_cm)
{
    // 1. Короткий импульс TRIG 10 мкс
    gpio_set_level(trig_pin, 0);
    esp_rom_delay_us(4);
    gpio_set_level(trig_pin, 1);
    esp_rom_delay_us(10);
    gpio_set_level(trig_pin, 0);

    // 2. Ожидание начала импульса ECHO (HIGH) с таймаутом ~10 мс
    int64_t start_wait = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 0) {
        if ((esp_timer_get_time() - start_wait) > 10000) {
            return 999; // Таймаут старта
        }
    }

    // 3. Измерение длительности импульса ECHO
    int64_t echo_start = esp_timer_get_time();
    int64_t max_echo_time = echo_start + (int64_t)max_dist_cm * 58 + 2000;

    while (gpio_get_level(echo_pin) == 1) {
        if (esp_timer_get_time() > max_echo_time) {
            return 999; // Превышение максимальной дистанции
        }
    }
    int64_t echo_end = esp_timer_get_time();
    int64_t duration_us = echo_end - echo_start;

    // Скорость звука ~ 343 м/с -> 1 см за 58.2 мкс
    uint16_t dist = (uint16_t)(duration_us / 58);
    if (dist < 2 || dist > max_dist_cm) {
        return 999;
    }
    return dist;
}

// Фоновая задача опроса ультразвуковых датчиков HC-SR04
static void ultrasonic_task(void *pvParameters)
{
    ESP_LOGI(TAG, "HC-SR04 Ultrasonic background polling task started");

    while (1)
    {
        if (cfg.sensor_type == 1) {
            // Опрос нижнего датчика HC-SR04 (TRIG = cfg.sensor_bottom_gpio, ECHO = cfg.sensor_bottom_echo_gpio)
            uint16_t d_bot = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_bottom_gpio,
                (gpio_num_t)cfg.sensor_bottom_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            bottom_dist_cm = d_bot;
            last_bottom_state = (d_bot > 0 && d_bot <= cfg.ultrasonic_trigger_distance_cm);

            vTaskDelay(pdMS_TO_TICKS(25)); // Задержка между ультразвуковыми пингами

            // Опрос верхнего датчика HC-SR04 (TRIG = cfg.sensor_top_gpio, ECHO = cfg.sensor_top_echo_gpio)
            uint16_t d_top = measure_hcsr04_distance(
                (gpio_num_t)cfg.sensor_top_gpio,
                (gpio_num_t)cfg.sensor_top_echo_gpio,
                cfg.ultrasonic_max_distance_cm
            );
            top_dist_cm = d_top;
            last_top_state = (d_top > 0 && d_top <= cfg.ultrasonic_trigger_distance_cm);
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

esp_err_t sensors_init(const staircase_settings_t *settings)
{
    cfg = *settings;

    if (cfg.sensor_type == 1) {
        // Конфигурация для HC-SR04:
        // TRIG пины как ВЫХОДЫ
        gpio_config_t trig_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&trig_conf));
        gpio_set_level((gpio_num_t)cfg.sensor_bottom_gpio, 0);
        gpio_set_level((gpio_num_t)cfg.sensor_top_gpio, 0);

        // ECHO пины как ВХОДЫ с подтяжкой к земле
        gpio_config_t echo_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_echo_gpio) | (1ULL << cfg.sensor_top_echo_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_ENABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&echo_conf));

        xTaskCreate(ultrasonic_task, "ultrasonic_task", 3072, NULL, 4, NULL);

        ESP_LOGI(TAG, "HC-SR04 Sensors initialized: Bottom TRIG=%d/ECHO=%d, Top TRIG=%d/ECHO=%d, Trigger=%d cm",
                 cfg.sensor_bottom_gpio, cfg.sensor_bottom_echo_gpio,
                 cfg.sensor_top_gpio, cfg.sensor_top_echo_gpio,
                 cfg.ultrasonic_trigger_distance_cm);
    } else {
        // Конфигурация для цифровых PIR / оптических датчиков
        gpio_config_t io_conf = {
            .pin_bit_mask = (1ULL << cfg.sensor_bottom_gpio) | (1ULL << cfg.sensor_top_gpio),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = cfg.sensor_active_high ? GPIO_PULLUP_DISABLE : GPIO_PULLUP_ENABLE,
            .pull_down_en = cfg.sensor_active_high ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&io_conf));

        ESP_LOGI(TAG, "PIR/Optical Sensors initialized: Bottom GPIO %d, Top GPIO %d (Active: %s, Debounce: %d ms)",
                 cfg.sensor_bottom_gpio, cfg.sensor_top_gpio,
                 cfg.sensor_active_high ? "HIGH" : "LOW",
                 cfg.sensor_debounce_ms);
    }

    return ESP_OK;
}

int sensor_bottom_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_bottom_gpio);
}

int sensor_top_level(void)
{
    return gpio_get_level((gpio_num_t)cfg.sensor_top_gpio);
}

uint16_t sensor_bottom_distance_cm(void)
{
    return bottom_dist_cm;
}

uint16_t sensor_top_distance_cm(void)
{
    return top_dist_cm;
}

bool sensor_is_ultrasonic(void)
{
    return (cfg.sensor_type == 1);
}

bool sensor_bottom_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_bottom_state;
    }

    int level = sensor_bottom_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_bottom_state) {
        if ((now_us - last_bottom_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_bottom_state = raw_active;
            last_bottom_change_us = now_us;
        }
    }
    return last_bottom_state;
}

bool sensor_top_active(void)
{
    if (cfg.sensor_type == 1) {
        return last_top_state;
    }

    int level = sensor_top_level();
    bool raw_active = cfg.sensor_active_high ? (level == 1) : (level == 0);
    int64_t now_us = esp_timer_get_time();

    if (raw_active != last_top_state) {
        if ((now_us - last_top_change_us) >= (int64_t)cfg.sensor_debounce_ms * 1000) {
            last_top_state = raw_active;
            last_top_change_us = now_us;
        }
    }
    return last_top_state;
}

void sensors_reset_state(void)
{
    last_bottom_state = false;
    last_top_state = false;
    bottom_dist_cm = 999;
    top_dist_cm = 999;
    ESP_LOGI(TAG, "Sensors manually reset to idle state");
}`
  },
  {
    name: 'settings.h',
    path: 'main/settings.h',
    category: 'core',
    description: 'Структура конфигурации и интерфейс сохранения в энергонезависимую память (NVS).',
    code: `#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    uint16_t steps;
    uint16_t pixels_per_step;
    uint8_t brightness;
    uint8_t night_brightness;
    uint16_t step_on_time_ms;
    uint16_t step_off_time_ms;
    uint16_t hold_time_ms;
    uint8_t color_r;
    uint8_t color_g;
    uint8_t color_b;
    uint8_t led_gpio;
    uint8_t sensor_bottom_gpio;
    uint8_t sensor_top_gpio;
    bool sensor_active_high;
    uint16_t sensor_debounce_ms;
    bool night_mode;
    // Управление первой и последней ступенью
    bool enable_first_step;
    bool enable_last_step;
    bool night_first_step;
    bool night_last_step;
    char wifi_ssid[32];
    char wifi_password[64];
    char hostname[32];
    // Датчики: 0 = Цифровой PIR / Оптический, 1 = Ультразвуковой HC-SR04
    uint8_t sensor_type;
    uint8_t sensor_bottom_echo_gpio;
    uint8_t sensor_top_echo_gpio;
    uint16_t ultrasonic_trigger_distance_cm;
    uint16_t ultrasonic_max_distance_cm;
    // Время NTP и Астротаймер
    bool ntp_enabled;
    char ntp_server[64];
    int8_t timezone_offset;
    float latitude;
    float longitude;
    uint8_t schedule_mode;
    int16_t sunset_offset_min;
    int16_t sunrise_offset_min;
    uint8_t fixed_on_hour;
    uint8_t fixed_on_minute;
    uint8_t fixed_off_hour;
    uint8_t fixed_off_minute;
} staircase_settings_t;

void settings_init(staircase_settings_t *settings);
esp_err_t settings_load(staircase_settings_t *settings);
esp_err_t settings_save(const staircase_settings_t *settings);
esp_err_t settings_reset_defaults(staircase_settings_t *settings);`
  },
  {
    name: 'settings.c',
    path: 'main/settings.c',
    category: 'core',
    description: 'Сохранение и загрузка настроек лестницы в ESP32 NVS.',
    code: `#include "settings.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "SETTINGS";
static const char *NVS_NAMESPACE = "stair_cfg";

void settings_init(staircase_settings_t *settings)
{
    settings->steps = 18;
    settings->pixels_per_step = 1;
    settings->brightness = 80;
    settings->night_brightness = 20;
    settings->step_on_time_ms = 150;
    settings->step_off_time_ms = 150;
    settings->hold_time_ms = 5000;
    settings->color_r = 255;
    settings->color_g = 220;
    settings->color_b = 180;
    settings->led_gpio = 4;
    settings->sensor_bottom_gpio = 23;
    settings->sensor_top_gpio = 22;
    settings->sensor_active_high = true;
    settings->sensor_debounce_ms = 50;
    settings->night_mode = false;
    settings->enable_first_step = true;
    settings->enable_last_step = true;
    settings->night_first_step = true;
    settings->night_last_step = true;
    strncpy(settings->wifi_ssid, "ESP-Lestn", sizeof(settings->wifi_ssid));
    settings->wifi_password[0] = '\0';
    strncpy(settings->hostname, "esp-lestn", sizeof(settings->hostname));

    // Настройки датчиков HC-SR04
    settings->sensor_type = 0; // 0 = PIR / Оптика, 1 = HC-SR04
    settings->sensor_bottom_echo_gpio = 18;
    settings->sensor_top_echo_gpio = 19;
    settings->ultrasonic_trigger_distance_cm = 80;
    settings->ultrasonic_max_distance_cm = 200;

    // Астрономическое время
    settings->ntp_enabled = true;
    strncpy(settings->ntp_server, "pool.ntp.org", sizeof(settings->ntp_server));
    settings->timezone_offset = 3;
    settings->latitude = 55.7558f;
    settings->longitude = 37.6173f;
    settings->schedule_mode = 0;
    settings->sunset_offset_min = 0;
    settings->sunrise_offset_min = 0;
    settings->fixed_on_hour = 22;
    settings->fixed_on_minute = 0;
    settings->fixed_off_hour = 7;
    settings->fixed_off_minute = 0;
}

esp_err_t settings_load(staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No saved settings found in NVS, using defaults");
        return err;
    }

    size_t required_size = sizeof(staircase_settings_t);
    err = nvs_get_blob(nvs_h, "config", settings, &required_size);
    nvs_close(nvs_h);

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Settings successfully loaded from NVS");
    } else {
        ESP_LOGE(TAG, "Failed to read blob from NVS: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t settings_save(const staircase_settings_t *settings)
{
    nvs_handle_t nvs_h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs_h);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS for writing: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_set_blob(nvs_h, "config", settings, sizeof(staircase_settings_t));
    if (err == ESP_OK) {
        err = nvs_commit(nvs_h);
        ESP_LOGI(TAG, "Settings successfully saved and committed to NVS");
    } else {
        ESP_LOGE(TAG, "Failed to write blob to NVS: %s", esp_err_to_name(err));
    }

    nvs_close(nvs_h);
    return err;
}

esp_err_t settings_reset_defaults(staircase_settings_t *settings)
{
    settings_init(settings);
    return settings_save(settings);
}`
  },
  {
    name: 'wifi_manager.c',
    path: 'main/wifi_manager.c',
    category: 'driver',
    description: 'Управление Wi-Fi (автопереключение STA -> AP, mDNS, статический/DHCP IP).',
    code: `#include "wifi_manager.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "mdns.h"

static const char *TAG = "WIFI_MGR";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t wifi_event_group;
static staircase_settings_t *cfg = NULL;
static bool is_ap = true;
static char current_ip[16] = "192.168.4.1";
static int retry_num = 0;
#define MAX_STA_RETRIES 5

static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (retry_num < MAX_STA_RETRIES) {
            esp_wifi_connect();
            retry_num++;
            ESP_LOGI(TAG, "Retrying Wi-Fi STA connection (%d/%d)...", retry_num, MAX_STA_RETRIES);
        } else {
            xEventGroupSetBits(wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "Failed to connect to STA. Falling back to AP mode.");
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        snprintf(current_ip, sizeof(current_ip), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "Connected to Wi-Fi! IP: %s", current_ip);
        printf("\r\n===================================================\r\n");
        printf(" [UART / WI-FI] ESP32 ПОЛУЧИЛ IP-АДРЕС В СЕТИ:\r\n");
        printf(" >>>  IP: %s  <<<\r\n", current_ip);
        printf(" Веб-интерфейс: http://%s\r\n", current_ip);
        printf("===================================================\r\n\r\n");
        fflush(stdout);
        retry_num = 0;
        is_ap = false;
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_manager_start_ap(void)
{
    wifi_config_t wifi_config = {
        .ap = {
            .ssid = "ESP-Lestn",
            .ssid_len = strlen("ESP-Lestn"),
            .channel = 1,
            .password = "",
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    is_ap = true;
    strncpy(current_ip, "192.168.4.1", sizeof(current_ip));
    ESP_LOGI(TAG, "Access Point started: SSID='ESP-Lestn', IP=%s", current_ip);
    return ESP_OK;
}

static esp_err_t start_sta_internal(void)
{
    retry_num = 0;
    wifi_config_t wifi_config = {0};
    strncpy((char*)wifi_config.sta.ssid, cfg->wifi_ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char*)wifi_config.sta.password, cfg->wifi_password, sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to Wi-Fi SSID: '%s'...", cfg->wifi_ssid);

    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            pdMS_TO_TICKS(15000));

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to SSID:%s", cfg->wifi_ssid);
        return ESP_OK;
    } else {
        ESP_LOGW(TAG, "Falling back to AP mode");
        esp_wifi_stop();
        return wifi_manager_start_ap();
    }
}

esp_err_t wifi_manager_init(staircase_settings_t *settings)
{
    cfg = settings;
    wifi_event_group = xEventGroupCreate();

    esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        NULL));

    // Инициализация mDNS
    mdns_init();
    mdns_hostname_set(cfg->hostname[0] ? cfg->hostname : "esp-lestn");
    mdns_instance_name_set("ESP32 Smart Staircase");

    if (cfg->wifi_ssid[0] != '\0' && strcmp(cfg->wifi_ssid, "ESP-Lestn") != 0) {
        return start_sta_internal();
    } else {
        return wifi_manager_start_ap();
    }
}

bool wifi_manager_is_connected(void)
{
    return !is_ap;
}

const char *wifi_manager_get_ip(void)
{
    return current_ip;
}

bool wifi_manager_is_ap_mode(void)
{
    return is_ap;
}

esp_err_t wifi_manager_reconnect_sta(void)
{
    if (cfg == NULL || cfg->wifi_ssid[0] == '\0') return ESP_ERR_INVALID_STATE;
    return start_sta_internal();
}`
  },
  {
    name: 'wifi_manager.h',
    path: 'main/wifi_manager.h',
    category: 'driver',
    description: 'Интерфейс управления Wi-Fi подсистемой.',
    code: `#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t wifi_manager_init(staircase_settings_t *settings);
bool wifi_manager_is_connected(void);
const char *wifi_manager_get_ip(void);
bool wifi_manager_is_ap_mode(void);
esp_err_t wifi_manager_start_ap(void);
esp_err_t wifi_manager_reconnect_sta(void);`
  },
  {
    name: 'time_astro.h',
    path: 'main/time_astro.h',
    category: 'core',
    description: 'Заголовочный файл сервиса времени NTP и астрономического расчета заката/восхода солнца (NOAA).',
    code: `#ifndef TIME_ASTRO_H
#define TIME_ASTRO_H

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*time_astro_state_cb_t)(bool is_night);

typedef struct {
    bool synced;
    char time_str[32];
    char sunrise_str[16];
    char sunset_str[16];
    bool is_night_time;
    char next_switch_str[32];
} time_astro_status_t;

esp_err_t time_astro_init(staircase_settings_t *settings, time_astro_state_cb_t cb);
void time_astro_apply_settings(const staircase_settings_t *settings);
bool time_astro_is_synced(void);
bool time_astro_is_night(void);
void time_astro_get_status(time_astro_status_t *status);

#ifdef __cplusplus
}
#endif

#endif // TIME_ASTRO_H`
  },
  {
    name: 'time_astro.c',
    path: 'main/time_astro.c',
    category: 'core',
    description: 'Реализация SNTP клиента, алгоритма NOAA для заката/восхода и фоновой задачи переключения режимов.',
    code: `#include "time_astro.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_sntp.h"

static const char *TAG = "TIME_ASTRO";

static staircase_settings_t *cfg = NULL;
static time_astro_state_cb_t state_callback = NULL;
static bool sntp_initialized = false;
static bool time_is_synced = false;
static bool current_night_state = false;

// Расчет времени заката и восхода по алгоритму NOAA
static void calculate_solar_times(time_t current_time, float lat, float lon, int tz_offset,
                                  int *sunrise_min, int *sunset_min)
{
    struct tm timeinfo;
    localtime_r(&current_time, &timeinfo);
    int day_of_year = timeinfo.tm_yday + 1;

    const double PI_D = 3.14159265358979323846;
    const double DEG2RAD = PI_D / 180.0;
    const double RAD2DEG = 180.0 / PI_D;

    double B = (360.0 / 365.0) * (day_of_year - 81) * DEG2RAD;
    double eot = 9.87 * sin(2 * B) - 7.53 * cos(B) - 1.5 * sin(B);
    double decl = 23.45 * sin((360.0 / 365.0) * (day_of_year - 81) * DEG2RAD);
    double decl_rad = decl * DEG2RAD;
    double lat_rad = (double)lat * DEG2RAD;

    double zenith = 90.8333 * DEG2RAD;
    double cos_ha = (cos(zenith) - sin(lat_rad) * sin(decl_rad)) / (cos(lat_rad) * cos(decl_rad));
    if (cos_ha > 1.0) cos_ha = 1.0;
    if (cos_ha < -1.0) cos_ha = -1.0;

    double ha_deg = acos(cos_ha) * RAD2DEG;
    double ha_hours = ha_deg / 15.0;

    double solar_noon = 12.0 - ((double)lon / 15.0) - (eot / 60.0) + (double)tz_offset;
    double sunrise_hour = solar_noon - ha_hours;
    double sunset_hour = solar_noon + ha_hours;

    while (sunrise_hour < 0.0) sunrise_hour += 24.0;
    while (sunrise_hour >= 24.0) sunrise_hour -= 24.0;
    while (sunset_hour < 0.0) sunset_hour += 24.0;
    while (sunset_hour >= 24.0) sunset_hour -= 24.0;

    if (sunrise_min) *sunrise_min = (int)round(sunrise_hour * 60.0);
    if (sunset_min) *sunset_min = (int)round(sunset_hour * 60.0);
}

// Фоновая задача проверки времени и переключения дня/ночи
static void astro_task(void *arg)
{
    while (1)
    {
        vTaskDelay(pdMS_TO_TICKS(15000));
        if (!cfg) continue;

        time_t now;
        time(&now);
        struct tm timeinfo;
        localtime_r(&now, &timeinfo);

        if (timeinfo.tm_year > (2020 - 1900)) {
            time_is_synced = true;
        }

        bool should_be_night = false;
        int cur_min = timeinfo.tm_hour * 60 + timeinfo.tm_min;

        if (cfg->schedule_mode == 0 && time_is_synced) {
            int sunrise_m = 360, sunset_m = 1200;
            calculate_solar_times(now, cfg->latitude, cfg->longitude, cfg->timezone_offset, &sunrise_m, &sunset_m);
            int on_time = sunset_m + cfg->sunset_offset_min;
            int off_time = sunrise_m + cfg->sunrise_offset_min;
            while (on_time < 0) on_time += 1440;
            while (on_time >= 1440) on_time -= 1440;
            while (off_time < 0) off_time += 1440;
            while (off_time >= 1440) off_time -= 1440;

            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 1 && time_is_synced) {
            int on_time = cfg->fixed_on_hour * 60 + cfg->fixed_on_minute;
            int off_time = cfg->fixed_off_hour * 60 + cfg->fixed_off_minute;
            if (on_time > off_time) {
                should_be_night = (cur_min >= on_time || cur_min < off_time);
            } else {
                should_be_night = (cur_min >= on_time && cur_min < off_time);
            }
        } else if (cfg->schedule_mode == 2) {
            should_be_night = true;
        } else {
            should_be_night = false;
        }

        if (should_be_night != current_night_state) {
            current_night_state = should_be_night;
            if (state_callback) state_callback(current_night_state);
        }
    }
}`
  },
  {
    name: 'web_ota.h',
    path: 'main/web_ota.h',
    category: 'web',
    description: 'Интерфейс обновления прошивки ESP32 по воздуху (OTA по Wi-Fi через HTTP POST).',
    code: `#ifndef WEB_OTA_H
#define WEB_OTA_H

#include "web_common.h"
#include "esp_ota_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Обработчик GET запроса для отображения HTML страницы OTA обновления */
esp_err_t ota_page_handler(httpd_req_t *req);

/* Обработчик POST запроса для прошивки бинарного файла (.bin) по воздуху (OTA) */
esp_err_t ota_post_handler(httpd_req_t *req);

/* Обработчик GET запроса для получения информации о текущих разделах OTA и версии */
esp_err_t ota_status_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_OTA_H`
  },
  {
    name: 'web_ota.c',
    path: 'main/web_ota.c',
    category: 'web',
    description: 'Драйвер OTA прошивки: прием .bin через веб-сервер, запись во второй OTA слот и перезагрузка.',
    code: `#include "web_ota.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"

static const char *TAG = "WEB_OTA";

#define OTA_BUFF_SIZE 1024

esp_err_t ota_page_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t app_info;
    if (esp_ota_get_partition_description(running, &app_info) != ESP_OK) {
        strncpy(app_info.version, "2.0.0", sizeof(app_info.version));
    }

    web_send_html_header(req, "Обновление (OTA)");

    char html[2048];
    snprintf(html, sizeof(html),
        "<div class='card'>"
        "<h2>🔄 Беспроводное обновление (OTA)</h2>"
        "<p style='font-size:13px;color:#94a3b8;margin-bottom:12px'>"
        "Загрузка нового файла прошивки <code>ESP_lestn_v2.bin</code> прямо через браузер без подключения USB кабеля."
        "</p>"
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Текущий слот</div>"
        "<strong style='color:#38bdf8'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Слот для записи</div>"
        "<strong style='color:#34d399'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Версия</div>"
        "<strong style='color:#f8fafc'>v%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Свободно RAM</div>"
        "<strong style='color:#fbbf24'>%lu КБ</strong>"
        "</div>"
        "</div>"
        "<div style='margin-top:16px'>"
        "<label for='ota_file'>Выберите файл прошивки (.bin):</label>"
        "<input type='file' id='ota_file' accept='.bin' style='margin-bottom:12px'>"
        "<button id='up_btn' class='btn' style='width:100%%' onclick='startOTA()'>🚀 Загрузить и обновить ESP32</button>"
        "<div id='prg_box' style='display:none;margin-top:14px'>"
        "<div style='display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px'>"
        "<span id='st_txt'>Запись во Flash память...</span><span id='pct'>0%%</span>"
        "</div>"
        "<div style='background:#0f172a;height:8px;border-radius:4px;overflow:hidden;border:1px solid #334155'>"
        "<div id='bar' style='background:#0284c7;width:0%%;height:100%%;transition:width 0.2s'></div>"
        "</div>"
        "</div>"
        "</div>"
        "</div>"
        "<script>"
        "function startOTA(){"
        "var f=document.getElementById('ota_file').files[0];"
        "if(!f){alert('Пожалуйста, выберите .bin файл');return;}"
        "var b=document.getElementById('up_btn');b.disabled=true;"
        "var p=document.getElementById('prg_box');p.style.display='block';"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "var xhr=new XMLHttpRequest();xhr.open('POST','/api/ota',true);"
        "xhr.upload.onprogress=function(e){if(e.lengthComputable){var pc=Math.round((e.loaded/e.total)*100);bar.style.width=pc+'%%';pct.innerText=pc+'%%';}};"
        "xhr.onload=function(){if(xhr.status==200){st.innerText='Успех! Контроллер перезагружается...';bar.style.background='#16a34a';"
        "var c=15;var ti=setInterval(function(){st.innerText='Перезагрузка... ('+c+'с)';if(--c<=0){clearInterval(ti);location.href='/';}},1000);"
        "}else{alert('Ошибка OTA: '+xhr.responseText);b.disabled=false;}};"
        "xhr.onerror=function(){alert('Сбой сети при передаче OTA');b.disabled=false;};"
        "xhr.send(f);"
        "}"
        "</script>",
        running ? running->label : "ota_0",
        update ? update->label : "ota_1",
        app_info.version,
        (unsigned long)(esp_get_free_heap_size() / 1024)
    );

    httpd_resp_sendstr_chunk(req, html);
    web_send_html_footer(req);
    return ESP_OK;
}

esp_err_t ota_status_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *configured = esp_ota_get_boot_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t running_app_info;
    if (esp_ota_get_partition_description(running, &running_app_info) != ESP_OK) {
        strncpy(running_app_info.version, "2.0.0", sizeof(running_app_info.version));
        strncpy(running_app_info.project_name, "ESP_lestn_v2", sizeof(running_app_info.project_name));
    }

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{"
        "\\"project_name\\":\\"%s\\","
        "\\"version\\":\\"%s\\","
        "\\"running_partition\\":\\"%s\\","
        "\\"running_address\\":\\"0x%lx\\","
        "\\"boot_partition\\":\\"%s\\","
        "\\"next_update_partition\\":\\"%s\\","
        "\\"free_heap\\":%lu"
        "}",
        running_app_info.project_name,
        running_app_info.version,
        running ? running->label : "unknown",
        running ? (unsigned long)running->address : 0,
        configured ? configured->label : "unknown",
        update ? update->label : "unknown",
        (unsigned long)esp_get_free_heap_size()
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
}

esp_err_t ota_post_handler(httpd_req_t *req)
{
    esp_ota_handle_t update_handle = 0;
    const esp_partition_t *update_partition = NULL;

    ESP_LOGI(TAG, "Starting Over-The-Air (OTA) firmware update...");

    update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "Passive OTA partition not found");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA partition not found");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Writing to partition subtype %d at offset 0x%lx (label: %s)",
             update_partition->subtype, (unsigned long)update_partition->address, update_partition->label);

    int total_len = req->content_len;
    if (total_len <= 0) {
        ESP_LOGE(TAG, "Content-Length not specified or invalid");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Content-Length header required");
        return ESP_FAIL;
    }

    esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "esp_ota_begin failed");
        return ESP_FAIL;
    }

    char *ota_write_data = (char *)malloc(OTA_BUFF_SIZE);
    if (!ota_write_data) {
        ESP_LOGE(TAG, "Failed to allocate OTA buffer");
        esp_ota_abort(update_handle);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_ERR_NO_MEM;
    }

    int remaining = total_len;
    bool is_first_chunk = true;

    while (remaining > 0) {
        int to_read = remaining > OTA_BUFF_SIZE ? OTA_BUFF_SIZE : remaining;
        int received = httpd_req_recv(req, ota_write_data, to_read);
        if (received <= 0) {
            if (received == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            ESP_LOGE(TAG, "File receive error: %d", received);
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA transfer interrupted");
            return ESP_FAIL;
        }

        if (is_first_chunk) {
            is_first_chunk = false;
            if ((uint8_t)ota_write_data[0] != 0xE9) {
                ESP_LOGE(TAG, "Invalid image magic byte: 0x%02X (expected 0xE9)", (uint8_t)ota_write_data[0]);
                free(ota_write_data);
                esp_ota_abort(update_handle);
                httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid firmware binary header");
                return ESP_FAIL;
            }
        }

        err = esp_ota_write(update_handle, (const void *)ota_write_data, received);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "esp_ota_write failed (%s)", esp_err_to_name(err));
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Flash write failed");
            return ESP_FAIL;
        }

        remaining -= received;
    }

    free(ota_write_data);

    err = esp_ota_end(update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Firmware validation failed");
        return ESP_FAIL;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to switch boot partition");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "OTA upgrade successful! Next boot partition: %s. Scheduling reboot...", update_partition->label);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    const char *resp = "{\\"status\\":\\"success\\",\\"message\\":\\"Firmware successfully flashed. Rebooting ESP32...\\"}";
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);

    web_schedule_restart(1500);

    return ESP_OK;
}`
  },
  {
    name: 'CMakeLists.txt',
    path: 'main/CMakeLists.txt',
    category: 'config',
    description: 'Сборочный скрипт компонента main для ESP-IDF v5.x.',
    code: `idf_component_register(
    SRCS
        "main.c"
        "staircase.c"
        "sensors.c"
        "led_strip.c"
        "wifi_manager.c"
        "settings.c"
        "time_astro.c"
        "web_common.c"
        "web_page_index.c"
        "web_page_settings.c"
        "web_page_wifi.c"
        "web_api.c"
        "web_ota.c"
        "web_server.c"

    INCLUDE_DIRS
        "."
)

target_compile_options(\${COMPONENT_LIB} PRIVATE -Wno-format-truncation -Wno-format)`
  },
  {
    name: 'build-firmware.yml',
    path: '.github/workflows/build-firmware.yml',
    category: 'config',
    description: 'GitHub Actions CI/CD: автоматическая сборка прошивки в облаке через официальный контейнер espressif/idf:release-v5.3 с публикацией .bin артефактов.',
    code: `name: Сборка прошивки ESP32 (ESP-IDF v5)

on:
  push:
    branches: [ main, master ]
    tags:
      - 'v*.*.*'
      - 'v*'
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:
    inputs:
      target:
        description: 'Целевой чип ESP32'
        required: true
        default: 'esp32'
        type: choice
        options:
          - esp32
          - esp32s3
          - esp32c3

permissions:
  contents: write

jobs:
  build:
    name: Компиляция прошивки ESP_lestn_v2
    runs-on: ubuntu-latest
    container: espressif/idf:release-v5.3

    steps:
      - name: Клонирование репозитория
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Подготовка среды сборки и конфигурации SDK
        working-directory: ESP_lestn_v2
        run: |
          . $IDF_PATH/export.sh
          # Удаляем старый кеш sdkconfig, чтобы гарантированно применился 4MB Flash размер
          rm -f sdkconfig
          echo "CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y" >> sdkconfig.defaults
          echo 'CONFIG_ESPTOOLPY_FLASHSIZE="4MB"' >> sdkconfig.defaults
          echo "CONFIG_PARTITION_TABLE_CUSTOM=y" >> sdkconfig.defaults
          echo 'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"' >> sdkconfig.defaults
          echo "CONFIG_HTTPD_MAX_REQ_HDR_LEN=4096" >> sdkconfig.defaults
          echo "CONFIG_HTTPD_MAX_URI_LEN=1024" >> sdkconfig.defaults
          # Отключаем CONFIG_RMT_ISR_IRAM_SAFE, так как обращение к Flash-памяти в обработчиках без IRAM вызывало Guru Meditation Panic
          echo "# CONFIG_RMT_ISR_IRAM_SAFE is not set" >> sdkconfig.defaults
          idf.py set-target \${{ github.event.inputs.target || 'esp32' }}

      - name: Сборка прошивки
        working-directory: ESP_lestn_v2
        run: |
          . $IDF_PATH/export.sh
          idf.py build

      - name: Создание единого файла прошивки (firmware_merged.bin для 0x0)
        working-directory: ESP_lestn_v2
        run: |
          . $IDF_PATH/export.sh
          esptool.py --chip \${{ github.event.inputs.target || 'esp32' }} merge_bin \
            -o build/firmware_merged.bin \
            --fill-flash-size 4MB \
            @build/flash_args || true

      - name: Публикация артефактов прошивки (Actions Artifacts)
        uses: actions/upload-artifact@v4
        with:
          name: esp32-firmware-binaries
          path: |
            ESP_lestn_v2/build/ESP_lestn_v2.bin
            ESP_lestn_v2/build/bootloader/bootloader.bin
            ESP_lestn_v2/build/partition_table/partition-table.bin
            ESP_lestn_v2/build/firmware_merged.bin
            ESP_lestn_v2/build/flasher_args.json
          retention-days: 30
          if-no-files-found: warn

      - name: Определение номера версии релиза
        id: release_info
        if: (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master' || github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/'))
        run: |
          if [[ "\${{ github.ref }}" == refs/tags/* ]]; then
            TAG_NAME="\${{ github.ref_name }}"
            REL_NAME="ESP-v2 Релиз \${TAG_NAME}"
          else
            # Формируем уникальный версионный тег по номеру запуска Actions
            TAG_NAME="v2.\${{ github.run_number }}.0"
            REL_NAME="ESP-v2 Сборка \${TAG_NAME} (#\${{ github.run_number }})"
          fi
          echo "tag_name=\${TAG_NAME}" >> $GITHUB_OUTPUT
          echo "rel_name=\${REL_NAME}" >> $GITHUB_OUTPUT

      - name: Создание нового нумерованного релиза (v2.X.0)
        if: (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master' || github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/'))
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ steps.release_info.outputs.tag_name }}
          name: \${{ steps.release_info.outputs.rel_name }}
          prerelease: false
          make_latest: true
          files: |
            ESP_lestn_v2/build/ESP_lestn_v2.bin
            ESP_lestn_v2/build/firmware_merged.bin
            ESP_lestn_v2/build/bootloader/bootloader.bin
            ESP_lestn_v2/build/partition_table/partition-table.bin
            ESP_lestn_v2/build/flasher_args.json
          body: |
            ## Релиз прошивки ESP32: \`\${{ steps.release_info.outputs.tag_name }}\`
            Собрано компилятором ESP-IDF v5.3 (Сборка GitHub Actions #\${{ github.run_number }}, коммит \`\${{ github.sha }}\`).

            ### Файлы для скачивания:
            - **\`ESP_lestn_v2.bin\`**: файл приложения для обновления по воздуху (Wi-Fi OTA)
            - **\`firmware_merged.bin\`**: полный объединённый бинарник (с адреса 0x0) для быстрой прошивки через Web Serial или esptool
            - **\`bootloader.bin\`** и **\`partition-table.bin\`**: загрузчик и таблица разделов

            ---
            ### 📌 Способы прошивки и правильные адреса Flash:

            #### ⭐️ Вариант 1 (САМЫЙ ПРОСТОЙ И НАДЕЖНЫЙ): Полный файл \`firmware_merged.bin\`
            Прошивается ВСЁ целиком (загрузчик + разметка памяти + приложение):
            - **Файл**: \`firmware_merged.bin\`
            - **Адрес (Offset)**: строго **\`0x0\`**
            - **Команда esptool**:
              \`\`\`bash
              esptool.py --chip esp32 -p COM3 -b 460800 write_flash 0x0 firmware_merged.bin
              \`\`\`
            - **Через Web Serial прямо в браузере**: выберите файл \`firmware_merged.bin\`, укажите адрес **\`0x0\`** и нажмите «Прошить Flash».

            ---

            #### 🛠 Вариант 2: Прошивка только файла приложения (\`ESP_lestn_v2.bin\`)
            Если у вас уже был зашит загрузчик и разметка Dual-OTA, файл приложения шьется по адресу слота \`ota_0\`:
            - **Файл**: \`ESP_lestn_v2.bin\`
            - **Адрес (Offset)**: строго **\`0x20000\`** (НЕ 0x10000!)
            - **Команда esptool**:
              \`\`\`bash
              esptool.py --chip esp32 -p COM3 -b 460800 write_flash 0x20000 ESP_lestn_v2.bin
              \`\`\`

            ---

            #### 🧩 Вариант 3: Полная раздельная прошивка 3 файлов (при чистой плате)
            | Файл бинарника | Адрес смещения | Описание |
            | :--- | :---: | :--- |
            | \`bootloader.bin\` | **\`0x1000\`** | Загрузчик ESP-IDF 2-го уровня |
            | \`partition-table.bin\` | **\`0x8000\`** | Разметка памяти 4MB (Dual OTA) |
            | \`ESP_lestn_v2.bin\` | **\`0x20000\`** | Приложение умной лестницы (\`ota_0\`) |

            \`\`\`bash
            esptool.py --chip esp32 -p COM3 -b 460800 write_flash 0x1000 bootloader.bin 0x8000 partition-table.bin 0x20000 ESP_lestn_v2.bin
            \`\`\`

            ---

            #### 📶 Вариант 4: Беспроводное обновление по Wi-Fi (Dual-OTA)
            - Откройте веб-интерфейс контроллера: \`http://esp-lestn.local/update\` (или по IP, например \`http://192.168.4.1/update\`)
            - Загрузите только файл **\`ESP_lestn_v2.bin\`**
            - ESP32 запишет его во второй раздел \`ota_1\`, проверит контрольную сумму и перезагрузится без кабеля!

      - name: Также обновляем тег 'latest' для прямой совместимости
        if: (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master' || github.event_name == 'workflow_dispatch')
        uses: softprops/action-gh-release@v2
        with:
          tag_name: latest
          name: "ESP-v2 Свежая автосборка прошивки (Latest)"
          prerelease: false
          make_latest: false
          files: |
            ESP_lestn_v2/build/ESP_lestn_v2.bin
            ESP_lestn_v2/build/firmware_merged.bin
            ESP_lestn_v2/build/bootloader/bootloader.bin
            ESP_lestn_v2/build/partition_table/partition-table.bin
            ESP_lestn_v2/build/flasher_args.json
          body: |
            ## Свежая автоматическая сборка прошивки ESP32
            Собрано компилятором ESP-IDF v5.3 из ветки \`\${{ github.ref_name }}\` (коммит \`\${{ github.sha }}\`).

            ### Файлы для скачивания:
            - **\`ESP_lestn_v2.bin\`**: файл приложения для обновления по воздуху (Wi-Fi OTA)
            - **\`firmware_merged.bin\`**: полный объединённый бинарник (с адреса 0x0) для быстрой прошивки через Web Serial или esptool
            - **\`bootloader.bin\`** и **\`partition-table.bin\`**: загрузчик и таблица разделов

            ---
            ### 📌 Способы прошивки:

            #### Вариант 1 (Быстрый старт): Один файл целиком
            - **Файл**: \`firmware_merged.bin\`
            - **Адрес смещения Flash**: \`0x0\`
            - **Web Serial**: в веб-интерфейсе выберите \`firmware_merged.bin\` -> адрес \`0x0\` -> «Прошить».
            - **CLI (терминал)**:
              \`\`\`bash
              esptool.py --chip esp32 -p COM3 -b 460800 write_flash 0x0 firmware_merged.bin
              \`\`\`

            #### Вариант 2 (Рекомендуется при сбоях): Раздельная прошивка 3 файлов
            Скачайте 3 файла из этого релиза и прошейте по точным адресам памяти:
            | Файл бинарника | Адрес Flash (Смещение) | Описание |
            | :--- | :---: | :--- |
            | \`bootloader.bin\` | **\`0x1000\`** | Загрузчик ESP-IDF 2-го уровня |
            | \`partition-table.bin\` | **\`0x8000\`** | Таблица разметки Dual OTA |
            | \`ESP_lestn_v2.bin\` | **\`0x10000\`** | Приложение умной лестницы |

            - **В браузере (Web Serial flasher)**: добавьте 3 файла в форму и укажите адреса:
              1. \`bootloader.bin\` ➡️ \`0x1000\`
              2. \`partition-table.bin\` ➡️ \`0x8000\`
              3. \`ESP_lestn_v2.bin\` ➡️ \`0x10000\`
            - **Через консоль (esptool.py)**:
              \`\`\`bash
              esptool.py --chip esp32 -p COM3 -b 460800 write_flash 0x1000 bootloader.bin 0x8000 partition-table.bin 0x10000 ESP_lestn_v2.bin
              \`\`\`

            #### Вариант 3: Беспроводное обновление по Wi-Fi (Dual-OTA)
            - Откройте веб-интерфейс контроллера (\`http://192.168.4.1/update\` или вкладку OTA)
            - Загрузите только **\`ESP_lestn_v2.bin\`**
            - ESP32 запишет его в пассивный раздел \`ota_1\`, проверит контрольную сумму и перезагрузится без проводов!

      - name: Ротация релизов (хранить не более 10 релизов, старые затирать)
        if: always()
        run: |
          python3 - << 'PYEOF'
          import os, json, urllib.request, urllib.error

          token = os.environ.get("GITHUB_TOKEN")
          repo = os.environ.get("GITHUB_REPOSITORY")
          if not token or not repo:
              print("No GITHUB_TOKEN or GITHUB_REPOSITORY set; skipping retention pruning.")
              exit(0)

          headers = {
              "Authorization": f"Bearer {token}",
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "Release-Pruner"
          }

          url = f"https://api.github.com/repos/{repo}/releases?per_page=100"
          req = urllib.request.Request(url, headers=headers)
          try:
              with urllib.request.urlopen(req) as response:
                  releases = json.loads(response.read().decode())
          except Exception as e:
              print(f"Failed to fetch releases: {e}")
              exit(0)

          MAX_RELEASES = 10
          if len(releases) <= MAX_RELEASES:
              print(f"Current releases count ({len(releases)}) <= limit ({MAX_RELEASES}). Nothing to delete.")
              exit(0)

          # Sort by published_at or created_at descending (newest first)
          sorted_releases = sorted(
              releases,
              key=lambda r: r.get("published_at") or r.get("created_at") or "",
              reverse=True
          )

          to_delete = sorted_releases[MAX_RELEASES:]
          print(f"Total releases: {len(sorted_releases)}. Exceeds {MAX_RELEASES}. Deleting {len(to_delete)} old releases...")

          for rel in to_delete:
              rel_id = rel.get("id")
              rel_tag = rel.get("tag_name")
              print(f"Deleting old release #{rel_id} (tag: {rel_tag})...")
              del_url = f"https://api.github.com/repos/{repo}/releases/{rel_id}"
              del_req = urllib.request.Request(del_url, headers=headers, method="DELETE")
              try:
                  with urllib.request.urlopen(del_req) as resp:
                      print(f"Successfully deleted release {rel_id}.")
              except Exception as err:
                  print(f"Error deleting release {rel_id}: {err}")
          PYEOF
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
  },
  {
    name: 'find_esp32_network.bat',
    path: 'scripts/find_esp32_network.bat',
    category: 'config',
    description: 'BAT-скрипт для Windows: автоматический поиск ESP32 в локальной сети, проверка mDNS и открытие веб-интерфейса в 1 клик.',
    code: `@echo off
chcp 65001 >nul
title Диагностика и поиск контроллера ESP32 (ESP-Lestn)
color 0B

echo ======================================================================
echo          ДИАГНОСТИКА СЕТИ И ПОИСК ESP32 УМНОЙ ЛЕСТНИЦЫ
echo ======================================================================
echo.

:: 1. Проверка локального имени mDNS
echo [1/4] Попытка обнаружения по локальному имени mDNS (esp-lestn.local)...
ping -n 1 -w 1500 esp-lestn.local >nul 2>&1
if %errorlevel% equ 0 (
    echo [УСПЕХ] Контроллер найден по имени esp-lestn.local!
    for /f "tokens=3" %%a in ('ping -n 1 esp-lestn.local ^| findstr "["') do set ESP_IP=%%a
    echo Адрес устройства: %ESP_IP%
    echo.
    echo Открываю веб-интерфейс в браузере...
    start http://esp-lestn.local
    pause
    exit /b
)
echo [-] По имени esp-lestn.local не отвечает.
echo.

:: 2. Проверка точки доступа ESP-Lestn (192.168.4.1)
echo [2/4] Проверка режима точки доступа по адресу 192.168.4.1...
ping -n 1 -w 1000 192.168.4.1 >nul 2>&1
if %errorlevel% equ 0 (
    echo [УСПЕХ] Вы подключены к точке доступа ESP-Lestn (192.168.4.1)!
    echo.
    echo Открываю страницу настроек Wi-Fi...
    start http://192.168.4.1/wifi
    pause
    exit /b
)
echo [-] Режим точки доступа (192.168.4.1) недоступен.
echo.

:: 3. Определение локальной подсети компьютера
echo [3/4] Сканирование устройств в вашей локальной подсети...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
set LOCAL_IP=%LOCAL_IP: =%
echo Ваш IP-адрес: %LOCAL_IP%

:: Получаем базовые три октета (например, 192.168.170)
for /f "tokens=1,2,3 delims=." %%a in ("%LOCAL_IP%") do set SUBNET=%%a.%%b.%%c
echo Базовая подсеть: %SUBNET%.0/24
echo.

echo Поиск устройств с MAC-адресом Espressif (ESP32) в таблице ARP...
arp -d >nul 2>&1
:: Быстрый пинг шлюза и диапазона
for /L %%i in (1,1,30) do start /b ping -n 1 -w 100 %SUBNET%.%%i >nul 2>&1
for /L %%i in (100,1,150) do start /b ping -n 1 -w 100 %SUBNET%.%%i >nul 2>&1
timeout /t 2 >nul

:: Проверка таблицы ARP на известных производителей ESP32 (MAC: 24:0a:c4, 30:ae:a4, 40:22:d8, 48:e7:29, 84:cc:a8, ac:67:b2, 24:6f:28, d8:bc:38, b0:a7:32, cc:50:e3, etc.)
for /f "tokens=1,2" %%a in ('arp -a ^| findstr /i "%SUBNET%"') do (
    echo Найдено активное устройство: %%a  (MAC: %%b)
    powershell -Command "try { $r = (Invoke-WebRequest -Uri 'http://%%a/api/state' -TimeoutSec 1).StatusCode; if ($r -eq 200) { Write-Host '[НАЙДЕН ESP32 КОНТРОЛЛЕР!] -> http://%%a' -ForegroundColor Green; Start-Process 'http://%%a'; exit 0 } } catch {}" >nul 2>&1
)

echo.
echo ======================================================================
echo [4/4] РЕКОМЕНДАЦИИ, ЕСЛИ УСТРОЙСТВО НЕ НАЙДЕНО:
echo ======================================================================
echo 1. Подключите ESP32 по USB-кабелю к компьютеру.
echo 2. Запустите консоль COM-порта на скорости 115200.
echo 3. Нажмите кнопку EN / RESET на плате.
echo 4. Если плата застряла или слетели настройки Wi-Fi, откройте в браузере
echo    веб-прошивальщик и прошейте свежий файл firmware_merged.bin на адрес 0x0.
echo ======================================================================
echo.
pause
`
  },
  {
    name: 'configure_esp32_serial.bat',
    path: 'scripts/configure_esp32_serial.bat',
    category: 'config',
    description: 'BAT-скрипт для Windows: прямая диагностика сети, сброс NVS/Wi-Fi в точку доступа и вывод логов через COM-порт.',
    code: `@echo off
chcp 65001 >nul
title Прямая настройка Wi-Fi и диагностика ESP32 через COM-порт
color 0E

echo ======================================================================
echo    ПРЯМАЯ НАСТРОЙКА WI-FI И СЕТИ ESP32 ЧЕРЕЗ COM-ПОРТ (USB)
echo ======================================================================
echo.

:: Поиск доступных COM-портов
echo Доступные COM-порты в системе:
powershell -Command "[System.IO.Ports.SerialPort]::getportnames()"
echo.

set /p COMPORT="Введите номер COM-порта (например, COM3 или COM4): "
if "%COMPORT%"=="" (
    echo Номер порта не введен!
    pause
    exit /b
)

echo.
echo ======================================================================
echo Выберите действие:
echo 1 - Прочитать текущий IP и статус сети из ESP32 (Монитор порта)
echo 2 - Сбросить память Wi-Fi / NVS (чтобы включилась точка доступа ESP-Lestn)
echo 3 - Прошить полный образ (firmware_merged.bin на адрес 0x0)
echo ======================================================================
set /p ACTION="Выберите пункт (1, 2 или 3): "

if "%ACTION%"=="1" (
    echo.
    echo Открываю монитор порта %COMPORT% на скорости 115200...
    echo Нажмите кнопку RESET / EN на плате ESP32 для вывода IP-адреса.
    echo (Для выхода нажмите Ctrl+C)
    echo.
    powershell -Command "$port = new-Object System.IO.Ports.SerialPort %COMPORT%,115200,None,8,one; $port.open(); while($true){ Write-Host $port.ReadLine() }"
)

if "%ACTION%"=="2" (
    echo.
    echo Очистка NVS Flash памяти на ESP32...
    python -m esptool --chip esp32 -p %COMPORT% erase_region 0x9000 0x6000
    echo Память NVS очищена! Теперь при старте включится точка доступа ESP-Lestn (192.168.4.1).
    echo Нажмите кнопку RESET на плате.
)

if "%ACTION%"=="3" (
    echo.
    echo Скачивание свежей прошивки latest из GitHub...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/geminibitok-oss/ESP-v2/releases/download/latest/firmware_merged.bin' -OutFile 'firmware_merged.bin'"
    echo Прошивка ESP32...
    python -m esptool --chip esp32 -p %COMPORT% -b 460800 write_flash 0x0 firmware_merged.bin
    echo.
    echo Прошивка успешно завершена! Плата перезагружена.
)

pause
`
  }
];