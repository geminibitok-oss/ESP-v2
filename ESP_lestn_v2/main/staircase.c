#include "staircase.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "esp_log.h"
#include "esp_timer.h"
#include "staircase_led.h"

static const char *TAG = "STAIRCASE";

typedef enum
{
    CMD_TRIGGER_BOTTOM = 1,
    CMD_TRIGGER_TOP,
    CMD_MANUAL_ON,
    CMD_MANUAL_OFF,
    CMD_TOGGLE_MANUAL,
    CMD_SETTINGS_UPDATED,
    CMD_ASTRO_EVENT
} stair_cmd_type_t;

typedef struct
{
    stair_cmd_type_t type;
    bool is_night;
} stair_cmd_t;

static staircase_settings_t *cfg = NULL;
static staircase_state_t current_state = STAIR_STATE_IDLE;
static QueueHandle_t cmd_queue = NULL;
static TaskHandle_t stair_task_handle = NULL;

static int64_t hold_start_time_us = 0;
static uint32_t hold_duration_ms = 4000;
static bool entered_from_bottom = true;

const char* staircase_get_state_str(void)
{
    switch (current_state)
    {
        case STAIR_STATE_IDLE:             return "ОЖИДАНИЕ";
        case STAIR_STATE_TURNING_ON_UP:    return "ВКЛЮЧЕНИЕ (СНИЗУ ВВЕРХ)";
        case STAIR_STATE_TURNING_ON_DOWN:  return "ВКЛЮЧЕНИЕ (СВЕРХУ ВНИЗ)";
        case STAIR_STATE_TURNING_ON_BOTH:  return "ВКЛЮЧЕНИЕ (С ОБОИХ КОНЦОВ)";
        case STAIR_STATE_HOLDING:          return "ПОДСВЕТКА АКТИВНА";
        case STAIR_STATE_TURNING_OFF_UP:   return "ВЫКЛЮЧЕНИЕ (СНИЗУ ВВЕРХ)";
        case STAIR_STATE_TURNING_OFF_DOWN: return "ВЫКЛЮЧЕНИЕ (СВЕРХУ ВНИЗ)";
        case STAIR_STATE_MANUAL_ON:        return "РУЧНОЙ РЕЖИМ (ВКЛ)";
        default:                           return "НЕИЗВЕСТНО";
    }
}

staircase_state_t staircase_get_state(void)
{
    return current_state;
}

uint32_t staircase_get_hold_remaining_ms(void)
{
    if (current_state != STAIR_STATE_HOLDING) return 0;
    int64_t elapsed_ms = (esp_timer_get_time() - hold_start_time_us) / 1000;
    if (elapsed_ms >= hold_duration_ms) return 0;
    return (uint32_t)(hold_duration_ms - elapsed_ms);
}

static void send_cmd(stair_cmd_type_t type)
{
    if (cmd_queue != NULL) {
        stair_cmd_t cmd = { .type = type };
        xQueueSend(cmd_queue, &cmd, 0);
    }
}

void staircase_trigger_bottom(void)
{
    ESP_LOGI(TAG, "Trigger Bottom requested");
    send_cmd(CMD_TRIGGER_BOTTOM);
}

void staircase_trigger_top(void)
{
    ESP_LOGI(TAG, "Trigger Top requested");
    send_cmd(CMD_TRIGGER_TOP);
}

void staircase_set_manual_on(void)
{
    send_cmd(CMD_MANUAL_ON);
}

void staircase_set_manual_off(void)
{
    send_cmd(CMD_MANUAL_OFF);
}

void staircase_toggle_manual(void)
{
    send_cmd(CMD_TOGGLE_MANUAL);
}

void staircase_on_sensor_event(sensor_event_type_t event)
{
    if (event == SENSOR_EVENT_BOTTOM_TRIGGERED) {
        staircase_trigger_bottom();
    } else if (event == SENSOR_EVENT_TOP_TRIGGERED) {
        staircase_trigger_top();
    }
}

void staircase_apply_settings(const staircase_settings_t *new_settings)
{
    if (new_settings != NULL && cfg != NULL) {
        *cfg = *new_settings;
        staircase_led_init(cfg);
        send_cmd(CMD_SETTINGS_UPDATED);
    }
}

void staircase_on_astro_event(bool is_night)
{
    if (cfg != NULL) {
        cfg->night_mode = is_night;
    }
    if (cmd_queue != NULL) {
        stair_cmd_t cmd = {
            .type = CMD_ASTRO_EVENT,
            .is_night = is_night
        };
        xQueueSend(cmd_queue, &cmd, 0);
    }
}

/* Staircase Animation Task */
static void staircase_fsm_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Staircase FSM task running");

    /* Initial state: night mode or clear */
    if (cfg->night_mode) {
        staircase_led_apply_night_mode(cfg);
    } else {
        staircase_led_clear();
    }

    current_state = STAIR_STATE_IDLE;

    while (1)
    {
        stair_cmd_t cmd;

        /* IDLE State */
        if (current_state == STAIR_STATE_IDLE)
        {
            if (xQueueReceive(cmd_queue, &cmd, portMAX_DELAY) == pdTRUE)
            {
                if (cmd.type == CMD_TRIGGER_BOTTOM)
                {
                    current_state = STAIR_STATE_TURNING_ON_UP;
                    entered_from_bottom = true;
                }
                else if (cmd.type == CMD_TRIGGER_TOP)
                {
                    current_state = STAIR_STATE_TURNING_ON_DOWN;
                    entered_from_bottom = false;
                }
                else if (cmd.type == CMD_MANUAL_ON || cmd.type == CMD_TOGGLE_MANUAL)
                {
                    staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    current_state = STAIR_STATE_MANUAL_ON;
                }
                else if (cmd.type == CMD_SETTINGS_UPDATED || cmd.type == CMD_ASTRO_EVENT)
                {
                    if (cfg->night_mode) staircase_led_apply_night_mode(cfg);
                    else staircase_led_clear();
                }
            }
        }

        /* MANUAL ON State */
        else if (current_state == STAIR_STATE_MANUAL_ON)
        {
            if (xQueueReceive(cmd_queue, &cmd, portMAX_DELAY) == pdTRUE)
            {
                if (cmd.type == CMD_MANUAL_OFF || cmd.type == CMD_TOGGLE_MANUAL)
                {
                    if (cfg->night_mode) staircase_led_apply_night_mode(cfg);
                    else staircase_led_clear();
                    current_state = STAIR_STATE_IDLE;
                }
            }
        }

        /* TURNING ON UP (Bottom to Top) */
        else if (current_state == STAIR_STATE_TURNING_ON_UP)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t delay_ms = cfg->step_on_time_ms;
            uint8_t effect = cfg->anim_effect;

            if (effect == ANIM_EFFECT_CURTAIN)
            {
                /* Curtain from center outwards */
                int16_t mid = total_steps / 2;
                uint16_t half_steps = (total_steps + 1) / 2;
                uint16_t c_delay = delay_ms > 40 ? delay_ms : 40;

                for (uint16_t i = 0; i < half_steps; i++)
                {
                    int16_t s1 = mid - i;
                    int16_t s2 = mid + i;
                    if (s1 >= 0 && s1 < total_steps) {
                        staircase_led_set_step_scaled((uint16_t)s1, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    }
                    if (s2 >= 0 && s2 < total_steps) {
                        staircase_led_set_step_scaled((uint16_t)s2, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    }

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(c_delay)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_METEOR)
            {
                /* Meteor Runner Animation */
                uint16_t sub_delay = delay_ms / 2;
                if (sub_delay < 15) sub_delay = 15;

                for (uint16_t step = 0; step < total_steps; step++)
                {
                    staircase_led_render_meteor_step(step, (int16_t)step, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_delay)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }

                    staircase_led_set_step_scaled(step, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_delay)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_RAINBOW)
            {
                /* Rainbow sequential wave */
                for (uint16_t step = 0; step < total_steps; step++)
                {
                    uint16_t hue = (step * 360 / (total_steps > 0 ? total_steps : 1)) % 360;
                    uint8_t r, g, b;
                    staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                    staircase_led_set_step_scaled(step, r, g, b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_FIRE)
            {
                /* Fire flame ignition */
                for (uint16_t step = 0; step < total_steps; step++)
                {
                    /* Warm flame color */
                    uint8_t r = 255;
                    uint8_t g = (120 + (step * 8)) % 220;
                    uint8_t b = 20;
                    staircase_led_set_step_scaled(step, r, g, b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_FADE)
            {
                /* Smooth micro-fade per step */
                uint16_t sub_step_delay = delay_ms / 4;
                if (sub_step_delay < 10) sub_step_delay = 10;

                for (uint16_t step = 0; step < total_steps; step++)
                {
                    uint8_t br_levels[4] = {
                        (uint8_t)(cfg->brightness * 0.25f),
                        (uint8_t)(cfg->brightness * 0.50f),
                        (uint8_t)(cfg->brightness * 0.75f),
                        cfg->brightness
                    };

                    for (int l = 0; l < 4; l++) {
                        staircase_led_set_step_scaled(step, cfg->color_r, cfg->color_g, cfg->color_b, br_levels[l]);
                        if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_step_delay)) == pdTRUE) {
                            if (cmd.type == CMD_MANUAL_OFF) {
                                staircase_led_clear();
                                current_state = STAIR_STATE_IDLE;
                                break;
                            }
                        }
                    }
                    if (current_state == STAIR_STATE_IDLE) break;
                }
            }
            else
            {
                /* Classic Step-by-Step wave */
                for (uint16_t step = 0; step < total_steps; step++)
                {
                    staircase_led_set_step_scaled(step, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_ON_UP)
            {
                current_state = STAIR_STATE_HOLDING;
                hold_start_time_us = esp_timer_get_time();
                hold_duration_ms = cfg->hold_time_ms;
            }
        }

        /* TURNING ON DOWN (Top to Bottom) */
        else if (current_state == STAIR_STATE_TURNING_ON_DOWN)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t delay_ms = cfg->step_on_time_ms;
            uint8_t effect = cfg->anim_effect;

            if (effect == ANIM_EFFECT_CURTAIN)
            {
                /* Curtain from edges inwards */
                uint16_t half_steps = (total_steps + 1) / 2;
                uint16_t c_delay = delay_ms > 40 ? delay_ms : 40;

                for (uint16_t i = 0; i < half_steps; i++)
                {
                    int16_t s1 = i;
                    int16_t s2 = (total_steps - 1) - i;
                    if (s1 >= 0 && s1 < total_steps) {
                        staircase_led_set_step_scaled((uint16_t)s1, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    }
                    if (s2 >= 0 && s2 < total_steps) {
                        staircase_led_set_step_scaled((uint16_t)s2, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    }

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(c_delay)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_METEOR)
            {
                /* Meteor downward */
                uint16_t sub_delay = delay_ms / 2;
                if (sub_delay < 15) sub_delay = 15;

                for (int s = total_steps - 1; s >= 0; s--)
                {
                    staircase_led_render_meteor_step(total_steps - 1 - s, (int16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_delay)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }

                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_delay)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_RAINBOW)
            {
                /* Rainbow wave downwards */
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    uint16_t hue = (s * 360 / (total_steps > 0 ? total_steps : 1)) % 360;
                    uint8_t r, g, b;
                    staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                    staircase_led_set_step_scaled((uint16_t)s, r, g, b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_FIRE)
            {
                /* Fire flame ignition downwards */
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    uint8_t r = 255;
                    uint8_t g = (120 + (s * 8)) % 220;
                    uint8_t b = 20;
                    staircase_led_set_step_scaled((uint16_t)s, r, g, b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_FADE)
            {
                /* Smooth micro-fade downwards */
                uint16_t sub_step_delay = delay_ms / 4;
                if (sub_step_delay < 10) sub_step_delay = 10;

                for (int s = total_steps - 1; s >= 0; s--)
                {
                    uint8_t br_levels[4] = {
                        (uint8_t)(cfg->brightness * 0.25f),
                        (uint8_t)(cfg->brightness * 0.50f),
                        (uint8_t)(cfg->brightness * 0.75f),
                        cfg->brightness
                    };

                    for (int l = 0; l < 4; l++) {
                        staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, br_levels[l]);
                        if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_step_delay)) == pdTRUE) {
                            if (cmd.type == CMD_MANUAL_OFF) {
                                staircase_led_clear();
                                current_state = STAIR_STATE_IDLE;
                                break;
                            }
                        }
                    }
                    if (current_state == STAIR_STATE_IDLE) break;
                }
            }
            else
            {
                /* Classic Step-by-Step wave downwards */
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_ON_DOWN)
            {
                current_state = STAIR_STATE_HOLDING;
                hold_start_time_us = esp_timer_get_time();
                hold_duration_ms = cfg->hold_time_ms;
            }
        }

        /* HOLDING State */
        else if (current_state == STAIR_STATE_HOLDING)
        {
            static uint32_t hold_tick = 0;
            hold_tick++;

            /* Render dynamic hold effect */
            uint8_t hold_eff = cfg->hold_effect;
            if (hold_eff == HOLD_EFFECT_BREATHE)
            {
                /* Soft breathing pulse: 65%..100% of target brightness */
                uint16_t angle = (hold_tick * 8) % 360;
                /* Sin-like triangle approximation */
                int16_t factor = (angle < 180) ? angle : (360 - angle);
                uint8_t dynamic_br = (uint8_t)(cfg->brightness * (65 + (factor * 35 / 180)) / 100);
                staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, dynamic_br);
            }
            else if (hold_eff == HOLD_EFFECT_SHIMMER)
            {
                staircase_led_render_shimmer_frame(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness, hold_tick);
            }
            else if (hold_eff == HOLD_EFFECT_RAINBOW)
            {
                uint16_t hue_offset = (hold_tick * 4) % 360;
                staircase_led_render_rainbow_frame(hue_offset, cfg->brightness);
            }
            else if (hold_eff == HOLD_EFFECT_CANDLE)
            {
                staircase_led_render_fire_frame(cfg->brightness, hold_tick);
            }

            /* Calculate remaining time */
            int64_t elapsed_ms = (esp_timer_get_time() - hold_start_time_us) / 1000;
            if (elapsed_ms >= hold_duration_ms)
            {
                /* Transition to turning off */
                bool off_up = entered_from_bottom;
                if (cfg->reverse_direction) {
                    off_up = !off_up;
                }

                current_state = off_up ? STAIR_STATE_TURNING_OFF_UP : STAIR_STATE_TURNING_OFF_DOWN;
            }
            else
            {
                uint32_t wait_chunk = 40;
                if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(wait_chunk)) == pdTRUE)
                {
                    if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP)
                    {
                        hold_start_time_us = esp_timer_get_time();
                        ESP_LOGI(TAG, "Hold timer extended by sensor re-trigger");
                    }
                    else if (cmd.type == CMD_MANUAL_OFF)
                    {
                        if (cfg->night_mode) staircase_led_apply_night_mode(cfg);
                        else staircase_led_clear();
                        current_state = STAIR_STATE_IDLE;
                    }
                }
            }
        }

        /* TURNING OFF UP (Bottom to Top) */
        else if (current_state == STAIR_STATE_TURNING_OFF_UP)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t delay_ms = cfg->step_off_time_ms;
            uint8_t off_eff = cfg->off_effect;

            if (off_eff == OFF_EFFECT_ALL_FADE)
            {
                /* Simultaneous smooth all-step dim down */
                uint16_t fade_steps = 10;
                uint16_t f_delay = (delay_ms * 4) / fade_steps;
                if (f_delay < 15) f_delay = 15;

                for (int f = fade_steps - 1; f >= 0; f--)
                {
                    uint8_t br = (uint8_t)((cfg->brightness * f) / fade_steps);
                    staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, br);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(f_delay)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) {
                            staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                            current_state = STAIR_STATE_HOLDING;
                            hold_start_time_us = esp_timer_get_time();
                            hold_duration_ms = cfg->hold_time_ms;
                            break;
                        } else if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else
            {
                /* Sequential step turn off */
                for (uint16_t step = 0; step < total_steps; step++)
                {
                    staircase_led_clear_step(step);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE)
                    {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP)
                        {
                            staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                            current_state = STAIR_STATE_HOLDING;
                            hold_start_time_us = esp_timer_get_time();
                            hold_duration_ms = cfg->hold_time_ms;
                            break;
                        }
                        else if (cmd.type == CMD_MANUAL_OFF)
                        {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_OFF_UP)
            {
                if (cfg->night_mode) staircase_led_apply_night_mode(cfg);
                else staircase_led_clear();
                current_state = STAIR_STATE_IDLE;
            }
        }

        /* TURNING OFF DOWN (Top to Bottom) */
        else if (current_state == STAIR_STATE_TURNING_OFF_DOWN)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t delay_ms = cfg->step_off_time_ms;
            uint8_t off_eff = cfg->off_effect;

            if (off_eff == OFF_EFFECT_ALL_FADE)
            {
                /* Simultaneous smooth all-step dim down */
                uint16_t fade_steps = 10;
                uint16_t f_delay = (delay_ms * 4) / fade_steps;
                if (f_delay < 15) f_delay = 15;

                for (int f = fade_steps - 1; f >= 0; f--)
                {
                    uint8_t br = (uint8_t)((cfg->brightness * f) / fade_steps);
                    staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, br);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(f_delay)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) {
                            staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                            current_state = STAIR_STATE_HOLDING;
                            hold_start_time_us = esp_timer_get_time();
                            hold_duration_ms = cfg->hold_time_ms;
                            break;
                        } else if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else
            {
                /* Sequential step turn off downwards */
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    staircase_led_clear_step((uint16_t)s);

                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE)
                    {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP)
                        {
                            staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                            current_state = STAIR_STATE_HOLDING;
                            hold_start_time_us = esp_timer_get_time();
                            hold_duration_ms = cfg->hold_time_ms;
                            break;
                        }
                        else if (cmd.type == CMD_MANUAL_OFF)
                        {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_OFF_DOWN)
            {
                if (cfg->night_mode) staircase_led_apply_night_mode(cfg);
                else staircase_led_clear();
                current_state = STAIR_STATE_IDLE;
            }
        }
    }
}

esp_err_t staircase_init(staircase_settings_t *settings)
{
    if (settings == NULL) return ESP_ERR_INVALID_ARG;
    cfg = settings;

    if (cmd_queue == NULL) {
        cmd_queue = xQueueCreate(16, sizeof(stair_cmd_t));
        if (cmd_queue == NULL) {
            ESP_LOGE(TAG, "Failed to create staircase command queue");
            return ESP_ERR_NO_MEM;
        }
    }

    return ESP_OK;
}

void staircase_start(void)
{
    if (stair_task_handle == NULL) {
        xTaskCreate(
            staircase_fsm_task,
            "staircase_fsm",
            4096,
            NULL,
            5,
            &stair_task_handle
        );
        ESP_LOGI(TAG, "Staircase controller started successfully");
    }
}
