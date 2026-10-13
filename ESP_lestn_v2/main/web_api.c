#include "web_routes.h"
#include "time_astro.h"

static const char *TAG = "WEB_API";
static staircase_settings_t *cfg = NULL;

void web_api_set_settings(staircase_settings_t *settings)
{
    cfg = settings;
}

esp_err_t api_state_handler(httpd_req_t *req)
{
    if (!cfg) return ESP_FAIL;

    httpd_resp_set_type(req, "application/json");

    time_astro_status_t t_stat;
    time_astro_get_status(&t_stat);

    char json[2048];
    int offset = snprintf(json, sizeof(json),
        "{\"state\":\"%s\",\"hold_ms\":%u,\"bottom_sensor\":%s,\"top_sensor\":%s,\"heap\":%lu,"
        "\"time_synced\":%s,\"current_time\":\"%s\",\"sunrise\":\"%s\",\"sunset\":\"%s\",\"is_night\":%s,"
        "\"schedule_mode\":%u,\"next_switch\":\"%s\",\"steps\":[",
        staircase_get_state_str(),
        staircase_is_party_mode() ? "true" : "false",
        (unsigned int)staircase_get_hold_remaining_ms(),
        sensor_bottom_active() ? "true" : "false",
        sensor_top_active() ? "true" : "false",
        (unsigned int)cfg->sensor_bottom_type,
        (unsigned int)cfg->sensor_top_type,
        (unsigned int)sensor_bottom_distance_cm(),
        (unsigned int)sensor_top_distance_cm(),
        (unsigned int)cfg->sensor_bottom_threshold_cm,
        (unsigned int)cfg->sensor_top_threshold_cm,
        (unsigned long)esp_get_free_heap_size(),
        t_stat.synced ? "true" : "false",
        t_stat.time_str,
        t_stat.sunrise_str,
        t_stat.sunset_str,
        t_stat.is_night_time ? "true" : "false",
        (unsigned int)cfg->schedule_mode,
        t_stat.next_switch_str
    );

    for (uint16_t s = 0; s < cfg->steps && offset < (int)sizeof(json) - 16; s++) {
        bool on = staircase_led_step_is_on(s);
        offset += snprintf(json + offset, sizeof(json) - offset, "%s%s", s > 0 ? "," : "", on ? "true" : "false");
    }

    snprintf(json + offset, sizeof(json) - offset, "]}");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

esp_err_t api_trigger_handler(httpd_req_t *req)
{
    char query[128] = {0};
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK)
    {
        char dir[32] = {0};
        if (httpd_query_key_value(query, "dir", dir, sizeof(dir)) == ESP_OK)
        {
            if (strcmp(dir, "bottom") == 0) {
                staircase_force_trigger_bottom();
            } else if (strcmp(dir, "top") == 0) {
                staircase_force_trigger_top();
            } else if (strcmp(dir, "party_on") == 0) {
                staircase_set_party_mode(true);
            } else if (strcmp(dir, "party_off") == 0) {
                staircase_set_party_mode(false);
            } else if (strcmp(dir, "all_on") == 0) {
                staircase_set_manual_on();
            } else if (strcmp(dir, "all_off") == 0) {
                staircase_set_manual_off();
            } else if (strcmp(dir, "reset_sensors") == 0) {
                sensors_reset_state();
                staircase_reset_sensors();
            } else if (strcmp(dir, "toggle") == 0) {
                char step_str[16] = {0};
                if (httpd_query_key_value(query, "step", step_str, sizeof(step_str)) == ESP_OK) {
                    uint16_t step_idx = (uint16_t)atoi(step_str);
                    staircase_led_toggle_step(step_idx);
                }
            }
        }
    }

    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, "{\"status\":\"ok\"}");
}
