/*
 * ============================================================
 *  FIRMWARE ESP32-CAM + DHT22 - Smart Trap Lahan Jagung
 *  MODE: STATION + mDNS + LED Flash ON
 *  VERSI: ANTI-BLOCKING (stream + telemetry + capture bareng)
 * ============================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiManager.h>
#include <ESPmDNS.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"
#include "DHT.h"
#include "lwip/sockets.h"
#include "esp_wifi.h"
#if __has_include(<esp_arduino_version.h>)
  #include <esp_arduino_version.h>
#endif

// ==========================================
// 1. KONFIGURASI
// ==========================================
const char* MDNS_HOSTNAME   = "smarttrap";
const char* AP_SETUP_SSID   = "SmartTrap-Setup";
const char* AP_SETUP_PASS   = "12345678";

// ⚡ 5 FPS (200ms) — radio WiFi luang 50% untuk /telemetry & /capture
#define FRAME_INTERVAL_MS       200

// ⚡ DHT dibaca tiap 5 detik di loop() — bukan di HTTP handler
#define DHT_READ_INTERVAL_MS    5000

// ==========================================
// 2. LED FLASH
// ==========================================
#define FLASH_LED_PIN        4
#define FLASH_LEDC_CHANNEL   7
#define FLASH_PWM_DUTY       35
static bool flashState = true;

// ==========================================
// 3. DHT22 + CACHE
// ==========================================
#define DHTPIN  13
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// ⚡ CACHE — dibaca di loop(), disajikan instan oleh HTTP handler
static float    cachedTemp       = 28.5;
static float    cachedHum        = 70.0;
static bool     dhtOk            = false;
static unsigned long lastDhtRead = 0;

// ==========================================
// 4. PIN KAMERA
// ==========================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

httpd_handle_t stream_httpd = NULL;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// ==========================================
// 5. FUNGSI LED
// ==========================================
void setFlashDuty(uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  ledcWrite(FLASH_LED_PIN, duty);
#else
  ledcWrite(FLASH_LEDC_CHANNEL, duty);
#endif
}

void setupFlashLed() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  ledcAttach(FLASH_LED_PIN, 1000, 8);
#else
  ledcSetup(FLASH_LEDC_CHANNEL, 1000, 8);
  ledcAttachPin(FLASH_LED_PIN, FLASH_LEDC_CHANNEL);
#endif
  setFlashDuty(FLASH_PWM_DUTY);
  flashState = true;
  Serial.println("[LED] Flash ON");
}

// ==========================================
// 6. FUNGSI BACA DHT (dipanggil di loop, BUKAN di handler!)
// ==========================================
void updateDhtCache() {
  if (!dhtOk) return;
  unsigned long now = millis();
  if (now - lastDhtRead < DHT_READ_INTERVAL_MS) return;
  lastDhtRead = now;

  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (!isnan(h) && !isnan(t)) {
    cachedTemp = t;
    cachedHum  = h;
    Serial.printf("[DHT] Update: %.1f C, %.1f %%\n", t, h);
  } else {
    Serial.println("[DHT] Read gagal, pakai cache lama");
  }
}

// ==========================================
// 7. HANDLER: STREAM (DENGAN YIELD!)
// ==========================================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char part_buf[64];
  unsigned long lastFrame = 0;
  int frameCount = 0;

  // TCP_NODELAY
  int fd = httpd_req_to_sockfd(req);
  if (fd >= 0) {
    int yes = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));
  }

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");

  Serial.println("[STREAM] Client connect");

  while (true) {
    // ⚡ TASK YIELD: beri napas ke HTTP server & WiFi
    // Ini KUNCI supaya /telemetry & /capture bisa masuk saat stream jalan
    taskYIELD();

    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM] Frame fail");
      vTaskDelay(50 / portTICK_PERIOD_MS);
      continue;
    }
    _jpg_buf_len = fb->len;
    _jpg_buf = fb->buf;

    // Kirim boundary + header + frame
    if (res == ESP_OK)
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    if (res == ESP_OK) {
      size_t hlen = snprintf(part_buf, sizeof(part_buf), _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, part_buf, hlen);
    }
    if (res == ESP_OK)
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);

    esp_camera_fb_return(fb);
    fb = NULL;
    _jpg_buf = NULL;
    frameCount++;

    if (res != ESP_OK) {
      Serial.printf("[STREAM] Client disconnect (frames: %d)\n", frameCount);
      break;
    }

    // ⚡ Rate limit 5 FPS — pakai vTaskDelay (yield + delay)
    unsigned long now = millis();
    if (now - lastFrame < FRAME_INTERVAL_MS) {
      vTaskDelay((FRAME_INTERVAL_MS - (now - lastFrame)) / portTICK_PERIOD_MS);
    }
    lastFrame = millis();

    // Log tiap 20 frame
    if (frameCount % 20 == 0) {
      Serial.printf("[STREAM] %d frame | Heap: %d\n", frameCount, ESP.getFreeHeap());
    }
  }
  return res;
}

// ==========================================
// 8. HANDLER: TELEMETRY (INSTAN — pakai cache!)
// ==========================================
static esp_err_t telemetry_handler(httpd_req_t *req) {
  // ⚡ TIDAK ada dht.readXxx() di sini! Pakai cache = respon <10ms
  char json[220];
  snprintf(json, sizeof(json),
    "{\"temperature\":%.1f,\"humidity\":%.1f,\"trap_id\":\"LAHAN-01\","
    "\"status\":\"active\",\"flash\":\"%s\",\"ip\":\"%s\",\"rssi\":%d}",
    cachedTemp, cachedHum,
    flashState ? "on" : "off",
    WiFi.localIP().toString().c_str(),
    WiFi.RSSI());

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
  return httpd_resp_send(req, json, strlen(json));
}

// ==========================================
// 9. HANDLER: FLASH
// ==========================================
static esp_err_t flash_handler(httpd_req_t *req) {
  char state[8] = "";
  size_t len = httpd_req_get_url_query_len(req) + 1;
  if (len > 1) {
    char query[64];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
      httpd_query_key_value(query, "state", state, sizeof(state));
      if (strcmp(state, "on") == 0)  { setFlashDuty(FLASH_PWM_DUTY); flashState = true; }
      if (strcmp(state, "off") == 0) { setFlashDuty(0); flashState = false; }
    }
  }
  char resp[40];
  snprintf(resp, sizeof(resp), "{\"flash\":\"%s\"}", flashState ? "on" : "off");
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, resp, strlen(resp));
}

// ==========================================
// 10. HANDLER: CAPTURE
// ==========================================
static esp_err_t capture_handler(httpd_req_t *req) {
  taskYIELD();   // ⚡ yield sebelum ambil frame

  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAPTURE] Frame fail");
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);

  Serial.printf("[CAPTURE] OK %u bytes\n", (unsigned int)fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// ==========================================
// 11. HANDLER: ROOT
// ==========================================
static esp_err_t root_handler(httpd_req_t *req) {
  char html[700];
  snprintf(html, sizeof(html),
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Smart Trap AI</title></head>"
    "<body style='font-family:Arial;background:#111;color:#0f0;padding:20px'>"
    "<h1>Smart Trap AI</h1>"
    "<p>Host: <b>%s.local</b></p>"
    "<p>IP: <b>%s</b></p>"
    "<p>SSID: %s | RSSI: %d dBm</p>"
    "<p>Suhu: %.1f C | Hum: %.1f %%</p>"
    "<p>Flash: %s</p>"
    "<hr>"
    "<p><a href='/stream' style='color:#0f0'>Live Stream</a></p>"
    "<p><a href='/telemetry' style='color:#0f0'>Telemetry</a></p>"
    "<p><a href='/capture' style='color:#0f0'>Capture</a></p>"
    "<hr>"
    "<img src='/stream' style='width:100%%;max-width:480px;border:2px solid #0f0'>"
    "</body></html>",
    MDNS_HOSTNAME,
    WiFi.localIP().toString().c_str(),
    WiFi.SSID().c_str(),
    WiFi.RSSI(),
    cachedTemp, cachedHum,
    flashState ? "ON" : "OFF");

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, strlen(html));
}

// ==========================================
// 12. START HTTP SERVER
// ==========================================
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port   = 32769;
  config.max_uri_handlers = 8;
  config.lru_purge_enable = true;
  config.stack_size = 16384;

  // ⚡ MAX SOCKETS 7 — supaya stream + telemetry + capture bisa bareng
  config.max_open_sockets = 7;

  // ⚡ Timeout lebih longgar untuk koneksi bareng
  config.recv_wait_timeout = 5;
  config.send_wait_timeout = 5;

  httpd_uri_t root_uri      = { .uri = "/",          .method = HTTP_GET, .handler = root_handler,      .user_ctx = NULL };
  httpd_uri_t stream_uri    = { .uri = "/stream",    .method = HTTP_GET, .handler = stream_handler,    .user_ctx = NULL };
  httpd_uri_t capture_uri   = { .uri = "/capture",   .method = HTTP_GET, .handler = capture_handler,   .user_ctx = NULL };
  httpd_uri_t telemetry_uri = { .uri = "/telemetry", .method = HTTP_GET, .handler = telemetry_handler, .user_ctx = NULL };
  httpd_uri_t flash_uri     = { .uri = "/flash",     .method = HTTP_GET, .handler = flash_handler,     .user_ctx = NULL };

  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &root_uri);
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &capture_uri);
    httpd_register_uri_handler(stream_httpd, &telemetry_uri);
    httpd_register_uri_handler(stream_httpd, &flash_uri);
    Serial.println("[HTTP] Server aktif di port 81");
  }
}

// ==========================================
// 13. SETUP WIFI + mDNS
// ==========================================
void setupWiFi() {
  WiFiManager wifiManager;
  wifiManager.setDebugOutput(false);
  wifiManager.setConfigPortalTimeout(180);
  wifiManager.setConnectTimeout(20);
  WiFi.setHostname(MDNS_HOSTNAME);

  Serial.println("[WiFi] Connect...");
  bool connected = wifiManager.autoConnect(AP_SETUP_SSID, AP_SETUP_PASS);
  if (!connected) {
    Serial.println("[WiFi] Gagal. Restart...");
    delay(3000);
    ESP.restart();
  }

  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT20);

  Serial.printf("[WiFi] OK: %s | IP: %s | RSSI: %d\n",
                WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str(),
                WiFi.RSSI());

  if (MDNS.begin(MDNS_HOSTNAME)) {
    MDNS.addService("http", "tcp", 81);
    Serial.printf("[mDNS] http://%s.local:81/\n", MDNS_HOSTNAME);
  }
}

// ==========================================
// 14. SETUP
// ==========================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Smart Trap AI - ANTI-BLOCKING ===");

  setupFlashLed();

  // DHT init + first read
  dht.begin();
  delay(2000);
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    cachedTemp = t;
    cachedHum  = h;
    dhtOk = true;
    Serial.printf("[DHT] OK — init: %.1f C, %.1f %%\n", t, h);
  } else {
    dhtOk = false;
    Serial.println("[DHT] Tidak ada sensor");
  }

  // ==========================================
  // KAMERA — QVGA ringan
  // ==========================================
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_QVGA;
    config.jpeg_quality = 20;
    config.fb_count     = 2;                   // 2 buffer — stream lebih smooth
    config.fb_location  = CAMERA_FB_IN_PSRAM;
    config.grab_mode    = CAMERA_GRAB_LATEST;
    Serial.println("[CAM] QVGA 320x240, quality 20, 2 fb");
  } else {
    config.frame_size   = FRAMESIZE_QVGA;
    config.jpeg_quality = 22;
    config.fb_count     = 1;
    config.fb_location  = CAMERA_FB_IN_DRAM;
    config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
    Serial.println("[CAM] QVGA (tanpa PSRAM)");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init gagal: 0x%x\n", err);
    return;
  }
  Serial.println("[CAM] OK");

  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 2);
    s->set_exposure_ctrl(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_gainceiling(s, (gainceiling_t)2);
    s->set_bpc(s, 1);
    s->set_wpc(s, 1);
    s->set_lenc(s, 1);
  }

  setupWiFi();
  startCameraServer();

  Serial.println("==================================================");
  Serial.println(" SIAP! http://smarttrap.local:81/");
  Serial.printf (" Atau : http://%s:81/\n", WiFi.localIP().toString().c_str());
  Serial.println(" Stream: 5 FPS (200ms) — telemetry & capture lancar");
  Serial.println("==================================================\n");
}

// ==========================================
// 15. LOOP
// ==========================================
unsigned long lastWiFiCheck = 0;
unsigned long lastLog       = 0;

void loop() {
  // ⚡ Baca DHT di sini (bukan di HTTP handler)
  // → update cache tiap 5 detik, stream tetap jalan
  updateDhtCache();

  // Cek WiFi tiap 15 detik
  if (millis() - lastWiFiCheck > 15000) {
    lastWiFiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Reconnect...");
      WiFi.reconnect();
      unsigned long t = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) {
        delay(500);
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] OK: %s\n", WiFi.localIP().toString().c_str());
        MDNS.end();
        if (MDNS.begin(MDNS_HOSTNAME)) {
          MDNS.addService("http", "tcp", 81);
        }
      }
    }
  }

  // Log status tiap 15 detik
  if (millis() - lastLog > 15000) {
    lastLog = millis();
    Serial.printf("[STATUS] T=%.1fC H=%.1f%% | RSSI=%d | Heap=%d\n",
                  cachedTemp, cachedHum, WiFi.RSSI(), ESP.getFreeHeap());
  }

  delay(100);
}