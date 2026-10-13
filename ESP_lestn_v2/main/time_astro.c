#include "time_astro.h"

#include <stdio.h>
#include <string.h>
#include <math.h>
#include <sys/time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_sntp.h"
#include "esp_timer.h"

static const char *TAG = "ASTRO_TIME";

#define DEG_TO_RAD (3.14159265358979323846f / 180.0f)
#define RAD_TO_DEG (180.0f / 3.14159265358979323846f)

static staircase_settings_t *cfg = NULL;
static time_astro_state_cb_t state_cb = NULL;
static TaskHandle_t astro_task_handle = NULL;

static bool sntp_running = false;
static bool last_is_night = false;
static bool first_check_done = false;

/* Calculate day of year (1-366) */
static int get_day_of_year(int year, int month, int day)
{
    static const int days_in_month[] = { 0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    int doy = day;
    for (int m = 1; m < month; m++) {
        doy += days_in_month[m];
    }
    /* Leap year adjustment */
    if (month > 2) {
        if ((year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)) {
            doy += 1;
        }
    }
    return doy;
}

/*
 * Accurate Astronomical Solar Calculation (NOAA algorithm)
 * Calculates local sunrise and sunset in hours (0..24)
 */
void time_astro_calculate_sun(
    float lat, float lon, int8_t tz_hours,
    int year, int month, int day,
    uint8_t *rise_h, uint8_t *rise_m,
    uint8_t *set_h, uint8_t *set_m)
{
    int N = get_day_of_year(year, month, day);

    /* Fractional year in radians */
    float gamma = 2.0f * (float)M_PI / 365.0f * (float)(N - 1);

    /* Equation of time in minutes */
    float eqtime = 229.18f * (0.000075f + 0.001868f * cosf(gamma) - 0.032077f * sinf(gamma)
                   - 0.014615f * cosf(2.0f * gamma) - 0.040849f * sinf(2.0f * gamma));

    /* Solar declination in radians */
    float decl = 0.006918f - 0.399912f * cosf(gamma) + 0.070257f * sinf(gamma)
                 - 0.006758f * cosf(2.0f * gamma) + 0.000907f * sinf(2.0f * gamma)
                 - 0.002697f * cosf(3.0f * gamma) + 0.00148f * sinf(3.0f * gamma);

    /* Zenith = 90.833 degrees for official sunrise/sunset (refraction + sun disc) */
    float cos_zenith = cosf(90.833f * DEG_TO_RAD);
    float lat_rad = lat * DEG_TO_RAD;

    /* Hour angle */
    float cos_ha = (cos_zenith - sinf(lat_rad) * sinf(decl)) / (cosf(lat_rad) * cosf(decl));

    if (cos_ha > 1.0f) {
        /* Polar night (sun never rises) */
        *rise_h = 12; *rise_m = 0;
        *set_h = 12; *set_m = 0;
        return;
    }
    if (cos_ha < -1.0f) {
        /* Midnight sun (sun never sets) */
        *rise_h = 0; *rise_m = 0;
        *set_h = 23; *set_m = 59;
        return;
    }

    float ha = acosf(cos_ha) * RAD_TO_DEG;

    /* Solar noon in minutes from local midnight */
    float solar_noon = 720.0f - 4.0f * lon - eqtime + (float)tz_hours * 60.0f;

    /* Sunrise and Sunset in minutes from midnight */
    float sunrise_min_f = solar_noon - ha * 4.0f;
    float sunset_min_f = solar_noon + ha * 4.0f;

    /* Normalize 0..1440 */
    while (sunrise_min_f < 0.0f) sunrise_min_f += 1440.0f;
    while (sunrise_min_f >= 1440.0f) sunrise_min_f -= 1440.0f;
    while (sunset_min_f < 0.0f) sunset_min_f += 1440.0f;
    while (sunset_min_f >= 1440.0f) sunset_min_f -= 1440.0f;

    int rise_total_m = (int)(sunrise_min_f + 0.5f);
    int set_total_m = (int)(sunset_min_f + 0.5f);

    *rise_h = (uint8_t)(rise_total_m / 60);
    *rise_m = (uint8_t)(rise_total_m % 60);
    *set_h = (uint8_t)(set_total_m / 60);
    *set_m = (uint8_t)(set_total_m % 60);
}

static bool time_has_synced = false;

/* SNTP Notification Callback */
static void time_sync_notification_cb(struct timeval *tv)
{
    time_has_synced = true;
    ESP_LOGI(TAG, "NTP Time synchronized successfully!");
}

void time_astro_start_sntp(void)
{
    if (sntp_running) return;

    ESP_LOGI(TAG, "Initializing SNTP client: server='%s' (TZ offset: %+d hrs)",
             cfg && cfg->ntp_server[0] ? cfg->ntp_server : "pool.ntp.org",
             cfg ? cfg->timezone_offset : 3);

    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_set_sync_mode(SNTP_SYNC_MODE_IMMED);
    const char *server0 = (cfg && cfg->ntp_server[0] != '\0') ? cfg->ntp_server : "pool.ntp.org";
    esp_sntp_setservername(0, server0);
    /* Резервные серверы времени для гарантированной синхронизации */
    esp_sntp_setservername(1, "time.google.com");
    esp_sntp_setservername(2, "time.windows.com");
    esp_sntp_set_time_sync_notification_cb(time_sync_notification_cb);
    esp_sntp_init();

    sntp_running = true;
}

void time_astro_stop_sntp(void)
{
    if (!sntp_running) return;
    esp_sntp_stop();
    sntp_running = false;
    ESP_LOGI(TAG, "SNTP client stopped");
}

/* Get current status */
void time_astro_get_status(time_astro_status_t *out)
{
    if (out == NULL) return;
    memset(out, 0, sizeof(*out));

    time_t now = 0;
    time(&now);
    out->raw_time = now;

    /* Check if synchronized (year >= 2024) */
    struct tm timeinfo;
    localtime_r(&now, &timeinfo);

    if (timeinfo.tm_year >= (2024 - 1900)) {
        out->synced = true;
    } else {
        out->synced = false;
    }

    out->local_time = timeinfo;
    snprintf(out->time_str, sizeof(out->time_str), "%04d-%02d-%02d %02d:%02d:%02d",
             timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
             timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);

    if (cfg != NULL) {
        float lat = cfg->latitude;
        float lon = cfg->longitude;
        int8_t tz = cfg->timezone_offset;

        time_astro_calculate_sun(
            lat, lon, tz,
            timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
            &out->sunrise_hour, &out->sunrise_min,
            &out->sunset_hour, &out->sunset_min
        );

        out->sun_valid = true;
        snprintf(out->sunrise_str, sizeof(out->sunrise_str), "%02d:%02d", out->sunrise_hour, out->sunrise_min);
        snprintf(out->sunset_str, sizeof(out->sunset_str), "%02d:%02d", out->sunset_hour, out->sunset_min);
    }

    out->is_night_time = time_astro_is_night_now();

    if (out->is_night_time) {
        snprintf(out->next_switch_str, sizeof(out->next_switch_str), "Дневной режим с %s", out->sunrise_str);
    } else {
        snprintf(out->next_switch_str, sizeof(out->next_switch_str), "Ночной режим с %s", out->sunset_str);
    }
}

/* Check if current time falls into active night window */
bool time_astro_is_night_now(void)
{
    if (cfg == NULL) return true;

    /* If schedule mode is Always On / Off */
    if (cfg->schedule_mode == 2) return true;  /* Always night mode on */
    if (cfg->schedule_mode == 3) return false; /* Always off (day mode) */

    time_t now = 0;
    time(&now);
    struct tm t;
    localtime_r(&now, &t);

    if (t.tm_year < (2024 - 1900)) {
        /* Not yet synced with NTP, fallback to configured default night mode */
        return cfg->night_mode;
    }

    int current_minute = t.tm_hour * 60 + t.tm_min;

    if (cfg->schedule_mode == 1)
    {
        /* Fixed schedule: on_time to off_time */
        int on_min = cfg->fixed_on_hour * 60 + cfg->fixed_on_minute;
        int off_min = cfg->fixed_off_hour * 60 + cfg->fixed_off_minute;

        if (on_min > off_min) {
            /* Spans midnight, e.g. 22:00 to 07:00 */
            return (current_minute >= on_min || current_minute < off_min);
        } else {
            /* Same day window, e.g. 08:00 to 20:00 */
            return (current_minute >= on_min && current_minute < off_min);
        }
    }
    else
    {
        /* Astronomical Sun calculation with offsets */
        uint8_t s_rise_h, s_rise_m, s_set_h, s_set_m;
        time_astro_calculate_sun(
            cfg->latitude, cfg->longitude, cfg->timezone_offset,
            t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
            &s_rise_h, &s_rise_m, &s_set_h, &s_set_m
        );

        int sunset_effective = (int)(s_set_h * 60 + s_set_m) + cfg->sunset_offset_min;
        int sunrise_effective = (int)(s_rise_h * 60 + s_rise_m) + cfg->sunrise_offset_min;

        /* Normalize */
        while (sunset_effective < 0) sunset_effective += 1440;
        while (sunset_effective >= 1440) sunset_effective -= 1440;
        while (sunrise_effective < 0) sunrise_effective += 1440;
        while (sunrise_effective >= 1440) sunrise_effective -= 1440;

        /* Night window is from sunset to sunrise */
        if (sunset_effective > sunrise_effective) {
            /* Typical case: Sunset at evening (e.g. 19:30), Sunrise in morning (e.g. 06:15) */
            return (current_minute >= sunset_effective || current_minute < sunrise_effective);
        } else {
            /* Polar / edge condition */
            return (current_minute >= sunset_effective && current_minute < sunrise_effective);
        }
    }
}

/* Background Astro & Intelligent NTP Resync Task */
static void astro_monitor_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Astro & Schedule monitor task started");
    int64_t last_sync_attempt_sec = 0;

    while (1)
    {
        vTaskDelay(pdMS_TO_TICKS(5000)); /* Проверка каждые 5 секунд */

        if (cfg == NULL) continue;

        time_t now = 0;
        time(&now);
        struct tm ti;
        localtime_r(&now, &ti);
        bool is_synced = (ti.tm_year >= (2024 - 1900));

        int64_t now_sec = esp_timer_get_time() / 1000000;

        if (cfg->ntp_enabled)
        {
            if (!is_synced)
            {
                /* НЕ СИНХРОНИЗИРОВАНО: настойчивый повтор каждые 10 секунд */
                if ((now_sec - last_sync_attempt_sec) >= 10)
                {
                    last_sync_attempt_sec = now_sec;
                    ESP_LOGW(TAG, "NTP not yet synced. Retrying immediate sync...");
                    if (sntp_running) {
                        esp_sntp_stop();
                        sntp_running = false;
                    }
                    time_astro_start_sntp();
                }
            }
            else
            {
                /* СИНХРОНИЗИРОВАНО: плановая синхронизация ровно 1 раз в час (3600 сек) */
                if ((now_sec - last_sync_attempt_sec) >= 3600)
                {
                    last_sync_attempt_sec = now_sec;
                    ESP_LOGI(TAG, "Hourly scheduled NTP time re-synchronization triggered.");
                    if (sntp_running) {
                        esp_sntp_stop();
                        sntp_running = false;
                    }
                    time_astro_start_sntp();
                }
            }
        }

        bool is_night = time_astro_is_night_now();

        if (!first_check_done || is_night != last_is_night)
        {
            first_check_done = true;
            last_is_night = is_night;

            ESP_LOGI(TAG, "Schedule transition event: Night Mode is now %s (mode=%u)",
                     is_night ? "ACTIVE (Ночная дежурная подсветка)" : "INACTIVE (Дневной режим / выключено)",
                     cfg->schedule_mode);

            if (state_cb != NULL) {
                state_cb(is_night);
            }
        }
    }
}

esp_err_t time_astro_init(staircase_settings_t *settings, time_astro_state_cb_t cb)
{
    cfg = settings;
    state_cb = cb;

    /* Set TZ environment variable based on offset */
    char tz_str[32];
    /* POSIX TZ sign is inverted: UTC+3 is GMT-3 */
    int inv_offset = -cfg->timezone_offset;
    snprintf(tz_str, sizeof(tz_str), "GMT%+d", inv_offset);
    setenv("TZ", tz_str, 1);
    tzset();

    if (cfg->ntp_enabled) {
        time_astro_start_sntp();
    }

    if (astro_task_handle == NULL) {
        xTaskCreate(
            astro_monitor_task,
            "astro_task",
            3072,
            NULL,
            3,
            &astro_task_handle
        );
    }

    return ESP_OK;
}

void time_astro_apply_settings(const staircase_settings_t *settings)
{
    if (settings != NULL) {
        cfg = (staircase_settings_t *)settings;

        char tz_str[32];
        int inv_offset = -cfg->timezone_offset;
        snprintf(tz_str, sizeof(tz_str), "GMT%+d", inv_offset);
        setenv("TZ", tz_str, 1);
        tzset();

        if (cfg->ntp_enabled && !sntp_running) {
            time_astro_start_sntp();
        } else if (!cfg->ntp_enabled && sntp_running) {
            time_astro_stop_sntp();
        }

        /* Force re-evaluation */
        first_check_done = false;
    }
}
