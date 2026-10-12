export interface StaircaseSettings {
  // Wi-Fi
  wifi_ssid: string;
  wifi_password?: string;
  hostname: string;

  // GPIO
  led_gpio: number;
  sensor_bottom_gpio: number;
  sensor_top_gpio: number;

  // Geometry
  steps: number;
  pixels_per_step: number;

  // Brightness (0-100)
  brightness: number;
  night_brightness: number;

  // Main Color
  color_r: number;
  color_g: number;
  color_b: number;

  // Night Color
  night_color_r: number;
  night_color_g: number;
  night_color_b: number;

  // Effects
  anim_effect: number; // 0: Classic, 1: Fade, 2: Curtain, 3: Meteor, 4: Rainbow, 5: Fire
  hold_effect: number; // 0: Solid, 1: Breathe, 2: Shimmer, 3: Rainbow, 4: Candle
  off_effect: number;  // 0: Wave, 1: All Fade, 2: Step Fade

  // Timings (ms)
  step_on_time_ms: number;
  step_off_time_ms: number;
  hold_time_ms: number;
  fade_duration_ms: number;

  // Modes
  night_mode: boolean;
  night_mode_type: number; // 0: edge steps, 1: all steps
  reverse_direction: boolean;
  sensor_active_high: boolean;
  sensor_debounce_ms: number;

  // Step Enablement (First & Last step disable options)
  enable_first_step: boolean;
  enable_last_step: boolean;
  night_first_step: boolean;
  night_last_step: boolean;

  // Sensor Type & Ultrasonic HC-SR04 Configuration
  // 0: PIR / Optical (Digital GPIO), 1: Ultrasonic HC-SR04
  sensor_type: number;
  sensor_bottom_echo_gpio?: number;
  sensor_top_echo_gpio?: number;
  ultrasonic_trigger_distance_cm?: number; // Порог срабатывания, например 100 см
  ultrasonic_max_distance_cm?: number;     // Максимальная дистанция измерения (обычно 200-400 см)

  // Internet Time & Astronomical Solar Schedule
  ntp_enabled: boolean;
  ntp_server: string;
  timezone_offset: number; // UTC offset in hours (-12..+14)
  latitude: number;
  longitude: number;
  schedule_mode: number; // 0: Astro (Sunset/Sunrise), 1: Fixed Time, 2: Always On, 3: Off
  sunset_offset_min: number; // +/- minutes from sunset
  sunrise_offset_min: number; // +/- minutes from sunrise
  fixed_on_hour: number;
  fixed_on_minute: number;
  fixed_off_hour: number;
  fixed_off_minute: number;
}

export type StairState =
  | 'IDLE'
  | 'TURNING_ON_UP'
  | 'TURNING_ON_DOWN'
  | 'TURNING_ON_BOTH'
  | 'HOLDING'
  | 'TURNING_OFF_UP'
  | 'TURNING_OFF_DOWN'
  | 'MANUAL_ON';

export interface SourceFile {
  name: string;
  path: string;
  category: 'core' | 'driver' | 'web' | 'config';
  description: string;
  code: string;
}
