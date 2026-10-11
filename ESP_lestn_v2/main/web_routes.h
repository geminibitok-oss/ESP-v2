#ifndef WEB_ROUTES_H
#define WEB_ROUTES_H

#include "web_common.h"

#ifdef __cplusplus
extern "C" {
#endif

void web_routes_set_settings(staircase_settings_t *settings);

/* Главная страница */
esp_err_t index_handler(httpd_req_t *req);

/* Настройки */
esp_err_t settings_get_handler(httpd_req_t *req);
esp_err_t settings_post_handler(httpd_req_t *req);

/* Wi-Fi */
esp_err_t wifi_get_handler(httpd_req_t *req);
esp_err_t wifi_post_handler(httpd_req_t *req);

/* REST API */
esp_err_t api_state_handler(httpd_req_t *req);
esp_err_t api_trigger_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_ROUTES_H
