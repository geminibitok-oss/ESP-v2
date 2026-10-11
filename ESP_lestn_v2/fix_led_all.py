from pathlib import Path
import re

path = Path("main/web_server.c")
text = path.read_text(encoding="utf-8")

pattern = r"""static esp_err_t led_all_on_handler\(httpd_req_t \*req\)
\{
.*?
\}

static esp_err_t led_all_off_handler"""

replacement = r"""static esp_err_t led_all_on_handler(httpd_req_t *req)
{
    uint16_t total = cfg->steps * cfg->pixels_per_step;

    for (uint16_t i = 0; i < total; i++)
    {
        staircase_led_set_pixel(
            i,
            255,
            255,
            255
        );
    }

    staircase_led_show();

    /* Синхронизируем состояние всех ступеней */
    for (uint16_t step = 0; step < cfg->steps; step++)
    {
        staircase_led_set_step(
            step,
            255,
            255,
            255
        );
    }

    httpd_resp_set_type(
        req,
        "text/plain; charset=UTF-8"
    );

    return httpd_resp_sendstr(req, "OK");
}


static esp_err_t led_all_off_handler"""

new_text, count = re.sub(
    pattern,
    replacement,
    text,
    count=1,
    flags=re.S
)

if count != 1:
    print("ERROR: led_all_on_handler not found")
    raise SystemExit(1)

path.write_text(new_text, encoding="utf-8")

print("OK: led_all_on_handler fixed")