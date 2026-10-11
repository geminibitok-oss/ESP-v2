#ifndef WEB_OTA_H
#define WEB_OTA_H

#include "web_common.h"
#include "esp_ota_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Обработчик POST запроса для прошивки бинарного файла (.bin) по воздуху (OTA) */
esp_err_t ota_post_handler(httpd_req_t *req);

/* Обработчик GET запроса для получения информации о текущих разделах OTA и версии */
esp_err_t ota_status_handler(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_OTA_H
