#include "staircase.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "esp_log.h"
#include "esp_timer.h"
#include "staircase_led.h"
#include <math.h>
#include <stdlib.h>

static const char *TAG = "STAIRCASE";

typedef enum
{
    CMD_TRIGGER_BOTTOM = 1,
    CMD_TRIGGER_TOP,
    CMD_MANUAL_ON,
    CMD_MANUAL_OFF,
    CMD_TOGGLE_MANUAL,
    CMD_SETTINGS_UPDATED,
    CMD_ASTRO_EVENT,
    CMD_RESET_SENSORS,
    CMD_PARTY_ON,
    CMD_PARTY_OFF
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
static uint8_t party_effect_choice = 0;

const char* staircase_get_state_str(void)
{
    switch (current_state)
    {
        case STAIR_STATE_IDLE:             return "IDLE";
        case STAIR_STATE_TURNING_ON_UP:    return "TURNING_ON_UP";
        case STAIR_STATE_TURNING_ON_DOWN:  return "TURNING_ON_DOWN";
        case STAIR_STATE_TURNING_ON_BOTH:  return "TURNING_ON_BOTH";
        case STAIR_STATE_HOLDING:          return "HOLDING";
        case STAIR_STATE_TURNING_OFF_UP:   return "TURNING_OFF_UP";
        case STAIR_STATE_TURNING_OFF_DOWN: return "TURNING_OFF_DOWN";
        case STAIR_STATE_MANUAL_ON:        return "MANUAL_ON";
        case STAIR_STATE_PARTY_MODE:      return "PARTY_MODE";
        default:                           return "UNKNOWN";
    }
}

const char* staircase_get_state_str_ru(void)
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
        case STAIR_STATE_PARTY_MODE:      return "🎉 РЕЖИМ ПРАЗДНИК (БЕСКОНЕЧНЫЙ ЭФФЕКТ)";
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
        xQueueSend(cmd_queue, &cmd, pdMS_TO_TICKS(50));
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

void staircase_reset_sensors(void)
{
    ESP_LOGI(TAG, "Manual reset sensors requested");
    send_cmd(CMD_RESET_SENSORS);
}
void staircase_force_trigger_bottom(void)
{
    ESP_LOGI(TAG, "FORCE trigger bottom requested (ignores sensor state)");
    /* Очищаем очередь команд от старых датчиков */
    stair_cmd_t dummy;
    while (xQueueReceive(cmd_queue, &dummy, 0) == pdTRUE) {}
    /* Если лестница была в удержании или выключении - мгновенно перезапускаем анимацию снизу */
    send_cmd(CMD_TRIGGER_BOTTOM);
}

void staircase_force_trigger_top(void)
{
    ESP_LOGI(TAG, "FORCE trigger top requested (ignores sensor state)");
    stair_cmd_t dummy;
    while (xQueueReceive(cmd_queue, &dummy, 0) == pdTRUE) {}
    send_cmd(CMD_TRIGGER_TOP);
}

void staircase_set_party_effect(uint8_t eff)
{
    party_effect_choice = eff;
}

uint8_t staircase_get_party_effect(void)
{
    return party_effect_choice;
}

void staircase_set_party_mode(bool enable)
{
    ESP_LOGI(TAG, "Setting party mode: %d (effect: %u)", enable, party_effect_choice);
    if (enable) {
        /* Очищаем очередь, чтобы мгновенно перехватить FSM */
        stair_cmd_t dummy;
        while (xQueueReceive(cmd_queue, &dummy, 0) == pdTRUE) {}
        current_state = STAIR_STATE_PARTY_MODE;
        send_cmd(CMD_PARTY_ON);
    } else {
        current_state = STAIR_STATE_IDLE;
        send_cmd(CMD_PARTY_OFF);
    }
}

bool staircase_is_party_mode(void)
{
    return (current_state == STAIR_STATE_PARTY_MODE);
}


void staircase_on_sensor_event(sensor_event_type_t event)
{
    if (cfg != NULL && cfg->sensor_work_mode == 1 && !cfg->night_mode) {
        /* Режим: 'Только ночью' активен, а сейчас ДЕНЬ -> блокируем автоматическое включение от датчиков */
        return;
    }

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
        sensors_init(cfg, staircase_on_sensor_event);
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
                    /* Проверяем: если в этот же момент сработал и верхний датчик -> включаем встречную волну выбранным эффектом! */
                    if (sensor_top_active()) {
                        current_state = STAIR_STATE_TURNING_ON_BOTH;
                    } else {
                        current_state = STAIR_STATE_TURNING_ON_UP;
                        entered_from_bottom = true;
                    }
                }
                else if (cmd.type == CMD_TRIGGER_TOP)
                {
                    /* Проверяем: если в этот же момент сработал и нижний датчик -> включаем встречную волну выбранным эффектом! */
                    if (sensor_bottom_active()) {
                        current_state = STAIR_STATE_TURNING_ON_BOTH;
                    } else {
                        current_state = STAIR_STATE_TURNING_ON_DOWN;
                        entered_from_bottom = false;
                    }
                }
                else if (cmd.type == CMD_PARTY_ON)
                {
                    current_state = STAIR_STATE_PARTY_MODE;
                }
                else if (cmd.type == CMD_MANUAL_ON || cmd.type == CMD_TOGGLE_MANUAL)
                {
                    staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    current_state = STAIR_STATE_MANUAL_ON;
                }
                else if (cmd.type == CMD_SETTINGS_UPDATED || cmd.type == CMD_ASTRO_EVENT || cmd.type == CMD_RESET_SENSORS)
                {
                    if (cfg->night_mode) staircase_led_apply_night_mode(cfg);
                    else staircase_led_clear();
                    current_state = STAIR_STATE_IDLE;
                }
            }
        }

        /* PARTY MODE State: бесконечная циклическая анимация выбранного эффекта пока не отключат */
        else if (current_state == STAIR_STATE_PARTY_MODE)
        {
            static uint32_t party_frame = 0;
            party_frame++;
            uint16_t total = cfg->steps;
            uint8_t br = cfg->brightness;

            if (party_effect_choice == 0)
            {
                /* 0: Радужный перелив (Smooth Rainbow) */
                uint16_t hue_offset = (party_frame * 3) % 360;
                staircase_led_render_rainbow_frame(hue_offset, br);
            }
            else if (party_effect_choice == 1)
            {
                /* 1: Северное сияние (Aurora) */
                for (uint16_t s = 0; s < total; s++) {
                    uint16_t hue = (130 + ((s * 15 + party_frame * 3) % 110)) % 360;
                    uint8_t r, g, b;
                    staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                    staircase_led_set_step_scaled(s, r, g, b, br);
                }
            }
            else if (party_effect_choice == 2)
            {
                /* 2: Огонь / Живая Лава (Fire Flame) */
                staircase_led_render_fire_frame(br, party_frame);
            }
            else if (party_effect_choice == 3)
            {
                /* 3: Неоновый импульс (Cyber Pulse) */
                for (uint16_t s = 0; s < total; s++) {
                    uint16_t phase = (party_frame * 6 + s * 25) % 360;
                    uint8_t pulse_br = (uint8_t)(br * (40 + 60 * sinf(phase * 3.14159f / 180.0f)) / 100);
                    staircase_led_set_step_scaled(s, cfg->color_r, cfg->color_g, cfg->color_b, pulse_br);
                }
            }
            else if (party_effect_choice == 4)
            {
                /* 4: Мерцание звезд / Шиммер */
                staircase_led_render_shimmer_frame(cfg->color_r, cfg->color_g, cfg->color_b, br, party_frame);
            }
            else
            {
                /* 5: Волна выбранного цвета */
                uint16_t head = (party_frame / 2) % (total + 4);
                for (uint16_t s = 0; s < total; s++) {
                    int dist = abs((int)s - (int)head);
                    uint8_t step_br = (dist < 4) ? (uint8_t)(br * (4 - dist) / 4) : 10;
                    staircase_led_set_step_scaled(s, cfg->color_r, cfg->color_g, cfg->color_b, step_br);
                }
            }

            /* Пауза между кадрами (30 мс ~= 33 FPS) и опрос прерывания */
            if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(30)) == pdTRUE) {
                if (cmd.type == CMD_PARTY_OFF || cmd.type == CMD_MANUAL_OFF || cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) {
                    current_state = STAIR_STATE_IDLE;
                    staircase_led_clear();
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

        /* TURNING ON BOTH (Встречное включение при срабатывании 2 датчиков: ТОЧНО ВЫБРАННЫЙ ЭФФЕКТ навстречу друг другу) */
        else if (current_state == STAIR_STATE_TURNING_ON_BOTH)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t half = (total_steps + 1) / 2;
            uint16_t delay_ms = cfg->step_on_time_ms < 30 ? 30 : cfg->step_on_time_ms;
            uint8_t effect = cfg->anim_effect;

            ESP_LOGI(TAG, "Сработали 2 датчика! Запуск встречной анимации с эффектом #%u навстречу друг другу", effect);

            /* Встречное включение с соблюдением ВЫБРАННОГО ЭФФЕКТА */
            for (uint16_t i = 0; i < half; i++)
            {
                uint16_t s_bottom = i;
                uint16_t s_top = (total_steps - 1) - i;

                if (effect == ANIM_EFFECT_RAINBOW)
                {
                    /* Радужная волна навстречу с двух концов */
                    uint16_t hue_b = (s_bottom * 360 / (total_steps > 0 ? total_steps : 1)) % 360;
                    uint16_t hue_t = (s_top * 360 / (total_steps > 0 ? total_steps : 1)) % 360;
                    uint8_t rb, gb, bb, rt, gt, bt;
                    staircase_led_hsv2rgb(hue_b, 240, 255, &rb, &gb, &bb);
                    staircase_led_hsv2rgb(hue_t, 240, 255, &rt, &gt, &bt);
                    staircase_led_set_step_scaled(s_bottom, rb, gb, bb, cfg->brightness);
                    staircase_led_set_step_scaled(s_top, rt, gt, bt, cfg->brightness);
                }
                else if (effect == ANIM_EFFECT_COLOR_CYCLE)
                {
                    /* Цветовой спектр навстречу */
                    uint16_t hue_b = (i * 35) % 360;
                    uint16_t hue_t = ((half - i) * 35) % 360;
                    uint8_t rb, gb, bb, rt, gt, bt;
                    staircase_led_hsv2rgb(hue_b, 220, 255, &rb, &gb, &bb);
                    staircase_led_hsv2rgb(hue_t, 220, 255, &rt, &gt, &bt);
                    staircase_led_set_step_scaled(s_bottom, rb, gb, bb, cfg->brightness);
                    staircase_led_set_step_scaled(s_top, rt, gt, bt, cfg->brightness);
                }
                else if (effect == ANIM_EFFECT_FIRE)
                {
                    /* Огненная волна навстречу */
                    staircase_led_set_step_scaled(s_bottom, 255, 90, 0, cfg->brightness);
                    staircase_led_set_step_scaled(s_top, 255, 90, 0, cfg->brightness);
                }
                else if (effect == ANIM_EFFECT_FADE)
                {
                    /* Плавное нарастание навстречу */
                    uint8_t br_levels[3] = { (uint8_t)(cfg->brightness * 0.33f), (uint8_t)(cfg->brightness * 0.66f), cfg->brightness };
                    for (int l = 0; l < 3; l++) {
                        staircase_led_set_step_scaled(s_bottom, cfg->color_r, cfg->color_g, cfg->color_b, br_levels[l]);
                        staircase_led_set_step_scaled(s_top, cfg->color_r, cfg->color_g, cfg->color_b, br_levels[l]);
                        vTaskDelay(pdMS_TO_TICKS(delay_ms / 3));
                    }
                }
                else
                {
                    /* Классическая волна, штора, метеор выбранным цветом */
                    staircase_led_set_step_scaled(s_bottom, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    staircase_led_set_step_scaled(s_top, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                }

                if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                    if (cmd.type == CMD_MANUAL_OFF) {
                        staircase_led_clear();
                        current_state = STAIR_STATE_IDLE;
                        break;
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_ON_BOTH)
            {
                /* Завершение анимации: фиксация эффекта в удержании */
                if (effect == ANIM_EFFECT_RAINBOW) {
                    /* Для радуги сохраняем радужный спектр на ступенях */
                    for (uint16_t s = 0; s < total_steps; s++) {
                        uint16_t hue = (s * 360 / (total_steps > 0 ? total_steps : 1)) % 360;
                        uint8_t r, g, b;
                        staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                        staircase_led_set_step_scaled(s, r, g, b, cfg->brightness);
                    }
                } else {
                    staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                }
                current_state = STAIR_STATE_HOLDING;
                hold_start_time_us = esp_timer_get_time();
                hold_duration_ms = cfg->hold_time_ms + 2000;
            }
        }
        /* TURNING ON UP (Bottom to Top) */
        else if (current_state == STAIR_STATE_TURNING_ON_UP)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t delay_ms = cfg->step_on_time_ms;
            uint8_t effect = cfg->anim_effect;

            /* ПРИОРИТЕТ: Если выбран режим 'По одному диоду' - зажигаем каждый светодиод последовательно */
            if (cfg->step_fill_mode == 1 && cfg->pixels_per_step > 1)
            {
                uint16_t pps = cfg->pixels_per_step;
                uint16_t px_delay_ms = delay_ms / pps;
                if (px_delay_ms < 5) px_delay_ms = 5;

                for (uint16_t step = 0; step < total_steps; step++)
                {
                    for (uint16_t p = 0; p < pps; p++)
                    {
                        if (effect == ANIM_EFFECT_RAINBOW) {
                            uint16_t global_px = step * pps + p;
                            uint16_t total_px = total_steps * pps;
                            uint16_t hue = (global_px * 360 / (total_px > 0 ? total_px : 1)) % 360;
                            uint8_t r, g, b;
                            staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                            staircase_led_set_pixel_scaled(step, p, r, g, b, cfg->brightness);
                        } else {
                            staircase_led_set_pixel_scaled(step, p, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                        }

                        if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(px_delay_ms)) == pdTRUE) {
                            if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; }
                            else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                        }
                    }
                    if (current_state != STAIR_STATE_TURNING_ON_UP) break;
                }
            }
            else if (effect == ANIM_EFFECT_CURTAIN)
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }

                    staircase_led_set_step_scaled(step, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_delay)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                            if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                /* Режим заполнения: целиком ступенька или по одному диоду */
                if (cfg->step_fill_mode == 1 && cfg->pixels_per_step > 1)
                {
                    /* Включение ПО ОДНОМУ ДИОДУ снизу вверх */
                    uint16_t pps = cfg->pixels_per_step;
                    uint16_t px_delay_ms = delay_ms / pps;
                    if (px_delay_ms < 5) px_delay_ms = 5;

                    for (uint16_t step = 0; step < total_steps; step++)
                    {
                        for (uint16_t p = 0; p < pps; p++)
                        {
                            staircase_led_set_pixel_scaled(step, p, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                            staircase_led_show();

                            if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(px_delay_ms)) == pdTRUE) {
                                if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; }
                                else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                            }
                        }
                        if (current_state != STAIR_STATE_TURNING_ON_UP) break;
                    }
                }
                else
                {
                    /* Включение ступеньки целиком сразу */
                    for (uint16_t step = 0; step < total_steps; step++)
                    {
                        staircase_led_set_step_scaled(step, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);

                        if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                            if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
                                staircase_led_clear();
                                current_state = STAIR_STATE_IDLE;
                                break;
                            }
                        }
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_ON_UP)
            {
                current_state = STAIR_STATE_HOLDING;
                hold_start_time_us = esp_timer_get_time();
                hold_duration_ms = (cfg->hold_time_ms > 0) ? cfg->hold_time_ms : 5000;
                ESP_LOGI(TAG, "All steps turned ON UP! Entering HOLDING state for %lu ms", (unsigned long)hold_duration_ms);
            }
        }

        /* TURNING ON DOWN (Top to Bottom) */
        else if (current_state == STAIR_STATE_TURNING_ON_DOWN)
        {
            uint16_t total_steps = cfg->steps;
            uint16_t delay_ms = cfg->step_on_time_ms;
            uint8_t effect = cfg->anim_effect;

            /* ПРИОРИТЕТ: Если выбран режим 'По одному диоду' - зажигаем каждый светодиод последовательно сверху вниз */
            if (cfg->step_fill_mode == 1 && cfg->pixels_per_step > 1)
            {
                uint16_t pps = cfg->pixels_per_step;
                uint16_t px_delay_ms = delay_ms / pps;
                if (px_delay_ms < 5) px_delay_ms = 5;

                for (int s = total_steps - 1; s >= 0; s--)
                {
                    for (uint16_t p = 0; p < pps; p++)
                    {
                        if (effect == ANIM_EFFECT_RAINBOW) {
                            uint16_t global_px = (uint16_t)s * pps + p;
                            uint16_t total_px = total_steps * pps;
                            uint16_t hue = (global_px * 360 / (total_px > 0 ? total_px : 1)) % 360;
                            uint8_t r, g, b;
                            staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                            staircase_led_set_pixel_scaled((uint16_t)s, p, r, g, b, cfg->brightness);
                        } else {
                            staircase_led_set_pixel_scaled((uint16_t)s, p, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                        }

                        if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(px_delay_ms)) == pdTRUE) {
                            if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; }
                            else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                        }
                    }
                    if (current_state != STAIR_STATE_TURNING_ON_DOWN) break;
                }
            }
            else if (effect == ANIM_EFFECT_CURTAIN)
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }

                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_delay)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
                            staircase_led_clear();
                            current_state = STAIR_STATE_IDLE;
                            break;
                        }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_RUNNER)
            {
                /* Spark runner downwards */
                uint16_t sub_d = delay_ms > 30 ? delay_ms / 2 : 20;
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    if (s < total_steps - 1) staircase_led_set_step_scaled((uint16_t)(s + 1), cfg->color_r, cfg->color_g, cfg->color_b, (uint8_t)(cfg->brightness * 0.5f));
                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_d)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                    }
                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                }
            }
            else if (effect == ANIM_EFFECT_ACCORDION)
            {
                /* Symmetrical wave meeting in middle */
                uint16_t half = (total_steps + 1) / 2;
                uint16_t c_d = delay_ms > 40 ? delay_ms : 40;
                for (uint16_t i = 0; i < half; i++)
                {
                    uint16_t s1 = i;
                    uint16_t s2 = (total_steps - 1) - i;
                    staircase_led_set_step_scaled(s1, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    staircase_led_set_step_scaled(s2, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(c_d)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_COLOR_CYCLE)
            {
                /* Spectrum wave downwards */
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    uint16_t hue = (s * 25) % 360;
                    uint8_t r, g, b;
                    staircase_led_hsv2rgb(hue, 240, 255, &r, &g, &b);
                    staircase_led_set_step_scaled((uint16_t)s, r, g, b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                    }
                }
            }
            else if (effect == ANIM_EFFECT_STARLIGHT)
            {
                /* Random sparkling downwards */
                uint16_t s_d = delay_ms > 40 ? delay_ms / 2 : 25;
                for (uint16_t step = 0; step < total_steps; step++)
                {
                    uint16_t target_s = (total_steps - 1) - ((step * 7 + 3) % total_steps);
                    staircase_led_set_step_scaled(target_s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(s_d)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                    }
                }
                staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
            }
            else if (effect == ANIM_EFFECT_NEON_PULSE)
            {
                /* Neon surge downwards */
                uint16_t sub_p = delay_ms / 3;
                if (sub_p < 15) sub_p = 15;
                for (int s = total_steps - 1; s >= 0; s--)
                {
                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, (uint8_t)(cfg->brightness * 0.4f));
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_p)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                    }
                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                    if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(sub_p)) == pdTRUE) {
                        if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                    }
                    staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
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
                            if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                /* Режим заполнения: целиком ступенька или по одному диоду */
                if (cfg->step_fill_mode == 1 && cfg->pixels_per_step > 1)
                {
                    /* Включение ПО ОДНОМУ ДИОДУ сверху вниз: время шага делится на число диодов */
                    uint16_t pps = cfg->pixels_per_step;
                    uint16_t px_delay_ms = delay_ms / pps;
                    if (px_delay_ms < 5) px_delay_ms = 5;

                    for (int s = total_steps - 1; s >= 0; s--)
                    {
                        for (uint16_t p = 0; p < pps; p++)
                        {
                            staircase_led_set_pixel_scaled((uint16_t)s, p, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);
                            staircase_led_show();

                            if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(px_delay_ms)) == pdTRUE) {
                                if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; }
                                else if (cmd.type == CMD_MANUAL_OFF) { staircase_led_clear(); current_state = STAIR_STATE_IDLE; break; }
                            }
                        }
                        if (current_state != STAIR_STATE_TURNING_ON_DOWN) break;
                    }
                }
                else
                {
                    /* Включение ступеньки целиком сразу сверху вниз */
                    for (int s = total_steps - 1; s >= 0; s--)
                    {
                        staircase_led_set_step_scaled((uint16_t)s, cfg->color_r, cfg->color_g, cfg->color_b, cfg->brightness);

                        if (xQueueReceive(cmd_queue, &cmd, pdMS_TO_TICKS(delay_ms)) == pdTRUE) {
                            if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
                                staircase_led_clear();
                                current_state = STAIR_STATE_IDLE;
                                break;
                            }
                        }
                    }
                }
            }

            if (current_state == STAIR_STATE_TURNING_ON_DOWN)
            {
                current_state = STAIR_STATE_HOLDING;
                hold_start_time_us = esp_timer_get_time();
                hold_duration_ms = (cfg->hold_time_ms > 0) ? cfg->hold_time_ms : 5000;
                ESP_LOGI(TAG, "All steps turned ON DOWN! Entering HOLDING state for %lu ms", (unsigned long)hold_duration_ms);
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
            else if (hold_eff == HOLD_EFFECT_AURORA)
            {
                /* Aurora Borealis: Smooth emerald, cyan, indigo waves */
                for (uint16_t s = 0; s < cfg->steps; s++) {
                    uint16_t hue = (130 + ((s * 15 + hold_tick * 3) % 110)) % 360;
                    uint8_t r, g, b;
                    staircase_led_hsv2rgb(hue, 230, 255, &r, &g, &b);
                    staircase_led_set_step_scaled(s, r, g, b, cfg->brightness);
                }
            }
            else if (hold_eff == HOLD_EFFECT_PLASMA)
            {
                /* Plasma lava lamp flow */
                for (uint16_t s = 0; s < cfg->steps; s++) {
                    uint16_t hue = (cfg->color_r + ((s * 25 + hold_tick * 4) % 180)) % 360;
                    uint8_t r, g, b;
                    staircase_led_hsv2rgb(hue, 250, 255, &r, &g, &b);
                    staircase_led_set_step_scaled(s, r, g, b, cfg->brightness);
                }
            }
            else if (hold_eff == HOLD_EFFECT_HEARTBEAT)
            {
                /* Double pulse heartbeat */
                uint16_t phase = hold_tick % 40;
                uint8_t factor = 40;
                if (phase < 6) factor = 40 + phase * 10;
                else if (phase < 12) factor = 100 - (phase - 6) * 10;
                else if (phase < 18) factor = 40 + (phase - 12) * 9;
                else if (phase < 24) factor = 94 - (phase - 18) * 9;
                uint8_t br = (uint8_t)((cfg->brightness * factor) / 100);
                staircase_led_all_on(cfg->color_r, cfg->color_g, cfg->color_b, br);
            }

            /* Calculate remaining time */
            int64_t elapsed_ms = (esp_timer_get_time() - hold_start_time_us) / 1000;
            if (elapsed_ms >= (int64_t)hold_duration_ms)
            {
                ESP_LOGI(TAG, "Hold time finished (%lld >= %lu ms), starting turn-off animation...", (long long)elapsed_ms, (unsigned long)hold_duration_ms);
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
                    else if (cmd.type == CMD_MANUAL_OFF || cmd.type == CMD_RESET_SENSORS)
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
                        } else if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
                        } else if (cmd.type == CMD_TRIGGER_BOTTOM || cmd.type == CMD_TRIGGER_TOP) { current_state = STAIR_STATE_TURNING_ON_BOTH; break; } else if (cmd.type == CMD_MANUAL_OFF) {
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
