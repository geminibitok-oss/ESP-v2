#pragma once

#include "esp_err.h"
#include "settings.h"

esp_err_t web_server_start(
    staircase_settings_t *settings
);
