#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"
#include "sensors.h"

typedef enum
{
    STAIR_STATE_IDLE = 0,
    STAIR_STATE_TURNING_ON_UP,
    STAIR_STATE_TURNING_ON_DOWN,
    STAIR_STATE_TURNING_ON_BOTH,
    STAIR_STATE_HOLDING,
    STAIR_STATE_TURNING_OFF_UP,
    STAIR_STATE_TURNING_OFF_DOWN,
    STAIR_STATE_MANUAL_ON,
} staircase_state_t;

esp_err_t staircase_init(staircase_settings_t *settings);
void staircase_start(void);

void staircase_trigger_bottom(void);
void staircase_trigger_top(void);

void staircase_set_manual_on(void);
void staircase_set_manual_off(void);
void staircase_toggle_manual(void);

staircase_state_t staircase_get_state(void);
const char* staircase_get_state_str(void);
uint32_t staircase_get_hold_remaining_ms(void);

void staircase_on_sensor_event(sensor_event_type_t event);
void staircase_apply_settings(const staircase_settings_t *settings);
void staircase_on_astro_event(bool is_night);
