#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "settings.h"

typedef enum
{
    SENSOR_EVENT_NONE = 0,
    SENSOR_EVENT_BOTTOM_TRIGGERED,
    SENSOR_EVENT_TOP_TRIGGERED,
    SENSOR_EVENT_BOTTOM_RELEASED,
    SENSOR_EVENT_TOP_RELEASED,
} sensor_event_type_t;

typedef void (*sensor_event_cb_t)(sensor_event_type_t event);

esp_err_t sensors_init(
    const staircase_settings_t *settings,
    sensor_event_cb_t callback
);

bool sensor_bottom_active(void);
bool sensor_top_active(void);

int sensor_bottom_level(void);
int sensor_top_level(void);

void sensors_reset_state(void);
bool sensor_is_ultrasonic(void);
uint16_t sensor_bottom_distance_cm(void);
uint16_t sensor_top_distance_cm(void);
