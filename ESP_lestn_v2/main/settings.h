#pragma once

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"

#define STAIR_DEFAULT_LED_GPIO             4
#define STAIR_DEFAULT_SENSOR_BOTTOM_GPIO  23
#define STAIR_DEFAULT_SENSOR_TOP_GPIO     22

#define STAIR_DEFAULT_STEPS               18
#define STAIR_DEFAULT_PIXELS_PER_STEP      1

#define STAIR_MAX_PIXELS                  500
#define STAIR_MAX_STEPS                    50

/* Animation Effects (Включение) */
typedef enum {
    ANIM_EFFECT_CLASSIC = 0,   /* 0: Классическая волна */
    ANIM_EFFECT_FADE = 1,      /* 1: Плавное нарастание (Fade Wave) */
    ANIM_EFFECT_CURTAIN = 2,   /* 2: Штора / От центра к краям */
    ANIM_EFFECT_METEOR = 3,    /* 3: Метеор / Бегущая комета */
    ANIM_EFFECT_RAINBOW = 4,   /* 4: Радужная волна */
    ANIM_EFFECT_FIRE = 5       /* 5: Огонь / Камин */
} anim_effect_t;

/* Hold Phase Effects (Удержание) */
typedef enum {
    HOLD_EFFECT_SOLID = 0,     /* 0: Статичный ровный свет */
    HOLD_EFFECT_BREATHE = 1,   /* 1: Дыхание / Пульсация яркости */
    HOLD_EFFECT_SHIMMER = 2,   /* 2: Шиммер / Мерцание звезд */
    HOLD_EFFECT_RAINBOW = 3,   /* 3: Радужный перелив */
    HOLD_EFFECT_CANDLE = 4     /* 4: Мерцание свечи */
} hold_effect_t;

/* Turn-Off Effects (Выключение) */
typedef enum {
    OFF_EFFECT_WAVE = 0,       /* 0: Волна вслед за движением */
    OFF_EFFECT_ALL_FADE = 1,   /* 1: Одновременное плавное затухание */
    OFF_EFFECT_STEP_FADE = 2   /* 2: Пошаговый плавный фейд */
} off_effect_t;

typedef struct
{
    /* Wi-Fi */
    char wifi_ssid[33];
    char wifi_password[65];
    char hostname[32];

    /* GPIO */
    uint8_t led_gpio;
    uint8_t sensor_bottom_gpio;
    uint8_t sensor_top_gpio;

    /* LED & Steps */
    uint16_t steps;
    uint16_t pixels_per_step;

    uint8_t brightness;        /* 0 - 100% */
    uint8_t night_brightness;  /* 0 - 100% */

    /* Color (RGB: 0-255) */
    uint8_t color_r;
    uint8_t color_g;
    uint8_t color_b;

    /* Night Color (RGB: 0-255) */
    uint8_t night_color_r;
    uint8_t night_color_g;
    uint8_t night_color_b;

    /* Effects */
    uint8_t anim_effect;       /* 0..5 (anim_effect_t) */
    uint8_t hold_effect;       /* 0..4 (hold_effect_t) */
    uint8_t off_effect;        /* 0..2 (off_effect_t) */

    /* Staircase timing */
    uint16_t step_on_time_ms;   /* Delay between turning on each step */
    uint16_t step_off_time_ms;  /* Delay between turning off each step */
    uint16_t hold_time_ms;      /* How long to stay fully lit */
    uint16_t fade_duration_ms;  /* Smooth fade transition per step (0 = instant) */

    /* Modes */
    bool night_mode;            /* Enable ambient night backlight */
    uint8_t night_mode_type;    /* 0 = first & last steps only, 1 = all steps dimmed */
    bool reverse_direction;     /* Turn off in opposite direction */
    bool sensor_active_high;    /* Sensor active level (true = HIGH/3.3V, false = LOW/GND) */

    /* First & Last Steps Illumination Control */
    bool enable_first_step;     /* true = first step active, false = disabled entirely */
    bool enable_last_step;      /* true = last step active, false = disabled entirely */
    bool night_first_step;      /* true = first step lit in night mode, false = off at night */
    bool night_last_step;       /* true = last step lit in night mode, false = off at night */

    /* Sensor filter & Ultrasonic HC-SR04 */
    uint16_t sensor_debounce_ms; /* Debounce time in ms */
    uint8_t sensor_type;         /* 0 = PIR/Optical, 1 = HC-SR04 Ultrasonic */
    uint8_t sensor_bottom_echo_gpio;
    uint8_t sensor_top_echo_gpio;
    uint16_t ultrasonic_trigger_distance_cm; /* Distance threshold in cm (e.g. 80) */
    uint16_t ultrasonic_max_distance_cm;     /* Max range in cm (e.g. 200) */

    /* Internet Time & Astronomical Sun Schedule */
    bool ntp_enabled;           /* Enable NTP Internet time sync */
    char ntp_server[64];        /* NTP Server, e.g. pool.ntp.org */
    int8_t timezone_offset;     /* UTC Timezone offset in hours (-12..+14) */
    float latitude;             /* Latitude in degrees (e.g. 55.7558 for Moscow) */
    float longitude;            /* Longitude in degrees (e.g. 37.6173 for Moscow) */

    /* Schedule / Automation Mode */
    uint8_t schedule_mode;      /* 0: Астро (Закат/Восход), 1: По времени, 2: Всегда Вкл, 3: Выкл */
    int16_t sunset_offset_min;  /* Смещение времени включения от заката (мин, +/-) */
    int16_t sunrise_offset_min; /* Смещение времени выключения от восхода (мин, +/-) */

    /* Fixed Schedule Times */
    uint8_t fixed_on_hour;      /* Час включения (0-23) */
    uint8_t fixed_on_minute;    /* Минута включения (0-59) */
    uint8_t fixed_off_hour;     /* Час выключения (0-23) */
    uint8_t fixed_off_minute;   /* Минута выключения (0-59) */

} staircase_settings_t;

void settings_reset(staircase_settings_t *settings);
void settings_load(staircase_settings_t *settings);
esp_err_t settings_save(const staircase_settings_t *settings);

