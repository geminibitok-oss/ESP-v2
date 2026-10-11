idf_component_register(
    SRCS
        "main.c"
        "staircase.c"
        "sensors.c"
        "led_strip.c"
        "wifi_manager.c"
        "time_astro.c"
        "settings.c"
        "web_common.c"
        "web_page_index.c"
        "web_page_settings.c"
        "web_page_wifi.c"
        "web_api.c"
        "web_ota.c"
        "web_server.c"

    INCLUDE_DIRS
        "."
)

target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-format-truncation -Wno-format)
