#include "sensors.h"
#include <string.h>
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

static const char *TAG = "SENSORS";

static uint8_t bottom_gpio = 23;
static uint8_t top_gpio = 22;
static uint8_t bottom_echo_gpio = 19;
static uint8_t top_echo_gpio = 18;

static uint8_t sensor_bottom_type = 1; /* 0: PIR, 1: HC-SR04 */
static uint8_t sensor_top_type = 1;    /* 0: PIR, 1: HC-SR04 */

static bool bottom_active_high = true;
static bool top_active_high = true;

static uint16_t bottom_threshold_cm = 80;
static uint16_t top_threshold_cm = 80;
static uint16_t debounce_ms = 80;

static sensor_event_cb_t event_callback = NULL;
static TaskHandle_t sensor_task_handle = NULL;

static bool last_bottom_active = false;
static bool last_top_active = false;
static uint16_t current_bottom_dist_cm = 999;
static uint16_t current_top_dist_cm = 999;

/*
 * Аппаратное измерение дистанции ультразвукового датчика HC-SR04.
 * Возвращает дистанцию в см или 999 при отсутствии эха / ошибке.
 */
static uint16_t measure_hcsr04_raw(uint8_t trig_pin, uint8_t echo_pin)
{
    /* 1. TRIG в 0 перед стартом */
    gpio_set_level(trig_pin, 0);
    esp_rom_delay_us(4);

    /* 2. Подаем 10 мкс импульс TRIG */
    gpio_set_level(trig_pin, 1);
    esp_rom_delay_us(10);
    gpio_set_level(trig_pin, 0);

    /* 3. Ожидаем появления фронта HIGH на ECHO (таймаут 10 мс) */
    int64_t wait_start = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 0) {
        if ((esp_timer_get_time() - wait_start) > 10000) {
            return 999; /* Нет ответа */
        }
    }

    /* 4. Замеряем длительность импульса ECHO (таймаут 25 мс ~= 430 см) */
    int64_t echo_start = esp_timer_get_time();
    while (gpio_get_level(echo_pin) == 1) {
        if ((esp_timer_get_time() - echo_start) > 24000) {
            return 999; /* Выход за пределы */
        }
    }
    int64_t echo_duration_us = esp_timer_get_time() - echo_start;

    /* 5. Пересчет времени пролета в сантиметры */
    uint32_t dist_cm = (uint32_t)(echo_duration_us / 58);
    if (dist_cm < 3 || dist_cm > 400) {
        return 999;
    }
    return (uint16_t)dist_cm;
}

/*
 * Медианный фильтр из 3 быстрых замеров:
 * Отсекает любые паразитные акустические наводки, шумы и случайные помехи по питанию!
 */
static uint16_t measure_hcsr04_distance_filtered(uint8_t trig_pin, uint8_t echo_pin)
{
    uint16_t r1 = measure_hcsr04_raw(trig_pin, echo_pin);
    esp_rom_delay_us(800);
    uint16_t r2 = measure_hcsr04_raw(trig_pin, echo_pin);
    esp_rom_delay_us(800);
    uint16_t r3 = measure_hcsr04_raw(trig_pin, echo_pin);

    /* Если все 3 - ошибка */
    if (r1 == 999 && r2 == 999 && r3 == 999) return 999;

    /* Медиана трех чисел */
    if ((r1 <= r2 && r2 <= r3) || (r3 <= r2 && r2 <= r1)) return r2;
    if ((r2 <= r1 && r1 <= r3) || (r3 <= r1 && r1 <= r2)) return r1;
    return r3;
}

static bool check_pin_active(uint8_t gpio_num, bool is_high_active)
{
    int level = gpio_get_level(gpio_num);
    return is_high_active ? (level == 1) : (level == 0);
}

/* Background FreeRTOS task handling debounce, HC-SR04 distance measurement and dispatching */
static void sensor_processing_task(void *pvParameters)
{
    int64_t last_bottom_change_time = 0;
    int64_t last_top_change_time = 0;

    /* Счетчики подтвержденных подряд замеров для исключения ложных срабатываний */
    uint8_t bottom_hit_counter = 0;
    uint8_t top_hit_counter = 0;

    ESP_LOGI(TAG, "Sensor task started: Bottom Type=%u (thresh=%u cm), Top Type=%u (thresh=%u cm), Debounce=%u ms",
             sensor_bottom_type, bottom_threshold_cm, sensor_top_type, top_threshold_cm, debounce_ms);

    while (1)
    {
        int64_t now_ms = esp_timer_get_time() / 1000;
        bool candidate_bottom = false;
        bool candidate_top = false;

        /* Опрос нижнего датчика */
        if (sensor_bottom_type == 1) {
            uint16_t d_bot = measure_hcsr04_distance_filtered(bottom_gpio, bottom_echo_gpio);
            if (d_bot != 999) current_bottom_dist_cm = d_bot;
            candidate_bottom = (d_bot > 3 && d_bot <= bottom_threshold_cm);
        } else {
            candidate_bottom = check_pin_active(bottom_gpio, bottom_active_high);
        }

        /* Пауза 25 мс между опросом нижнего и верхнего датчиков во избежание перекрестного эха */
        vTaskDelay(pdMS_TO_TICKS(25));

        /* Опрос верхнего датчика */
        if (sensor_top_type == 1) {
            uint16_t d_top = measure_hcsr04_distance_filtered(top_gpio, top_echo_gpio);
            if (d_top != 999) current_top_dist_cm = d_top;
            candidate_top = (d_top > 3 && d_top <= top_threshold_cm);
        } else {
            candidate_top = check_pin_active(top_gpio, top_active_high);
        }

        /* 
         * Фильтрация дребезга и ложных всплесков:
         * Для признания срабатывания требуется минимум 2 подтверждающих замера подряд!
         */
        if (candidate_bottom) {
            if (bottom_hit_counter < 3) bottom_hit_counter++;
        } else {
            if (bottom_hit_counter > 0) bottom_hit_counter--;
        }

        if (candidate_top) {
            if (top_hit_counter < 3) top_hit_counter++;
        } else {
            if (top_hit_counter > 0) top_hit_counter--;
        }

        bool cur_bottom = (bottom_hit_counter >= 2);
        bool cur_top = (top_hit_counter >= 2);

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

        vTaskDelay(pdMS_TO_TICKS(35));
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
    debounce_ms = settings->sensor_debounce_ms > 0 ? settings->sensor_debounce_ms : 80;
    event_callback = cb;

    /* Инициализация нижнего датчика */
    if (sensor_bottom_type == 1) {
        gpio_reset_pin(bottom_gpio);
        gpio_reset_pin(bottom_echo_gpio);
        gpio_set_direction(bottom_gpio, GPIO_MODE_OUTPUT);
        gpio_set_level(bottom_gpio, 0);
        gpio_set_direction(bottom_echo_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(bottom_echo_gpio, GPIO_PULLDOWN_ONLY);
    } else {
        gpio_reset_pin(bottom_gpio);
        gpio_set_direction(bottom_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(bottom_gpio, bottom_active_high ? GPIO_PULLDOWN_ONLY : GPIO_PULLUP_ONLY);
    }

    /* Инициализация верхнего датчика */
    if (sensor_top_type == 1) {
        gpio_reset_pin(top_gpio);
        gpio_reset_pin(top_echo_gpio);
        gpio_set_direction(top_gpio, GPIO_MODE_OUTPUT);
        gpio_set_level(top_gpio, 0);
        gpio_set_direction(top_echo_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(top_echo_gpio, GPIO_PULLDOWN_ONLY);
    } else {
        gpio_reset_pin(top_gpio);
        gpio_set_direction(top_gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(top_gpio, top_active_high ? GPIO_PULLDOWN_ONLY : GPIO_PULLUP_ONLY);
    }

    last_bottom_active = false;
    last_top_active = false;

    if (sensor_task_handle == NULL) {
        BaseType_t task_created = xTaskCreate(
            sensor_processing_task,
            "sensor_task",
            4096,
            NULL,
            10,
            &sensor_task_handle
        );
        if (task_created != pdPASS) {
            ESP_LOGE(TAG, "Failed to create sensor task");
            return ESP_FAIL;
        }
    }

    ESP_LOGI(TAG, "Sensors initialized: Bottom (TRIG=%u, ECHO=%u, TYPE=%u), Top (TRIG=%u, ECHO=%u, TYPE=%u)",
             bottom_gpio, bottom_echo_gpio, sensor_bottom_type,
             top_gpio, top_echo_gpio, sensor_top_type);
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

uint16_t sensor_bottom_distance_cm(void)
{
    return current_bottom_dist_cm;
}

uint16_t sensor_top_distance_cm(void)
{
    return current_top_dist_cm;
}

void sensors_reset_state(void)
{
    last_bottom_active = false;
    last_top_active = false;
    current_bottom_dist_cm = 999;
    current_top_dist_cm = 999;
}
