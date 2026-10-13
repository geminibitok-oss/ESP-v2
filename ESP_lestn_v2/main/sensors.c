#include "sensors.h"
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"

static const char *TAG = "SENSORS";

static sensor_event_cb_t event_callback = NULL;
static uint8_t bottom_gpio = STAIR_DEFAULT_SENSOR_BOTTOM_GPIO;
static uint8_t top_gpio = STAIR_DEFAULT_SENSOR_TOP_GPIO;
static uint8_t bottom_echo_gpio = 18;
static uint8_t top_echo_gpio = 19;
static uint8_t sensor_bottom_type = 0; // 0 = PIR, 1 = HC-SR04
static uint8_t sensor_top_type = 0;    // 0 = PIR, 1 = HC-SR04
static bool bottom_active_high = true;
static bool top_active_high = true;
static uint16_t bottom_threshold_cm = 80;
static uint16_t top_threshold_cm = 80;
static uint16_t debounce_ms = 60;

static QueueHandle_t isr_evt_queue = NULL;
static TaskHandle_t sensor_task_handle = NULL;
static bool last_bottom_active = false;
static bool last_top_active = false;
static uint16_t current_bottom_dist_cm = 999;
static uint16_t current_top_dist_cm = 999;

/* Измерение расстояния ультразвуковым датчиком HC-SR04 (см) */
static uint16_t measure_hcsr04_distance(uint8_t trig_pin, uint8_t echo_pin)
{
    // Отправляем 10 мкс стартовый импульс TRIG
    gpio_set_level(trig_pin, 0);
    esp_rom_delay_us(4);
    gpio_set_level(trig_pin, 1);
    esp_rom_delay_us(10);
    gpio_set_level(trig_pin, 0);

    // Ждем начала эхо-сигнала (HIGH) с таймаутом 25000 мкс
    int64_t wait_start = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 0) {
        if ((esp_timer_get_time() - wait_start) > 25000) {
            return 999; // Таймаут
        }
    }

    // Замеряем длительность импульса ECHO
    int64_t echo_start = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 1) {
        if ((esp_timer_get_time() - echo_start) > 30000) {
            return 999; // Выход за пределы (~5 метров)
        }
    }
    int64_t echo_duration_us = esp_timer_get_time() - echo_start;

    // Скорость звука: ~58 мкс на 1 см дистанции (туда и обратно)
    uint32_t dist_cm = (uint32_t)(echo_duration_us / 58);
    if (dist_cm > 400 || dist_cm < 2) {
        return 999;
    }
    return (uint16_t)dist_cm;
}

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

static bool check_pin_active(uint8_t gpio_num, bool is_high_active)
{
    int level = gpio_get_level(gpio_num);
    return is_high_active ? (level == 1) : (level == 0);
}

/* Background FreeRTOS task handling debounce, HC-SR04 distance measurement and dispatching */
static void sensor_processing_task(void *pvParameters)
{
    uint32_t io_num = 0;
    int64_t last_bottom_change_time = 0;
    int64_t last_top_change_time = 0;

    ESP_LOGI(TAG, "Sensor monitoring task started (type=%u, debounce=%u ms, active_high=%d)", 
             sensor_type, debounce_ms, active_high);

    while (1)
    {
        int64_t now_ms = esp_timer_get_time() / 1000;
        bool cur_bottom = false;
        bool cur_top = false;

        /* Опрос нижнего датчика */
        if (sensor_bottom_type == 1) {
            uint16_t d_bot = measure_hcsr04_distance(bottom_gpio, bottom_echo_gpio);
            if (d_bot != 999) current_bottom_dist_cm = d_bot;
            cur_bottom = (d_bot > 0 && d_bot <= bottom_threshold_cm);
        } else {
            cur_bottom = check_pin_active(bottom_gpio, bottom_active_high);
        }

        /* Небольшая пауза между эхо-импульсами, если оба датчика ультразвуковые */
        if (sensor_bottom_type == 1 && sensor_top_type == 1) {
            vTaskDelay(pdMS_TO_TICKS(15));
        }

        /* Опрос верхнего датчика */
        if (sensor_top_type == 1) {
            uint16_t d_top = measure_hcsr04_distance(top_gpio, top_echo_gpio);
            if (d_top != 999) current_top_dist_cm = d_top;
            cur_top = (d_top > 0 && d_top <= top_threshold_cm);
        } else {
            cur_top = check_pin_active(top_gpio, top_active_high);
        }

        if (sensor_bottom_type == 1 || sensor_top_type == 1) {
            vTaskDelay(pdMS_TO_TICKS(40));
        } else {
            xQueueReceive(isr_evt_queue, &io_num, pdMS_TO_TICKS(25));
        }

        /* Evaluate Bottom Sensor */
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
    bottom_echo_gpio = settings->sensor_bottom_echo_gpio;
    top_echo_gpio = settings->sensor_top_echo_gpio;

    // Поддержка раздельных типов датчиков
    sensor_bottom_type = settings->sensor_bottom_type;
    sensor_top_type = settings->sensor_top_type;
    bottom_active_high = settings->sensor_bottom_active_high;
    top_active_high = settings->sensor_top_active_high;
    bottom_threshold_cm = settings->sensor_bottom_threshold_cm > 0 ? settings->sensor_bottom_threshold_cm : 80;
    top_threshold_cm = settings->sensor_top_threshold_cm > 0 ? settings->sensor_top_threshold_cm : 80;
    debounce_ms = settings->sensor_debounce_ms > 0 ? settings->sensor_debounce_ms : 60;
    event_callback = cb;

    /* Инициализация нижнего датчика */
    if (sensor_bottom_type == 1) {
        gpio_set_direction(bottom_gpio, GPIO_MODE_OUTPUT);
        gpio_set_level(bottom_gpio, 0);
        gpio_set_direction(bottom_echo_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(bottom_echo_gpio, GPIO_PULLDOWN_ONLY);
    } else {
        gpio_set_direction(bottom_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(bottom_gpio, bottom_active_high ? GPIO_PULLDOWN_ONLY : GPIO_PULLUP_ONLY);
    }

    /* Инициализация верхнего датчика */
    if (sensor_top_type == 1) {
        gpio_set_direction(top_gpio, GPIO_MODE_OUTPUT);
        gpio_set_level(top_gpio, 0);
        gpio_set_direction(top_echo_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(top_echo_gpio, GPIO_PULLDOWN_ONLY);
    } else {
        gpio_set_direction(top_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(top_gpio, top_active_high ? GPIO_PULLDOWN_ONLY : GPIO_PULLUP_ONLY);
    }

    if (sensor_bottom_type == 0 || sensor_top_type == 0) {
        if (isr_evt_queue == NULL) {
            isr_evt_queue = xQueueCreate(16, sizeof(uint32_t));
        }
        gpio_install_isr_service(0);
        if (sensor_bottom_type == 0) {
            gpio_set_intr_type(bottom_gpio, GPIO_INTR_ANYEDGE);
            gpio_isr_handler_remove(bottom_gpio);
            gpio_isr_handler_add(bottom_gpio, gpio_isr_handler, (void *)(uint32_t)bottom_gpio);
        }
        if (sensor_top_type == 0) {
            gpio_set_intr_type(top_gpio, GPIO_INTR_ANYEDGE);
            gpio_isr_handler_remove(top_gpio);
            gpio_isr_handler_add(top_gpio, gpio_isr_handler, (void *)(uint32_t)top_gpio);
        }
    }

    last_bottom_active = (sensor_bottom_type == 0) ? check_pin_active(bottom_gpio, bottom_active_high) : false;
    last_top_active = (sensor_top_type == 0) ? check_pin_active(top_gpio, top_active_high) : false;

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

    return ESP_OK;
}

bool sensor_bottom_active(void)
{
    return last_bottom_active;
}

bool sensor_top_active(void)
{
    return last_top_active;
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
        while (xQueueReceive(isr_evt_queue, &dummy, 0) == pdTRUE) {}
    }
    ESP_LOGI(TAG, "Sensors manually reset to idle state");
}

bool sensor_is_ultrasonic(void)
{
    return (sensor_bottom_type == 1 || sensor_top_type == 1);
}

uint16_t sensor_bottom_distance_cm(void)
{
    return current_bottom_dist_cm;
}

uint16_t sensor_top_distance_cm(void)
{
    return current_top_dist_cm;
}
