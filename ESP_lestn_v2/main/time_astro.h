#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include "esp_err.h"
#include "settings.h"

typedef struct
{
    bool synced;              /* NTP synchronized */
    time_t raw_time;          /* Current epoch time */
    struct tm local_time;     /* Local time broken down */
    char time_str[32];        /* Formatted "YYYY-MM-DD HH:MM:SS" */
    
    /* Calculated Sun times for today */
    bool sun_valid;           /* True if coordinates valid and calculated */
    uint8_t sunrise_hour;
    uint8_t sunrise_min;
    uint8_t sunset_hour;
    uint8_t sunset_min;
    char sunrise_str[16];     /* "HH:MM" */
    char sunset_str[16];      /* "HH:MM" */

    /* Active window status */
    bool is_night_time;       /* True if current time is in night window */
    char next_switch_str[32]; /* e.g. "Закат в 19:42" or "Восход в 06:15" */
} time_astro_status_t;

/* Callback when night/day mode transition occurs */
typedef void (*time_astro_state_cb_t)(bool is_night);

esp_err_t time_astro_init(staircase_settings_t *settings, time_astro_state_cb_t cb);
void time_astro_start_sntp(void);
void time_astro_stop_sntp(void);
void time_astro_apply_settings(const staircase_settings_t *settings);

/* Calculation helper */
void time_astro_calculate_sun(
    float lat, float lon, int8_t tz_hours,
    int year, int month, int day,
    uint8_t *rise_h, uint8_t *rise_m,
    uint8_t *set_h, uint8_t *set_m
);

/* Status getter */
void time_astro_get_status(time_astro_status_t *out_status);
bool time_astro_is_night_now(void);
