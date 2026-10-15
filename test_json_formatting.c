#include <stdio.h>
#include <stdbool.h>
#include <stdint.h>

int main() {
    char json[2048];
    const char *state = "ОЖИДАНИЕ";
    bool is_party = false;
    unsigned int party_eff = 0;
    unsigned int hold_ms = 4000;
    bool bottom_sensor = false;
    bool top_sensor = false;
    unsigned int sensor_bottom_type = 1;
    unsigned int sensor_top_type = 1;
    unsigned int bottom_dist = 85;
    unsigned int top_dist = 80;
    unsigned int bottom_threshold = 80;
    unsigned int top_threshold = 80;
    unsigned long heap = 180000;
    bool time_synced = true;
    const char *current_time = "10:45:00";
    const char *sunrise = "06:30";
    const char *sunset = "18:15";
    bool is_night = false;
    unsigned int sensor_work_mode = 0;
    unsigned int schedule_mode = 0;
    const char *next_switch = "Закат в 18:15";

    int offset = snprintf(json, sizeof(json),
        "{"
        "\"state\":\"%s\","
        "\"is_party\":%s,"
        "\"party_eff\":%u,"
        "\"hold_ms\":%u,"
        "\"bottom_sensor\":%s,"
        "\"top_sensor\":%s,"
        "\"sensor_bottom_type\":%u,"
        "\"sensor_top_type\":%u,"
        "\"bottom_dist\":%u,"
        "\"top_dist\":%u,"
        "\"bottom_threshold\":%u,"
        "\"top_threshold\":%u,"
        "\"heap\":%lu,"
        "\"time_synced\":%s,"
        "\"current_time\":\"%s\","
        "\"sunrise\":\"%s\","
        "\"sunset\":\"%s\","
        "\"is_night\":%s,"
        "\"sensor_work_mode\":%u,"
        "\"schedule_mode\":%u,"
        "\"next_switch\":\"%s\","
        "\"steps\":[]}",
        state,
        is_party ? "true" : "false",
        party_eff,
        hold_ms,
        bottom_sensor ? "true" : "false",
        top_sensor ? "true" : "false",
        sensor_bottom_type,
        sensor_top_type,
        bottom_dist,
        top_dist,
        bottom_threshold,
        top_threshold,
        heap,
        time_synced ? "true" : "false",
        current_time,
        sunrise,
        sunset,
        is_night ? "true" : "false",
        sensor_work_mode,
        schedule_mode,
        next_switch
    );

    printf("Generated JSON:\n%s\n", json);
    return 0;
}
