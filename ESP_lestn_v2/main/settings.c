#include "settings.h"

#include <string.h>

#include "nvs.h"
#include "nvs_flash.h"
#include "esp_log.h"

static const char *TAG = "SETTINGS";

#define NVS_NAMESPACE "staircase"
#define NVS_KEY       "config"

void settings_reset(staircase_settings_t *s)
{
    if (s == NULL) return;

    memset(s, 0, sizeof(*s));

    /* Wi-Fi */
    strcpy(s->hostname, "esp-lestn");
    s->wifi_ssid[0] = '\0';
    s->wifi_password[0] = '\0';

    /* GPIO */
    s->led_gpio = STAIR_DEFAULT_LED_GPIO;
    s->sensor_bottom_gpio = STAIR_DEFAULT_SENSOR_BOTTOM_GPIO;
    s->sensor_top_gpio = STAIR_DEFAULT_SENSOR_TOP_GPIO;

    /* LED & Steps */
    s->steps = STAIR_DEFAULT_STEPS;
    s->pixels_per_step = STAIR_DEFAULT_PIXELS_PER_STEP;

    s->brightness = 100;
    s->night_brightness = 20;

    /* Colors (RGB) - Warm White Default */
    s->color_r = 255;
    s->color_g = 220;
    s->color_b = 150;

    /* Night Color (Soft Amber) */
    s->night_color_r = 255;
    s->night_color_g = 140;
    s->night_color_b = 30;

    /* Effects */
    s->anim_effect = ANIM_EFFECT_CLASSIC;
    s->hold_effect = HOLD_EFFECT_SOLID;
    s->off_effect = OFF_EFFECT_WAVE;

    /* Timing */
    s->step_on_time_ms = 120;
    s->step_off_time_ms = 180;
    s->hold_time_ms = 4000;
    s->fade_duration_ms = 30;

    /* Modes */
    s->night_mode = true;
    s->night_mode_type = 0;       /* 0: edge steps only, 1: all steps */
    s->reverse_direction = false;
    s->sensor_active_high = true;

    /* Sensor debounce */
    s->sensor_debounce_ms = 60;

    /* Internet Time & Astro Schedule */
    s->ntp_enabled = true;
    strcpy(s->ntp_server, "pool.ntp.org");
    s->timezone_offset = 3;         /* UTC+3 (Moscow / MSK) */
    s->latitude = 55.7558f;         /* Moscow Lat */
    s->longitude = 37.6173f;        /* Moscow Lon */

    s->schedule_mode = 0;           /* 0: Astronomical sunset/sunrise */
    s->sunset_offset_min = 0;       /* Exactly at sunset */
    s->sunrise_offset_min = 0;      /* Exactly at sunrise */

    s->fixed_on_hour = 22;
    s->fixed_on_minute = 0;
    s->fixed_off_hour = 7;
    s->fixed_off_minute = 0;
}

static void settings_sanitize(staircase_settings_t *s)
{
    if (s->steps == 0 || s->steps > STAIR_MAX_STEPS) s->steps = STAIR_DEFAULT_STEPS;
    if (s->pixels_per_step == 0 || s->pixels_per_step > 50) s->pixels_per_step = STAIR_DEFAULT_PIXELS_PER_STEP;
    if ((s->steps * s->pixels_per_step) > STAIR_MAX_PIXELS) {
        s->steps = STAIR_DEFAULT_STEPS;
        s->pixels_per_step = STAIR_DEFAULT_PIXELS_PER_STEP;
    }
    if (s->brightness > 100) s->brightness = 100;
    if (s->night_brightness > 100) s->night_brightness = 20;
    if (s->anim_effect > 5) s->anim_effect = ANIM_EFFECT_CLASSIC;
    if (s->hold_effect > 4) s->hold_effect = HOLD_EFFECT_SOLID;
    if (s->off_effect > 2) s->off_effect = OFF_EFFECT_WAVE;
    if (s->step_on_time_ms < 10 || s->step_on_time_ms > 5000) s->step_on_time_ms = 120;
    if (s->step_off_time_ms < 10 || s->step_off_time_ms > 5000) s->step_off_time_ms = 180;
    if (s->hold_time_ms > 60000) s->hold_time_ms = 4000;
    if (s->hostname[0] == '\0') strcpy(s->hostname, "esp-lestn");
    if (s->ntp_server[0] == '\0') strcpy(s->ntp_server, "pool.ntp.org");
    if (s->timezone_offset < -12 || s->timezone_offset > 14) s->timezone_offset = 3;
    if (s->latitude < -90.0f || s->latitude > 90.0f) s->latitude = 55.7558f;
    if (s->longitude < -180.0f || s->longitude > 180.0f) s->longitude = 37.6173f;
    if (s->schedule_mode > 3) s->schedule_mode = 0;
    if (s->sunset_offset_min < -300 || s->sunset_offset_min > 300) s->sunset_offset_min = 0;
    if (s->sunrise_offset_min < -300 || s->sunrise_offset_min > 300) s->sunrise_offset_min = 0;
    if (s->fixed_on_hour > 23) s->fixed_on_hour = 22;
    if (s->fixed_on_minute > 59) s->fixed_on_minute = 0;
    if (s->fixed_off_hour > 23) s->fixed_off_hour = 7;
    if (s->fixed_off_minute > 59) s->fixed_off_minute = 0;
}

void settings_load(staircase_settings_t *s)
{
    settings_reset(s);

    nvs_handle_t nvs;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &nvs);
    if (err != ESP_OK)
    {
        ESP_LOGI(TAG, "No saved settings found in NVS, using defaults");
        return;
    }

    size_t size = sizeof(*s);
    err = nvs_get_blob(nvs, NVS_KEY, s, &size);
    nvs_close(nvs);

    if (err != ESP_OK || size != sizeof(*s))
    {
        ESP_LOGW(TAG, "Invalid/outdated settings size (%d vs %d), resetting to defaults", (int)size, (int)sizeof(*s));
        settings_reset(s);
        return;
    }

    settings_sanitize(s);
    ESP_LOGI(TAG, "Settings loaded successfully from NVS");
}

esp_err_t settings_save(const staircase_settings_t *s)
{
    if (s == NULL) return ESP_ERR_INVALID_ARG;

    nvs_handle_t nvs;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &nvs);
    if (err != ESP_OK)
        return err;

    err = nvs_set_blob(nvs, NVS_KEY, s, sizeof(*s));
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }

    nvs_close(nvs);

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Settings saved to NVS successfully");
    } else {
        ESP_LOGE(TAG, "Failed to save settings: %s", esp_err_to_name(err));
    }

    return err;
}
