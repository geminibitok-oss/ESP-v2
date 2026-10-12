#include "web_server.h"
#include "web_routes.h"
#include "web_common.h"
#include "web_ota.h"

static const char *TAG = "WEB_SERVER";
static httpd_handle_t server = NULL;

/* Прототипы функций настройки параметров из модулей */
extern void web_index_set_settings(staircase_settings_t *settings);
extern void web_settings_set_settings(staircase_settings_t *settings);
extern void web_wifi_set_settings(staircase_settings_t *settings);
extern void web_api_set_settings(staircase_settings_t *settings);

esp_err_t web_server_start(staircase_settings_t *settings)
{
    web_index_set_settings(settings);
    web_settings_set_settings(settings);
    web_wifi_set_settings(settings);
    web_api_set_settings(settings);

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 20;
    config.stack_size = 12288;
    config.recv_wait_timeout = 30; // 30 секунд таймаут на прием больших файлов OTA
    config.send_wait_timeout = 30;
    config.lru_purge_enable = true;
    config.max_resp_headers = 16;

    ESP_LOGI(TAG, "Starting HTTP Web Server on port %d...", config.server_port);

    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(err));
        return err;
    }

    httpd_uri_t uri_index = { .uri = "/", .method = HTTP_GET, .handler = index_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_get = { .uri = "/settings", .method = HTTP_GET, .handler = settings_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_settings_post = { .uri = "/settings", .method = HTTP_POST, .handler = settings_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_get = { .uri = "/wifi", .method = HTTP_GET, .handler = wifi_get_handler, .user_ctx = NULL };
    httpd_uri_t uri_wifi_post = { .uri = "/wifi", .method = HTTP_POST, .handler = wifi_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_state = { .uri = "/api/state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };
    httpd_uri_t uri_api_trigger = { .uri = "/api/trigger", .method = HTTP_GET, .handler = api_trigger_handler, .user_ctx = NULL };

    /* OTA Обновление прошивки */
    httpd_uri_t uri_ota_page = { .uri = "/update", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_page_alt = { .uri = "/ota", .method = HTTP_GET, .handler = ota_page_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post = { .uri = "/api/ota", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_post_update = { .uri = "/update", .method = HTTP_POST, .handler = ota_post_handler, .user_ctx = NULL };
    httpd_uri_t uri_ota_status = { .uri = "/api/ota/status", .method = HTTP_GET, .handler = ota_status_handler, .user_ctx = NULL };

    /* Для совместимости */
    httpd_uri_t uri_led_state = { .uri = "/led-state", .method = HTTP_GET, .handler = api_state_handler, .user_ctx = NULL };

    httpd_register_uri_handler(server, &uri_index);
    httpd_register_uri_handler(server, &uri_settings_get);
    httpd_register_uri_handler(server, &uri_settings_post);
    httpd_register_uri_handler(server, &uri_wifi_get);
    httpd_register_uri_handler(server, &uri_wifi_post);
    httpd_register_uri_handler(server, &uri_api_state);
    httpd_register_uri_handler(server, &uri_api_trigger);
    httpd_register_uri_handler(server, &uri_ota_page);
    httpd_register_uri_handler(server, &uri_ota_page_alt);
    httpd_register_uri_handler(server, &uri_ota_post);
    httpd_register_uri_handler(server, &uri_ota_post_update);
    httpd_register_uri_handler(server, &uri_ota_status);
    httpd_register_uri_handler(server, &uri_led_state);

    ESP_LOGI(TAG, "Web server started with endpoints: /, /settings, /wifi, /api/state, /api/trigger, /api/ota");
    return ESP_OK;
}
