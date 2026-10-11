#ifndef WEB_COMMON_H
#define WEB_COMMON_H

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include <ctype.h>

#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "esp_timer.h"

#include "settings.h"
#include "staircase_led.h"
#include "staircase.h"
#include "sensors.h"
#include "wifi_manager.h"

#ifdef __cplusplus
extern "C" {
#endif

void web_url_decode(char *dst, const char *src, size_t max_len);
bool web_get_post_param(const char *buf, const char *key, char *dest, size_t dest_len);
int web_get_post_param_int(const char *buf, const char *key, int default_val);
float web_get_post_param_float(const char *buf, const char *key, float default_val);
void web_schedule_restart(uint32_t delay_ms);

esp_err_t web_send_html_header(httpd_req_t *req, const char *title);
esp_err_t web_send_html_footer(httpd_req_t *req);

#ifdef __cplusplus
}
#endif

#endif // WEB_COMMON_H
