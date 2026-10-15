#include "staircase_led.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "led_strip.h"
#include "led_strip_rmt.h"
#include "esp_log.h"

static const char *TAG = "LED";

static led_strip_handle_t strip = NULL;
static SemaphoreHandle_t led_mutex = NULL;

static uint16_t total_pixels = 0;
static uint16_t step_count = 0;
static uint16_t pixels_per_step = 0;

static bool step_state[STAIR_MAX_STEPS] = {false};
static uint8_t led_gpio = 4;
static bool enable_first_step = true;
static bool enable_last_step = true;
static bool strip_zigzag = false;

static uint8_t scale_color(uint8_t color, uint8_t brightness_pct)
{
    if (brightness_pct > 100) brightness_pct = 100;
    return (uint8_t)(((uint32_t)color * brightness_pct) / 100);
}

/* Рассчитывает физический индекс светодиода с учетом зигзагообразной топологии ленты */
static inline uint16_t get_physical_pixel_index(uint16_t step, uint16_t p)
{
    if (!strip_zigzag || (step % 2 == 0)) {
        /* Прямой порядок слева-направо */
        return step * pixels_per_step + p;
    } else {
        /* Четная/нечетная ступень развернута в обратную сторону при прокладке змейкой */
        return step * pixels_per_step + (pixels_per_step - 1 - p);
    }
}

esp_err_t staircase_led_init(const staircase_settings_t *settings)
{
    if (settings == NULL)
        return ESP_ERR_INVALID_ARG;

    if (led_mutex == NULL) {
        led_mutex = xSemaphoreCreateMutex();
    }

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    led_gpio = settings->led_gpio;
    step_count = settings->steps;
    pixels_per_step = settings->pixels_per_step;
    total_pixels = step_count * pixels_per_step;
    enable_first_step = settings->enable_first_step;
    enable_last_step = settings->enable_last_step;
    strip_zigzag = settings->strip_zigzag;

    memset(step_state, 0, sizeof(step_state));

    if (total_pixels == 0 || total_pixels > STAIR_MAX_PIXELS)
    {
        ESP_LOGE(TAG, "Invalid total pixels: %u (max %u)", total_pixels, STAIR_MAX_PIXELS);
        xSemaphoreGive(led_mutex);
        return ESP_ERR_INVALID_SIZE;
    }

    if (strip != NULL)
    {
        led_strip_clear(strip);
        led_strip_refresh(strip);
        led_strip_del(strip);
        strip = NULL;
    }

    led_strip_config_t strip_config = {
        .strip_gpio_num = led_gpio,
        .max_leds = STAIR_MAX_PIXELS,
        .led_pixel_format = LED_PIXEL_FORMAT_GRB,
        .led_model = LED_MODEL_WS2812,
        .flags.invert_out = false,
    };

    led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10 * 1000 * 1000,
        .mem_block_symbols = 64,
        .flags.with_dma = false,
    };

    esp_err_t err = led_strip_new_rmt_device(&strip_config, &rmt_config, &strip);
    if (err != ESP_OK)
    {
        ESP_LOGE(TAG, "LED strip init failed: %s", esp_err_to_name(err));
        strip = NULL;
        xSemaphoreGive(led_mutex);
        return err;
    }

    led_strip_clear(strip);
    led_strip_refresh(strip);

    xSemaphoreGive(led_mutex);

    ESP_LOGI(TAG, "WS2812 strip initialized on GPIO=%u, steps=%u, pixels/step=%u, total=%u",
             led_gpio, step_count, pixels_per_step, total_pixels);

    return ESP_OK;
}

void staircase_led_clear(void)
{
    if (strip == NULL || led_mutex == NULL) return;

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        led_strip_clear(strip);
        led_strip_refresh(strip);

        for (uint16_t i = 0; i < step_count && i < STAIR_MAX_STEPS; i++) {
            step_state[i] = false;
        }

        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_set_pixel(
    uint16_t index,
    uint8_t red,
    uint8_t green,
    uint8_t blue)
{
    if (strip == NULL || index >= total_pixels)
        return;

    led_strip_set_pixel(strip, index, red, green, blue);
}

void staircase_led_show(void)
{
    if (strip == NULL) return;
    led_strip_refresh(strip);
}

void staircase_led_set_pixel_scaled(
    uint16_t step,
    uint16_t pixel_in_step,
    uint8_t red,
    uint8_t green,
    uint8_t blue,
    uint8_t brightness_pct)
{
    if (strip == NULL || led_mutex == NULL || step >= step_count || pixel_in_step >= pixels_per_step)
        return;

    /* Respect first/last step enablement */
    if (step == 0 && !enable_first_step) return;
    if (step_count > 0 && step == (step_count - 1) && !enable_last_step) return;

    uint8_t r = scale_color(red, brightness_pct);
    uint8_t g = scale_color(green, brightness_pct);
    uint8_t b = scale_color(blue, brightness_pct);

    uint16_t phys_idx = get_physical_pixel_index(step, pixel_in_step);

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        staircase_led_set_pixel(phys_idx, r, g, b);
        step_state[step] = true;
        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_set_step_scaled(
    uint16_t step,
    uint8_t red,
    uint8_t green,
    uint8_t blue,
    uint8_t brightness_pct)
{
    if (strip == NULL || led_mutex == NULL || step >= step_count || step >= STAIR_MAX_STEPS)
        return;

    /* If step is disabled, force off */
    if (step == 0 && !enable_first_step) {
        red = 0; green = 0; blue = 0; brightness_pct = 0;
    } else if (step_count > 0 && step == (step_count - 1) && !enable_last_step) {
        red = 0; green = 0; blue = 0; brightness_pct = 0;
    }

    uint8_t r = scale_color(red, brightness_pct);
    uint8_t g = scale_color(green, brightness_pct);
    uint8_t b = scale_color(blue, brightness_pct);

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        for (uint16_t i = 0; i < pixels_per_step; i++) {
            uint16_t phys_p = get_physical_pixel_index(step, i);
            staircase_led_set_pixel(phys_p, r, g, b);
        }

        step_state[step] = (r != 0 || g != 0 || b != 0);
        staircase_led_show();

        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_set_step(
    uint16_t step,
    uint8_t red,
    uint8_t green,
    uint8_t blue)
{
    staircase_led_set_step_scaled(step, red, green, blue, 100);
}

void staircase_led_clear_step(uint16_t step)
{
    staircase_led_set_step_scaled(step, 0, 0, 0, 0);
}

void staircase_led_toggle_step(uint16_t step)
{
    if (step >= step_count || step >= STAIR_MAX_STEPS)
        return;

    if (step_state[step]) {
        staircase_led_clear_step(step);
    } else {
        staircase_led_set_step_scaled(step, 255, 220, 150, 100);
    }
}

bool staircase_led_step_is_on(uint16_t step)
{
    if (step >= step_count || step >= STAIR_MAX_STEPS)
        return false;

    return step_state[step];
}

void staircase_led_all_on(
    uint8_t red,
    uint8_t green,
    uint8_t blue,
    uint8_t brightness_pct)
{
    if (strip == NULL || led_mutex == NULL) return;

    uint8_t r = scale_color(red, brightness_pct);
    uint8_t g = scale_color(green, brightness_pct);
    uint8_t b = scale_color(blue, brightness_pct);

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++) {
            bool allow = true;
            if (s == 0 && !enable_first_step) allow = false;
            if (step_count > 0 && s == (step_count - 1) && !enable_last_step) allow = false;

            for (uint16_t i = 0; i < pixels_per_step; i++) {
                uint16_t phys_idx = get_physical_pixel_index(s, i);
                staircase_led_set_pixel(phys_idx, allow ? r : 0, allow ? g : 0, allow ? b : 0);
            }
            step_state[s] = allow && (r != 0 || g != 0 || b != 0);
        }

        staircase_led_show();
        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_all_off(void)
{
    staircase_led_clear();
}

void staircase_led_apply_night_mode(const staircase_settings_t *settings)
{
    if (settings == NULL || !settings->night_mode) {
        staircase_led_clear();
        return;
    }

    if (strip == NULL || led_mutex == NULL) return;

    uint8_t r = scale_color(settings->night_color_r, settings->night_brightness);
    uint8_t g = scale_color(settings->night_color_g, settings->night_brightness);
    uint8_t b = scale_color(settings->night_color_b, settings->night_brightness);

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        led_strip_clear(strip);
        for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++) {
            step_state[s] = false;
        }

        if (settings->night_mode_type == 0) {
            /* First and last steps only, respecting night toggles and general step enablement */
            if (step_count > 0 && settings->night_first_step && settings->enable_first_step) {
                uint16_t first_pixel_0 = 0;
                for (uint16_t i = 0; i < pixels_per_step; i++) {
                    staircase_led_set_pixel(first_pixel_0 + i, r, g, b);
                }
                step_state[0] = true;
            }

            if (step_count > 1 && settings->night_last_step && settings->enable_last_step) {
                uint16_t last_step = step_count - 1;
                uint16_t first_pixel_last = last_step * pixels_per_step;
                for (uint16_t i = 0; i < pixels_per_step; i++) {
                    staircase_led_set_pixel(first_pixel_last + i, r, g, b);
                }
                step_state[last_step] = true;
            }
        } else {
            /* All steps at night brightness, respecting disabled steps */
            for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++) {
                bool allow = true;
                if (s == 0 && (!settings->enable_first_step || !settings->night_first_step)) allow = false;
                if (step_count > 0 && s == (step_count - 1) && (!settings->enable_last_step || !settings->night_last_step)) allow = false;

                if (allow) {
                    for (uint16_t i = 0; i < pixels_per_step; i++) {
                        uint16_t phys_idx = get_physical_pixel_index(s, i);
                        staircase_led_set_pixel(phys_idx, r, g, b);
                    }
                    step_state[s] = true;
                }
            }
        }

        staircase_led_show();
        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_hsv2rgb(uint16_t h, uint8_t s, uint8_t v, uint8_t *r, uint8_t *g, uint8_t *b)
{
    if (s == 0) {
        *r = v; *g = v; *b = v;
        return;
    }

    uint8_t region = (h % 360) / 60;
    uint16_t remainder = ((h % 360) - (region * 60)) * 6;

    uint16_t p = ((uint32_t)v * (255 - s)) >> 8;
    uint16_t q = ((uint32_t)v * (255 - (((uint32_t)s * remainder) >> 8))) >> 8;
    uint16_t t = ((uint32_t)v * (255 - (((uint32_t)s * (255 - remainder)) >> 8))) >> 8;

    switch (region) {
        case 0:  *r = v; *g = t; *b = p; break;
        case 1:  *r = q; *g = v; *b = p; break;
        case 2:  *r = p; *g = v; *b = t; break;
        case 3:  *r = p; *g = q; *b = v; break;
        case 4:  *r = t; *g = p; *b = v; break;
        default: *r = v; *g = p; *b = q; break;
    }
}

void staircase_led_render_rainbow_frame(uint16_t hue_offset, uint8_t brightness_pct)
{
    if (strip == NULL || led_mutex == NULL || step_count == 0) return;

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++)
        {
            uint16_t step_hue = (hue_offset + (s * 360 / step_count)) % 360;
            uint8_t r, g, b;
            staircase_led_hsv2rgb(step_hue, 240, 255, &r, &g, &b);

            uint8_t scaled_r = scale_color(r, brightness_pct);
            uint8_t scaled_g = scale_color(g, brightness_pct);
            uint8_t scaled_b = scale_color(b, brightness_pct);

            uint16_t first = s * pixels_per_step;
            for (uint16_t i = 0; i < pixels_per_step; i++) {
                staircase_led_set_pixel(first + i, scaled_r, scaled_g, scaled_b);
            }
            step_state[s] = (scaled_r != 0 || scaled_g != 0 || scaled_b != 0);
        }

        staircase_led_show();
        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_render_fire_frame(uint8_t brightness_pct, uint32_t tick)
{
    if (strip == NULL || led_mutex == NULL || step_count == 0) return;

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++)
        {
            /* Pseudo-random heat wave based on tick and step */
            uint32_t hash = (tick * 13 + s * 37) ^ (s * 19);
            uint8_t flicker = 180 + (hash % 75);

            uint8_t r = flicker;
            uint8_t g = (flicker * (60 + (hash % 70))) / 255;
            uint8_t b = (hash % 15);

            uint8_t scaled_r = scale_color(r, brightness_pct);
            uint8_t scaled_g = scale_color(g, brightness_pct);
            uint8_t scaled_b = scale_color(b, brightness_pct);

            uint16_t first = s * pixels_per_step;
            for (uint16_t i = 0; i < pixels_per_step; i++) {
                staircase_led_set_pixel(first + i, scaled_r, scaled_g, scaled_b);
            }
            step_state[s] = true;
        }

        staircase_led_show();
        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_render_shimmer_frame(
    uint8_t base_r, uint8_t base_g, uint8_t base_b,
    uint8_t brightness_pct,
    uint32_t tick)
{
    if (strip == NULL || led_mutex == NULL || step_count == 0) return;

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++)
        {
            uint32_t hash = (tick * 17 + s * 43) ^ (s * 31);
            int8_t delta = (int8_t)((hash % 31) - 15);
            int16_t cur_bright = (int16_t)brightness_pct + delta;
            if (cur_bright < 10) cur_bright = 10;
            if (cur_bright > 100) cur_bright = 100;

            uint8_t r = scale_color(base_r, (uint8_t)cur_bright);
            uint8_t g = scale_color(base_g, (uint8_t)cur_bright);
            uint8_t b = scale_color(base_b, (uint8_t)cur_bright);

            for (uint16_t i = 0; i < pixels_per_step; i++) {
                uint16_t phys_idx = get_physical_pixel_index(s, i);
                staircase_led_set_pixel(phys_idx, r, g, b);
            }
            step_state[s] = true;
        }

        staircase_led_show();
        xSemaphoreGive(led_mutex);
    }
}

void staircase_led_render_meteor_step(
    uint16_t lit_steps,
    int16_t runner_step,
    uint8_t r, uint8_t g, uint8_t b,
    uint8_t brightness_pct)
{
    if (strip == NULL || led_mutex == NULL || step_count == 0) return;

    if (xSemaphoreTake(led_mutex, pdMS_TO_TICKS(500)) == pdTRUE)
    {
        for (uint16_t s = 0; s < step_count && s < STAIR_MAX_STEPS; s++)
        {
            uint8_t step_r = 0, step_g = 0, step_b = 0;

            if (s < lit_steps) {
                step_r = scale_color(r, brightness_pct);
                step_g = scale_color(g, brightness_pct);
                step_b = scale_color(b, brightness_pct);
            }

            if (s == runner_step) {
                step_r = 255;
                step_g = 255;
                step_b = 255;
            } else if (s == runner_step - 1 || s == runner_step + 1) {
                step_r = scale_color(255, (brightness_pct * 80) / 100);
                step_g = scale_color(g, (brightness_pct * 80) / 100);
                step_b = scale_color(b, (brightness_pct * 80) / 100);
            }

            for (uint16_t i = 0; i < pixels_per_step; i++) {
                uint16_t phys_idx = get_physical_pixel_index(s, i);
                staircase_led_set_pixel(phys_idx, step_r, step_g, step_b);
            }
            step_state[s] = (step_r != 0 || step_g != 0 || step_b != 0);
        }

        staircase_led_show();
        xSemaphoreGive(led_mutex);
    }
}
