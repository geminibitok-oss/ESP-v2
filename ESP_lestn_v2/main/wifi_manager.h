#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "settings.h"

esp_err_t wifi_manager_init(
    staircase_settings_t *settings
);

bool wifi_manager_is_connected(void);

const char *wifi_manager_get_ip(void);

bool wifi_manager_is_ap_mode(void);

esp_err_t wifi_manager_start_ap(void);
esp_err_t wifi_manager_reconnect_sta(void);
