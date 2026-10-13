#include "sensors.h"

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "driver/gpio.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "SENSORS";

static sensor_event_cb_t event_callback = NULL;

static uint8_t bottom_gpio = STAIR_DEFAULT_SENSOR_BOTTOM_GPIO;
static uint8_t top_gpio = STAIR_DEFAULT_SENSOR_TOP_GPIO;
static bool active_high = true;
static uint16_t debounce_ms = 60;

static QueueHandle_t isr_evt_queue = NULL;
static TaskHandle_t sensor_task_handle = NULL;

static bool last_bottom_active = false;
static bool last_top_active = false;

/* Hardware GPIO ISR handler - executes in IRAM ISR context */
static void IRAM_ATTR gpio_isr_handler(void *arg)
{
    uint32_t gpio_num = (uint32_t)arg;
    BaseType_t high_task_wakeup = pdFALSE;

    if (isr_evt_queue != NULL) {
        xQueueSendFromISR(isr_evt_queue, &gpio_num, &high_task_wakeup);
        if (high_task_wakeup == pdTRUE) {
            portYIELD_FROM_ISR();
        }
    }
}

static bool check_pin_active(uint8_t gpio_num)
{
    int level = gpio_get_level(gpio_num);
    return active_high ? (level == 1) : (level == 0);
}

/* Background FreeRTOS task handling debounce and state transition dispatching */
static void sensor_processing_task(void *pvParameters)
{
    uint32_t io_num = 0;
    int64_t last_bottom_change_time = 0;
    int64_t last_top_change_time = 0;

    ESP_LOGI(TAG, "Sensor monitoring task started (debounce=%u ms, active_high=%d)", debounce_ms, active_high);

    while (1)
    {
        /* Wait for ISR event or timeout after 25ms for continuous level verification */
        xQueueReceive(isr_evt_queue, &io_num, pdMS_TO_TICKS(25));

        int64_t now_ms = esp_timer_get_time() / 1000;

        /* Evaluate Bottom Sensor */
        bool cur_bottom = check_pin_active(bottom_gpio);
        if (cur_bottom != last_bottom_active)
        {
            if ((now_ms - last_bottom_change_time) >= debounce_ms)
            {
                last_bottom_change_time = now_ms;
                last_bottom_active = cur_bottom;

                if (event_callback != NULL) {
                    event_callback(cur_bottom ? SENSOR_EVENT_BOTTOM_TRIGGERED : SENSOR_EVENT_BOTTOM_RELEASED);
                }
            }
        }

        /* Evaluate Top Sensor */
        bool cur_top = check_pin_active(top_gpio);
        if (cur_top != last_top_active)
        {
            if ((now_ms - last_top_change_time) >= debounce_ms)
            {
                last_top_change_time = now_ms;
                last_top_active = cur_top;

                if (event_callback != NULL) {
                    event_callback(cur_top ? SENSOR_EVENT_TOP_TRIGGERED : SENSOR_EVENT_TOP_RELEASED);
                }
            }
        }
    }
}

esp_err_t sensors_init(
    const staircase_settings_t *settings,
    sensor_event_cb_t cb)
{
    if (settings == NULL)
        return ESP_ERR_INVALID_ARG;

    bottom_gpio = settings->sensor_bottom_gpio;
    top_gpio = settings->sensor_top_gpio;
    active_high = settings->sensor_active_high;
    debounce_ms = settings->sensor_debounce_ms > 0 ? settings->sensor_debounce_ms : 60;
    event_callback = cb;

    if (isr_evt_queue == NULL) {
        isr_evt_queue = xQueueCreate(16, sizeof(uint32_t));
        if (isr_evt_queue == NULL) {
            ESP_LOGE(TAG, "Failed to create sensor ISR queue");
            return ESP_ERR_NO_MEM;
        }
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << bottom_gpio) | (1ULL << top_gpio),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = active_high ? GPIO_PULLUP_DISABLE : GPIO_PULLUP_ENABLE,
        .pull_down_en = active_high ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_ANYEDGE
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure GPIO pins");
        return err;
    }

    /* We use ESP_INTR_FLAG_LOWMED (or 0) without IRAM flag to avoid cache-disabled panic during flash operations */
    err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Failed to install GPIO ISR service: %s", esp_err_to_name(err));
        return err;
    }

    gpio_isr_handler_remove(bottom_gpio);
    gpio_isr_handler_remove(top_gpio);

    err = gpio_isr_handler_add(bottom_gpio, gpio_isr_handler, (void *)(uint32_t)bottom_gpio);
    if (err != ESP_OK) return err;

    err = gpio_isr_handler_add(top_gpio, gpio_isr_handler, (void *)(uint32_t)top_gpio);
    if (err != ESP_OK) return err;

    last_bottom_active = check_pin_active(bottom_gpio);
    last_top_active = check_pin_active(top_gpio);

    if (sensor_task_handle == NULL) {
        BaseType_t task_created = xTaskCreate(
            sensor_processing_task,
            "sensor_task",
            3072,
            NULL,
            10,
            &sensor_task_handle
        );
        if (task_created != pdPASS) {
            ESP_LOGE(TAG, "Failed to create sensor task");
            return ESP_FAIL;
        }
    }

    ESP_LOGI(TAG, "Sensors initialized: Bottom GPIO=%u, Top GPIO=%u (active_high=%d)",
             bottom_gpio, top_gpio, active_high);

    return ESP_OK;
}

bool sensor_bottom_active(void)
{
    return check_pin_active(bottom_gpio);
}

bool sensor_top_active(void)
{
    return check_pin_active(top_gpio);
}

int sensor_bottom_level(void)
{
    return gpio_get_level(bottom_gpio);
}

int sensor_top_level(void)
{
    return gpio_get_level(top_gpio);
}

void sensors_reset_state(void)
{
    last_bottom_active = false;
    last_top_active = false;
    if (isr_evt_queue != NULL) {
        uint32_t dummy;
        while (xQueueReceive(isr_evt_queue, &dummy, 0) == pdTRUE) {
            /* drained queue */
        }
    }
    ESP_LOGI(TAG, "Sensors manually reset to idle state");
}

bool sensor_is_ultrasonic(void)
{
    return false;
}

uint16_t sensor_bottom_distance_cm(void)
{
    return 999;
}

uint16_t sensor_top_distance_cm(void)
{
    return 999;
}
