/*
 * ============================================================
 *  FIRMWARE ESP32-CAM + DHT22 - Smart Trap Lahan Jagung
 *  Board: AI Thinker ESP32-CAM
 *  ESP32 Core: 2.0.17 (WAJIB!)
 * ============================================================
 *  
 *  FITUR:
 *  - Hotspot mandiri: SSID "SmartTrap-CAM", pass "12345678"
 *  - IP ESP32 SELALU 192.168.4.1
 *  - Live stream MJPEG : http://192.168.4.1:81/stream
 *  - Telemetry DHT22   : http://192.168.4.1:81/telemetry
 *  - LED flash BAWAAN (GPIO 4) NYALA TERUS untuk pencahayaan
 *  - Kontrol flash via : http://192.168.4.1:81/flash?state=on/off
 *  - Info page         : http://192.168.4.1:81/
 * ============================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"
#include "DHT.h"

// ==========================================
// 1. KONFIGURASI HOTSPOT ESP32
// ==========================================
const char* AP_SSID     = "SmartTrap-CAM";
const char* AP_PASSWORD = "12345678";
const int   AP_CHANNEL  = 1;
const int   AP_MAX_CONN = 4;

// ==========================================
// 2. KONFIGURASI LED FLASH BAWAAN
// ==========================================
#define FLASH_LED_PIN       4       // LED flash built-in AI-Thinker
#define FLASH_ALWAYS_ON     true    // true = nyala terus untuk pencahayaan
#define FLASH_STARTUP_BLINK 2       // Kedip singkat tanda boot

// ==========================================
// 3. KONFIGURASI SENSOR DHT22
// ==========================================
#define DHTPIN  13
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// ==========================================
// 4. PIN AI-THINKER ESP32-CAM (ANGKA LANGSUNG)
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
// 5. FUNGSI: SETUP LED FLASH PENCAHAYAAN
// ==========================================
void setupFlashLed() {
  pinMode(FLASH_LED_PIN, OUTPUT);

  // Blink singkat tanda boot
  if (FLASH_STARTUP_BLINK > 0) {
    for (int i = 0; i < FLASH_STARTUP_BLINK; i++) {
      digitalWrite(FLASH_LED_PIN, HIGH); delay(100);
      digitalWrite(FLASH_LED_PIN, LOW);  delay(100);
    }
  }

  // Mode pencahayaan: nyala terus
  if (FLASH_ALWAYS_ON) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    Serial.println("[LED] Flash bawaan ON TERUS (pencahayaan kamera)");
    Serial.println("[LED] Konsumsi arus ekstra: ~200mA");
  } else {
    digitalWrite(FLASH_LED_PIN, LOW);
    Serial.println("[LED] Flash OFF");
  }
}

// ==========================================
// 6. HANDLER: STREAM KAMERA MJPEG (OPTIMIZED SMOOTH & LOW LATENCY)
// ==========================================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char * part_buf[64];

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM] Gagal ambil frame");
      res = ESP_FAIL;
    } else {
      _jpg_buf_len = fb->len;
      _jpg_buf = fb->buf;
    }

    if (res == ESP_OK) {
      size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }
    if (fb) {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    } else if (_jpg_buf) {
      free(_jpg_buf);
      _jpg_buf = NULL;
    }
    if (res != ESP_OK) break;

    // Pacing throttle: Beri jeda 12-15ms agar WiFi LwIP stack sempat flush packet
    // Mencegah TCP buffer overflow dan menghilangkan lag akumulatif/patah-patah!
    vTaskDelay(pdMS_TO_TICKS(15));
  }
  return res;
}

// ==========================================
// 7. HANDLER: TELEMETRY DHT22 (CACHED, NON-BLOCKING)
// ==========================================
static unsigned long lastDhtReadTime = 0;
static float cachedTemperature = 28.5;
static float cachedHumidity = 70.0;

static esp_err_t telemetry_handler(httpd_req_t *req) {
  // Hanya baca sensor fisik tiap 2.5 detik agar CPU tidak tersendat saat streaming kamera
  if (millis() - lastDhtReadTime > 2500 || lastDhtReadTime == 0) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t)) {
      cachedTemperature = t;
      cachedHumidity = h;
    }
    lastDhtReadTime = millis();
  }

  char json[200];
  snprintf(json, sizeof(json),
    "{\"temperature\":%.1f,\"humidity\":%.1f,\"trap_id\":\"LAHAN-01\","
    "\"status\":\"active\",\"flash\":\"%s\",\"clients\":%d}",
    cachedTemperature, cachedHumidity,
    digitalRead(FLASH_LED_PIN) ? "on" : "off",
    WiFi.softAPgetStationNum());

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json, strlen(json));
}

// ==========================================
// 8. HANDLER: KONTROL LED FLASH
// ==========================================
static esp_err_t flash_handler(httpd_req_t *req) {
  char state[8] = "";

  size_t len = httpd_req_get_url_query_len(req) + 1;
  if (len > 1) {
    char query[64];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
      httpd_query_key_value(query, "state", state, sizeof(state));
      if (strcmp(state, "on") == 0) {
        digitalWrite(FLASH_LED_PIN, HIGH);
        Serial.println("[LED] Flash ON (via HTTP)");
      } else if (strcmp(state, "off") == 0) {
        digitalWrite(FLASH_LED_PIN, LOW);
        Serial.println("[LED] Flash OFF (via HTTP)");
      }
    }
  }

  char resp[48];
  snprintf(resp, sizeof(resp),
    "{\"flash\":\"%s\"}",
    digitalRead(FLASH_LED_PIN) ? "on" : "off");

  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, resp, strlen(resp));
}

// ==========================================
// 9. HANDLER: ROOT INFO PAGE
// ==========================================
static esp_err_t root_handler(httpd_req_t *req) {
  char html[700];
  snprintf(html, sizeof(html),
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Smart Trap AI</title></head>"
    "<body style='font-family:Arial;background:#111;color:#0f0;padding:20px'>"
    "<h1>Smart Trap AI - Syngenta</h1>"
    "<p><b>Status:</b> ONLINE (Hotspot Mode)</p>"
    "<p><b>IP:</b> %s</p>"
    "<p><b>SSID:</b> %s</p>"
    "<p><b>Client Connect:</b> %d</p>"
    "<p><b>Flash LED:</b> %s</p>"
    "<hr>"
    "<p>Live Stream: <a href='/stream' style='color:#0f0'>/stream</a></p>"
    "<p>Telemetry  : <a href='/telemetry' style='color:#0f0'>/telemetry</a></p>"
    "<p>Flash ON   : <a href='/flash?state=on' style='color:#0f0'>/flash?state=on</a></p>"
    "<p>Flash OFF  : <a href='/flash?state=off' style='color:#0f0'>/flash?state=off</a></p>"
    "</body></html>",
    WiFi.softAPIP().toString().c_str(),
    AP_SSID,
    WiFi.softAPgetStationNum(),
    digitalRead(FLASH_LED_PIN) ? "ON" : "OFF");

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, strlen(html));
}

// ==========================================
// 10. START HTTP SERVER
// ==========================================
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port   = 32769;
  config.max_uri_handlers = 8;

  httpd_uri_t root_uri = {
    .uri = "/", .method = HTTP_GET,
    .handler = root_handler, .user_ctx = NULL
  };
  httpd_uri_t stream_uri = {
    .uri = "/stream", .method = HTTP_GET,
    .handler = stream_handler, .user_ctx = NULL
  };
  httpd_uri_t telemetry_uri = {
    .uri = "/telemetry", .method = HTTP_GET,
    .handler = telemetry_handler, .user_ctx = NULL
  };
  httpd_uri_t flash_uri = {
    .uri = "/flash", .method = HTTP_GET,
    .handler = flash_handler, .user_ctx = NULL
  };

  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &root_uri);
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &telemetry_uri);
    httpd_register_uri_handler(stream_httpd, &flash_uri);
    Serial.println("[HTTP] Server aktif di port 81");
  }
}

// ==========================================
// 11. SETUP HOTSPOT MANDIRI
// ==========================================
void setupHotspot() {
  WiFi.mode(WIFI_AP);

  IPAddress local_ip(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.softAPConfig(local_ip, gateway, subnet);

  bool ok = WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, false, AP_MAX_CONN);

  if (ok) {
    Serial.println("\n==================================================");
    Serial.println(" HOTSPOT ESP32 AKTIF!");
    Serial.println("==================================================");
    Serial.printf (" SSID     : %s\n", AP_SSID);
    Serial.printf (" Password : %s\n", AP_PASSWORD);
    Serial.printf (" IP ESP32 : %s\n", WiFi.softAPIP().toString().c_str());
    Serial.println("--------------------------------------------------");
    Serial.println(" 1. Connect HP/Laptop ke WiFi di atas");
    Serial.println(" 2. Buka: http://192.168.4.1:81/");
    Serial.println(" 3. Stream:  http://192.168.4.1:81/stream");
    Serial.println(" 4. Telemetry: http://192.168.4.1:81/telemetry");
    Serial.println("==================================================\n");

    if (MDNS.begin("smarttrap")) {
      MDNS.addService("http", "tcp", 81);
      Serial.println("[mDNS] http://smarttrap.local:81/stream");
    }
  } else {
    Serial.println("[WiFi] Gagal start hotspot!");
  }
}

// ==========================================
// 12. SETUP UTAMA
// ==========================================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.setDebugOutput(false);
  Serial.println("\n==================================================");
  Serial.println("  Smart Trap AI - ESP32-CAM + DHT22");
  Serial.println("  Mode: HOTSPOT + LED Flash ON");
  Serial.println("==================================================");

  // (1) Nyalakan LED flash bawaan untuk pencahayaan
  setupFlashLed();

  // (2) Init DHT22
  dht.begin();
  delay(2000);

  // (3) Init Kamera
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
    config.frame_size   = FRAMESIZE_VGA;    // 640x480 (Smooth & rendah latensi untuk streaming WiFi)
    config.jpeg_quality = 12;               // Kualitas seimbang (ukuran ~20-25 KB per frame)
    config.fb_count     = 2;
    Serial.println("[CAM] PSRAM terdeteksi - mode VGA 640x480 (Smooth)");
  } else {
    config.frame_size   = FRAMESIZE_VGA;    // 640x480
    config.jpeg_quality = 15;
    config.fb_count     = 1;
    Serial.println("[CAM] Tanpa PSRAM - mode VGA 640x480");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init gagal: 0x%x\n", err);
    return;   // LED tetap ON
  }
  Serial.println("[CAM] Inisialisasi berhasil");

  // Setting sensor agar optimal dengan LED ON
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 2);         // 2=Cloudy, cocok untuk LED putih
    s->set_exposure_ctrl(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_gainceiling(s, (gainceiling_t)2);
    s->set_bpc(s, 1);
    s->set_wpc(s, 1);
    s->set_lenc(s, 1);
  }

  // (4) Setup Hotspot
  setupHotspot();

  // (5) Start HTTP Server
  startCameraServer();

  Serial.println("\n==================================================");
  Serial.println(" SISTEM SIAP DIPAKAI!");
  Serial.println(" LED Flash : ON TERUS (pencahayaan)");
  Serial.println(" Hotspot   : SmartTrap-CAM");
  Serial.println(" Stream    : http://192.168.4.1:81/stream");
  Serial.println(" Telemetry : http://192.168.4.1:81/telemetry");
  Serial.println("==================================================\n");
}

// ==========================================
// 13. LOOP
// ==========================================
unsigned long lastStatus = 0;

void loop() {
  if (millis() - lastStatus > 10000) {
    lastStatus = millis();
    Serial.printf("[STATUS] Clients: %d | IP: %s | Flash: %s | FreeHeap: %d\n",
                  WiFi.softAPgetStationNum(),
                  WiFi.softAPIP().toString().c_str(),
                  digitalRead(FLASH_LED_PIN) ? "ON" : "OFF",
                  ESP.getFreeHeap());
  }
  delay(1000);
}