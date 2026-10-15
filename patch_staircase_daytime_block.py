file_path_settings_c = "ESP_lestn_v2/main/settings.c"
with open(file_path_settings_c, "r", encoding="utf-8") as f:
    sc = f.read()

# Add only_night_trigger flag: default false (allows 24/7 trigger)
# But in settings_reset, let's see settings.h first
