#include <stdio.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "nvs_flash.h"
#include "esp_log.h"

#include "settings.h"
#include "staircase_led.h"
#include "sensors.h"
#include "staircase.h"
#include "time_astro.h"
#include "wifi_manager.h"
#include "web_server.h"

static const char *TAG = "STAIR_MAIN";

static staircase_settings_t settings;

void app_main(void)
{
    /* Mute internal Wi-Fi driver noise/warning spam */
    esp_log_level_set("wifi", ESP_LOG_ERROR);
    esp_log_level_set("wifi_init", ESP_LOG_ERROR);

    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "   ESP32 Smart Staircase Controller    ");
    ESP_LOGI(TAG, "              Version 2.0               ");
    ESP_LOGI(TAG, "========================================");

    /* Initialize NVS Flash */
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND)
    {
        ESP_LOGW(TAG, "Erasing and re-initializing NVS flash...");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    /* Load persistent configuration */
    settings_load(&settings);

    ESP_LOGI(TAG, "Config: Steps=%u, Pixels/Step=%u (Total=%u LEDs)",
             settings.steps, settings.pixels_per_step, settings.steps * settings.pixels_per_step);
    ESP_LOGI(TAG, "Config: LED Pin=GPIO%u, Bottom Sensor=GPIO%u, Top Sensor=GPIO%u",
             settings.led_gpio, settings.sensor_bottom_gpio, settings.sensor_top_gpio);
    ESP_LOGI(TAG, "Config: Timings: Step ON=%u ms, Step OFF=%u ms, Hold=%u ms",
             settings.step_on_time_ms, settings.step_off_time_ms, settings.hold_time_ms);

    /* Initialize LED Strip (WS2812 / RMT driver) */
    ESP_ERROR_CHECK(staircase_led_init(&settings));

    /* Initialize Staircase Animation Engine */
    ESP_ERROR_CHECK(staircase_init(&settings));

    /* Initialize Motion Sensors with debouncing task and FSM dispatcher */
    ESP_LOGI(TAG, "Step 1: Initializing sensors...");
    ESP_ERROR_CHECK(sensors_init(&settings, staircase_on_sensor_event));

    /* Start Staircase Animation FSM Task */
    ESP_LOGI(TAG, "Step 2: Starting staircase FSM...");
    staircase_start();

    /* Initialize Wi-Fi Manager (Connects to STA or launches Fallback AP) */
    ESP_LOGI(TAG, "Step 3: Initializing Wi-Fi Manager...");
    ESP_ERROR_CHECK(wifi_manager_init(&settings));

    /* Initialize Internet Time (NTP) & Astronomical Sunset/Sunrise Engine */
    ESP_LOGI(TAG, "Step 4: Initializing Time & Astro Engine...");
    ESP_ERROR_CHECK(time_astro_init(&settings, staircase_on_astro_event));

    /* Start Embedded HTTP Web Server */
    ESP_LOGI(TAG, "Step 5: Starting HTTP Web Server...");
    ESP_ERROR_CHECK(web_server_start(&settings));

    ESP_LOGI(TAG, "Staircase controller operational. Web UI accessible at http://%s", wifi_manager_get_ip());

    /* Main monitor loop */
    while (true)
    {
        vTaskDelay(pdMS_TO_TICKS(10000));
        ESP_LOGI(TAG, "Heartbeat: State=%s, Free Heap=%lu bytes, Wi-Fi IP=%s",
                 staircase_get_state_str(),
                 (unsigned long)esp_get_free_heap_size(),
                 wifi_manager_get_ip());
    }
}
