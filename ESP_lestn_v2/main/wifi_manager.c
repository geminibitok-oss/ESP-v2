#include "wifi_manager.h"
#include "mdns.h" 

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#include "esp_log.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define MAX_STA_RETRY_COUNT 5

static const char *TAG = "WIFI";

static EventGroupHandle_t wifi_event_group;
static staircase_settings_t *cfg = NULL;

static bool connected = false;
static bool ap_mode = false;
static int sta_retry_num = 0;

static char ip_address[16] = "0.0.0.0";
static esp_netif_t *sta_netif = NULL;
static esp_netif_t *ap_netif = NULL;

static esp_err_t start_ap_internal(void);

static void wifi_event_handler(
    void *arg,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data)
{
    if (event_base == WIFI_EVENT)
    {
        if (event_id == WIFI_EVENT_STA_START)
        {
            ESP_LOGI(TAG, "STA started, attempting connection to '%s'...", cfg ? cfg->wifi_ssid : "");
            esp_wifi_connect();
        }
        else if (event_id == WIFI_EVENT_STA_DISCONNECTED)
        {
            connected = false;
            xEventGroupClearBits(wifi_event_group, WIFI_CONNECTED_BIT);

            if (sta_retry_num < MAX_STA_RETRY_COUNT)
            {
                sta_retry_num++;
                ESP_LOGW(TAG, "Wi-Fi disconnected. Retry %d of %d...", sta_retry_num, MAX_STA_RETRY_COUNT);
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_wifi_connect();
            }
            else
            {
                ESP_LOGE(TAG, "Failed to connect to Wi-Fi after %d attempts. Falling back to Access Point mode!", MAX_STA_RETRY_COUNT);
                xEventGroupSetBits(wifi_event_group, WIFI_FAIL_BIT);
                start_ap_internal();
            }
        }
        else if (event_id == WIFI_EVENT_AP_START)
        {
            ap_mode = true;
            strcpy(ip_address, "192.168.4.1");
            ESP_LOGI(TAG, "Access Point started successfully: SSID='ESP-Lestn', IP=%s", ip_address);
        }
    }
    else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP)
    {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        snprintf(
            ip_address,
            sizeof(ip_address),
            IPSTR,
            IP2STR(&event->ip_info.ip)
        );

        connected = true;
        ap_mode = false;
        sta_retry_num = 0;

        ESP_LOGI(TAG, "Wi-Fi connected successfully, IP: %s", ip_address);
        printf("\r\n===================================================\r\n");
        start_mdns_service();
        const char *hname = (cfg && cfg->hostname[0] != '\0') ? cfg->hostname : "esp-lestn";
        printf(" [UART / WI-FI] ESP32 ПОЛУЧИЛ IP-АДРЕС В СЕТИ:\r\n");
        printf(" >>>  IP: %s  <<<\r\n", ip_address);
        printf(" Локальное имя (mDNS): http://%s.local (или http://lestn.local)\r\n", hname);
        printf(" Веб-интерфейс доступен по ссылке: http://%s\r\n", ip_address);
        printf(" OTA-обновление: http://%s/update\r\n", ip_address);
        printf("===================================================\r\n\r\n");
        fflush(stdout);
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static esp_err_t start_ap_internal(void)
{
    wifi_config_t wifi_config = {
        .ap = {
            .ssid = "ESP-Lestn",
            .ssid_len = 0,
            .channel = 1,
            .password = "",
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN
        }
    };

    esp_wifi_stop();
    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_AP);
    if (err != ESP_OK) return err;

    err = esp_wifi_set_config(WIFI_IF_AP, &wifi_config);
    if (err != ESP_OK) return err;

    err = esp_wifi_start();
    if (err != ESP_OK) return err;

    esp_wifi_set_bandwidth(WIFI_IF_AP, WIFI_BW_HT20);

    strcpy(ip_address, "192.168.4.1");
    ap_mode = true;
    connected = false;

    ESP_LOGI(TAG, "=== Fallback AP Active ===");
    printf("\r\n===================================================\r\n");
    printf(" [UART / WI-FI] ESP32 РАБОТАЕТ В РЕЖИМЕ ТОЧКИ ДОСТУПА (AP):\r\n");
    printf(" >>>  IP: 192.168.4.1  |  SSID: ESP-Lestn  <<<\r\n");
    printf(" Веб-интерфейс: http://192.168.4.1\r\n");
    printf("===================================================\r\n\r\n");
    fflush(stdout);

    return ESP_OK;
}


static void start_mdns_service(void)
{
    const char *hname = (cfg && cfg->hostname[0] != '\0') ? cfg->hostname : "esp-lestn";
    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "mDNS init failed: %d", err);
        return;
    }
    mdns_hostname_set(hname);
    mdns_instance_name_set("ESP32 Smart Staircase Controller");

    // Add HTTP service advertisement
    mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);
    mdns_service_instance_name_set("_http", "_tcp", "ESP32 Staircase Web Interface");

    ESP_LOGI(TAG, "mDNS responder started: http://%s.local (also http://lestn.local)", hname);
}

static esp_err_t start_sta_internal(void)
{
    wifi_config_t wifi_config = {0};

    strncpy(
        (char *)wifi_config.sta.ssid,
        cfg->wifi_ssid,
        sizeof(wifi_config.sta.ssid) - 1
    );

    strncpy(
        (char *)wifi_config.sta.password,
        cfg->wifi_password,
        sizeof(wifi_config.sta.password) - 1
    );

    wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;

    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err != ESP_OK) return err;

    err = esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    if (err != ESP_OK) return err;

    sta_retry_num = 0;
    err = esp_wifi_start();
    if (err != ESP_OK) return err;

    esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT20);

    ESP_LOGI(TAG, "Connecting to STA SSID: %s", cfg->wifi_ssid);
    return ESP_OK;
}

esp_err_t wifi_manager_init(staircase_settings_t *settings)
{
    esp_log_level_set("wifi", ESP_LOG_ERROR);
    cfg = settings;
    wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    sta_netif = esp_netif_create_default_wifi_sta();
    ap_netif = esp_netif_create_default_wifi_ap();

    wifi_init_config_t wifi_init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_init_cfg));

    ESP_ERROR_CHECK(
        esp_event_handler_register(
            WIFI_EVENT,
            ESP_EVENT_ANY_ID,
            &wifi_event_handler,
            NULL
        )
    );

    ESP_ERROR_CHECK(
        esp_event_handler_register(
            IP_EVENT,
            IP_EVENT_STA_GOT_IP,
            &wifi_event_handler,
            NULL
        )
    );

    if (cfg->wifi_ssid[0] == '\0')
    {
        ESP_LOGW(TAG, "No Wi-Fi credentials found in settings, launching AP mode");
        return start_ap_internal();
    }

    return start_sta_internal();
}

bool wifi_manager_is_connected(void)
{
    return connected;
}

const char *wifi_manager_get_ip(void)
{
    return ip_address;
}

bool wifi_manager_is_ap_mode(void)
{
    return ap_mode;
}

esp_err_t wifi_manager_start_ap(void)
{
    return start_ap_internal();
}

esp_err_t wifi_manager_reconnect_sta(void)
{
    if (cfg == NULL || cfg->wifi_ssid[0] == '\0') return ESP_ERR_INVALID_STATE;
    return start_sta_internal();
}
