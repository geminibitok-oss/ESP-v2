#pragma once

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"
#include "settings.h"

esp_err_t staircase_led_init(
    const staircase_settings_t *settings
);

void staircase_led_clear(void);

void staircase_led_set_pixel_scaled(uint16_t step, uint16_t pixel_in_step, uint8_t red, uint8_t green, uint8_t blue, uint8_t brightness_pct);
void staircase_led_set_pixel(
    uint16_t index,
    uint8_t red,
    uint8_t green,
    uint8_t blue
);

void staircase_led_show(void);

void staircase_led_set_step(
    uint16_t step,
    uint8_t red,
    uint8_t green,
    uint8_t blue
);

void staircase_led_set_step_scaled(
    uint16_t step,
    uint8_t red,
    uint8_t green,
    uint8_t blue,
    uint8_t brightness_pct
);

void staircase_led_clear_step(
    uint16_t step
);

void staircase_led_toggle_step(
    uint16_t step
);

bool staircase_led_step_is_on(
    uint16_t step
);

void staircase_led_all_on(
    uint8_t red,
    uint8_t green,
    uint8_t blue,
    uint8_t brightness_pct
);

void staircase_led_all_off(void);

void staircase_led_apply_night_mode(
    const staircase_settings_t *settings
);

/* Effects & Color Utilities */
void staircase_led_hsv2rgb(
    uint16_t h, uint8_t s, uint8_t v,
    uint8_t *r, uint8_t *g, uint8_t *b
);

void staircase_led_render_rainbow_frame(
    uint16_t hue_offset,
    uint8_t brightness_pct
);

void staircase_led_render_fire_frame(
    uint8_t brightness_pct,
    uint32_t tick
);

void staircase_led_render_shimmer_frame(
    uint8_t base_r, uint8_t base_g, uint8_t base_b,
    uint8_t brightness_pct,
    uint32_t tick
);

void staircase_led_render_meteor_step(
    uint16_t lit_steps,
    int16_t runner_step,
    uint8_t r, uint8_t g, uint8_t b,
    uint8_t brightness_pct
);
