#include "web_ota.h"
#include "esp_ota_ops.h"
#include "esp_app_format.h"

static const char *TAG = "WEB_OTA";
#define OTA_BUFF_SIZE 1024

esp_err_t ota_page_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t app_info;
    if (esp_ota_get_partition_description(running, &app_info) != ESP_OK) {
        strncpy(app_info.version, "2.0.0", sizeof(app_info.version));
    }

    web_send_html_header(req, "Обновление (OTA)");

    // 1. Stats and manual file upload card
    char html[2048];
    snprintf(html, sizeof(html),
        "<div class='card'>"
        "<h2>🔄 Беспроводное обновление (OTA)</h2>"
        "<p style='font-size:13px;color:#94a3b8;margin-bottom:12px'>"
        "Загрузка файла прошивки <code>ESP_lestn_v2.bin</code> прямо через браузер без подключения USB кабеля."
        "</p>"
        "<div class='grid'>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Текущий слот</div>"
        "<strong style='color:#38bdf8'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Слот для записи</div>"
        "<strong style='color:#34d399'>%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Версия</div>"
        "<strong id='cur_ver_tag' style='color:#f8fafc'>v%s</strong>"
        "</div>"
        "<div style='background:#0f172a;padding:10px;border-radius:8px;border:1px solid #334155'>"
        "<div style='font-size:11px;color:#64748b'>Свободно RAM</div>"
        "<strong style='color:#fbbf24'>%lu КБ</strong>"
        "</div>"
        "</div>"
        "</div>",
        running ? running->label : "ota_0",
        update ? update->label : "ota_1",
        app_info.version,
        (unsigned long)(esp_get_free_heap_size() / 1024)
    );
    httpd_resp_sendstr_chunk(req, html);

    // 2. Direct GitHub Releases Updater Card
    httpd_resp_sendstr_chunk(req,
        "<div class='card' style='border-color:#0284c7'>"
        "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'>"
        "<h3 style='margin:0;color:#38bdf8'>📦 Обновление из GitHub Releases</h3>"
        "<button class='btn btn-sm' onclick='loadGitHubReleases()'>🔄 Проверить версии</button>"
        "</div>"
        "<p style='font-size:12px;color:#94a3b8;margin-bottom:12px'>"
        "Выберите нужную версию прошивки из репозитория <b>geminibitok-oss/ESP-v2</b>."
        "</p>"
        "<div id='gh_status' style='font-size:12px;color:#cbd5e1;margin-bottom:10px;padding:8px 12px;background:#0f172a;border-radius:6px;border:1px solid #334155'>"
        "Загрузка версий..."
        "</div>"
        "<div style='margin-bottom:12px'>"
        "<label for='rel_select' style='font-size:12px;color:#94a3b8'>Доступные релизы:</label>"
        "<select id='rel_select' style='margin-bottom:8px' onchange='onSelectRelease()'>"
        "<option value='latest'>latest (Свежая сборка)</option>"
        "</select>"
        "</div>"
        "<div style='display:flex;gap:8px;flex-wrap:wrap'>"
        "<a id='gh_dl_link' class='btn' style='flex:1;background:#0284c7;text-align:center;text-decoration:none' target='_blank' download>📥 Скачать ESP_lestn_v2.bin</a>"
        "</div>"
        "<div style='font-size:11px;color:#94a3b8;margin-top:8px'>"
        "💡 Нажмите <b>«📥 Скачать ESP_lestn_v2.bin»</b>, затем выберите скачанный файл в блоке ниже и нажмите <b>«🚀 Загрузить и обновить ESP32»</b>."
        "</div>"
        "</div>"
    );

    // 3. Local file upload card
    httpd_resp_sendstr_chunk(req,
        "<div class='card'>"
        "<h3>📁 Загрузить файл прошивки в память ESP32</h3>"
        "<div style='margin-top:10px'>"
        "<input type='file' id='ota_file' accept='.bin' style='margin-bottom:12px'>"
        "<button id='up_btn' class='btn' style='width:100%;background:#16a34a' onclick='startOTA()'>🚀 Загрузить и обновить ESP32</button>"
        "</div>"
        "<div id='prg_box' style='display:none;margin-top:14px'>"
        "<div style='display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px'>"
        "<span id='st_txt'>Запись во Flash память...</span><span id='pct'>0%</span>"
        "</div>"
        "<div style='background:#0f172a;height:8px;border-radius:4px;overflow:hidden;border:1px solid #334155'>"
        "<div id='bar' style='background:#0284c7;width:0%;height:100%;transition:width 0.2s'></div>"
        "</div>"
        "</div>"
        "</div>"
    );

    // 4. Client-side JavaScript logic
    httpd_resp_sendstr_chunk(req,
        "<script>"
        "var ghReleases=[];"
        "function updateDlLink(tag){"
        "var a=document.getElementById('gh_dl_link');"
        "a.href='https://github.com/geminibitok-oss/ESP-v2/releases/download/'+tag+'/ESP_lestn_v2.bin';"
        "a.innerHTML='📥 Скачать ESP_lestn_v2.bin ('+tag+')';"
        "}"
        "function loadGitHubReleases(){"
        "var st=document.getElementById('gh_status');st.innerHTML='⏳ Запрос релизов с api.github.com...';"
        "var xhr=new XMLHttpRequest();xhr.open('GET','https://api.github.com/repos/geminibitok-oss/ESP-v2/releases?per_page=15',true);"
        "xhr.onload=function(){if(xhr.status==200){try{"
        "ghReleases=JSON.parse(xhr.responseText);"
        "var sel=document.getElementById('rel_select');sel.innerHTML='';"
        "if(ghReleases&&ghReleases.length>0){"
        "for(var i=0;i<ghReleases.length;i++){"
        "var r=ghReleases[i];"
        "var opt=document.createElement('option');opt.value=r.tag_name;"
        "opt.text=r.tag_name+(r.tag_name==='latest'?' (Свежая автосборка)':' - '+(r.name||'Релиз'));"
        "sel.appendChild(opt);"
        "}"
        "updateDlLink(ghReleases[0].tag_name);"
        "st.innerHTML='✅ Найдено релизов: <b>'+ghReleases.length+'</b>. Выберите версию и скачайте бинарник в 1 клик.';"
        "}else{"
        "st.innerHTML='ℹ️ Доступен базовый релиз latest.';"
        "updateDlLink('latest');"
        "}"
        "}catch(e){st.innerHTML='Ошибка парсинга: '+e;}}"
        "else{st.innerHTML='⚠️ GitHub API ответил: '+xhr.status;updateDlLink('latest');}};"
        "xhr.onerror=function(){st.innerHTML='⚠️ Нет прямого доступа к api.github.com.';updateDlLink('latest');};"
        "xhr.send();"
        "}"
        "function onSelectRelease(){"
        "var sel=document.getElementById('rel_select');"
        "updateDlLink(sel.value||'latest');"
        "}"
        "function startOTA(){"
        "var f=document.getElementById('ota_file').files[0];"
        "if(!f){alert('Пожалуйста, выберите .bin файл');return;}"
        "var b=document.getElementById('up_btn');b.disabled=true;"
        "var p=document.getElementById('prg_box');p.style.display='block';"
        "var bar=document.getElementById('bar');var pct=document.getElementById('pct');var st=document.getElementById('st_txt');"
        "var xhr=new XMLHttpRequest();xhr.open('POST','/api/ota',true);"
        "xhr.upload.onprogress=function(e){if(e.lengthComputable){var pc=Math.round((e.loaded/e.total)*100);bar.style.width=pc+'%';pct.innerText=pc+'%';}};"
        "xhr.onload=function(){if(xhr.status==200){st.innerText='Успех! Контроллер перезагружается...';bar.style.background='#16a34a';"
        "var c=15;var ti=setInterval(function(){st.innerText='Перезагрузка... ('+c+'с)';if(--c<=0){clearInterval(ti);location.href='/';}},1000);"
        "}else{alert('Ошибка OTA: '+xhr.responseText);b.disabled=false;}};"
        "xhr.onerror=function(){alert('Сбой сети при передаче OTA');b.disabled=false;};"
        "xhr.send(f);"
        "}"
        "setTimeout(loadGitHubReleases, 300);"
        "</script>"
    );

    web_send_html_footer(req);
    return ESP_OK;
}

esp_err_t ota_status_handler(httpd_req_t *req)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *configured = esp_ota_get_boot_partition();
    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);

    esp_app_desc_t running_app_info;
    if (esp_ota_get_partition_description(running, &running_app_info) != ESP_OK) {
        strncpy(running_app_info.version, "2.0.0", sizeof(running_app_info.version));
        strncpy(running_app_info.project_name, "ESP_lestn_v2", sizeof(running_app_info.project_name));
    }

    char resp[512];
    snprintf(resp, sizeof(resp),
        "{"
        "\"project_name\":\"%s\","
        "\"version\":\"%s\","
        "\"running_partition\":\"%s\","
        "\"running_address\":\"0x%lx\","
        "\"boot_partition\":\"%s\","
        "\"next_update_partition\":\"%s\","
        "\"free_heap\":%lu"
        "}",
        running_app_info.project_name,
        running_app_info.version,
        running ? running->label : "unknown",
        running ? (unsigned long)running->address : 0,
        configured ? configured->label : "unknown",
        update ? update->label : "unknown",
        (unsigned long)esp_get_free_heap_size()
    );

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
}

esp_err_t ota_post_handler(httpd_req_t *req)
{
    esp_ota_handle_t update_handle = 0;
    const esp_partition_t *update_partition = NULL;

    ESP_LOGI(TAG, "Starting Over-The-Air (OTA) firmware update...");

    update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "Passive OTA partition not found");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA partition not found");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Writing to partition subtype %d at offset 0x%lx (label: %s)",
             update_partition->subtype, (unsigned long)update_partition->address, update_partition->label);

    int total_len = req->content_len;
    if (total_len <= 0) {
        ESP_LOGE(TAG, "Content-Length not specified or invalid");
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Content-Length header required");
        return ESP_FAIL;
    }

    esp_err_t err = esp_ota_begin(update_partition, OTA_WITH_SEQUENTIAL_WRITES, &update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "esp_ota_begin failed");
        return ESP_FAIL;
    }

    char *ota_write_data = (char *)malloc(OTA_BUFF_SIZE);
    if (!ota_write_data) {
        ESP_LOGE(TAG, "Failed to allocate OTA buffer");
        esp_ota_abort(update_handle);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
        return ESP_ERR_NO_MEM;
    }

    int remaining = total_len;
    bool is_first_chunk = true;

    while (remaining > 0) {
        int to_read = remaining > OTA_BUFF_SIZE ? OTA_BUFF_SIZE : remaining;
        int received = httpd_req_recv(req, ota_write_data, to_read);
        if (received <= 0) {
            if (received == HTTPD_SOCK_ERR_TIMEOUT) {
                continue; // Retry on timeout
            }
            ESP_LOGE(TAG, "File receive error: %d", received);
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA transfer interrupted");
            return ESP_FAIL;
        }

        if (is_first_chunk) {
            is_first_chunk = false;
            // Validate magic byte (0xE9 for ESP32 image)
            if ((uint8_t)ota_write_data[0] != 0xE9) {
                ESP_LOGE(TAG, "Invalid image magic byte: 0x%02X (expected 0xE9)", (uint8_t)ota_write_data[0]);
                free(ota_write_data);
                esp_ota_abort(update_handle);
                httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid firmware binary header");
                return ESP_FAIL;
            }
        }

        err = esp_ota_write(update_handle, (const void *)ota_write_data, received);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "esp_ota_write failed (%s)", esp_err_to_name(err));
            free(ota_write_data);
            esp_ota_abort(update_handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Flash write failed");
            return ESP_FAIL;
        }

        remaining -= received;
    }

    free(ota_write_data);

    err = esp_ota_end(update_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Firmware validation failed");
        return ESP_FAIL;
    }

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed (%s)", esp_err_to_name(err));
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Failed to switch boot partition");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "OTA upgrade successful! Next boot partition: %s. Scheduling reboot in 1.5s...", update_partition->label);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    const char *resp = "{\"status\":\"success\",\"message\":\"Firmware successfully flashed. Rebooting ESP32...\"}";
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);

    // Schedule reboot after sending response
    web_schedule_restart(1500);

    return ESP_OK;
}
