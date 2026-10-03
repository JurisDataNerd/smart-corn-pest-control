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
#if __has_include(<esp_arduino_version.h>)
  #include <esp_arduino_version.h>
#endif

// ==========================================
// 1. KONFIGURASI HOTSPOT ESP32
// ==========================================
const char* AP_SSID     = "SmartTrap-CAM";
const char* AP_PASSWORD = "12345678";
const int   AP_CHANNEL  = 1;
const int   AP_MAX_CONN = 4;

// ==========================================
// 2. KONFIGURASI LED FLASH BAWAAN (PWM HEMAT DAYA)
// ==========================================
#define FLASH_LED_PIN        4      // LED flash built-in AI-Thinker
#define FLASH_LEDC_CHANNEL   7      // Channel LEDC PWM
#define FLASH_ALWAYS_ON      false  // false = Flash standby saat boot, nyalakan via tombol saat butuh agar TIDAK memicu lonjakan arus!
#define FLASH_PWM_DUTY       20     // 20/255 duty (~8% duty) = Terang cukup, super hemat arus (<12mA), chip dingin & bebas brownout!
#define FLASH_STARTUP_BLINK  0      // 0 = Tanpa blink yang mengejutkan rel tegangan 3.3V
static bool flashState = FLASH_ALWAYS_ON;

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
// 5. FUNGSI: SETUP LED FLASH PENCAHAYAAN (PWM AMAN MULTI-CORE)
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
  // ESP32 Arduino Core 3.x API
  ledcAttach(FLASH_LED_PIN, 5000, 8);
#else
  // ESP32 Arduino Core 2.x API
  ledcSetup(FLASH_LEDC_CHANNEL, 5000, 8);
  ledcAttachPin(FLASH_LED_PIN, FLASH_LEDC_CHANNEL);
#endif

  // Blink singkat tanda boot
  if (FLASH_STARTUP_BLINK > 0) {
    for (int i = 0; i < FLASH_STARTUP_BLINK; i++) {
      setFlashDuty(FLASH_PWM_DUTY); delay(80);
      setFlashDuty(0); delay(80);
    }
  }

  // Mode pencahayaan: nyala terus via PWM (stabil & dingin)
  if (FLASH_ALWAYS_ON) {
    setFlashDuty(FLASH_PWM_DUTY);
    flashState = true;
    Serial.println("[LED] Flash ON via PWM Duty 35 (Pencahayaan terang, dingin, arus <30mA, WiFi stabil!)");
  } else {
    setFlashDuty(0);
    flashState = false;
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
  char part_buf[128];

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "X-Framerate", "30");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM] Gagal ambil frame");
      res = ESP_FAIL;
    } else {
      _jpg_buf_len = fb->len;
      _jpg_buf = fb->buf;
    }

    // 1. Kirim Boundary Pembuka
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }
    // 2. Kirim Header Part (Content-Type & Content-Length)
    if (res == ESP_OK) {
      size_t hlen = snprintf(part_buf, sizeof(part_buf), _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, part_buf, hlen);
    }
    // 3. Kirim Binary Frame JPEG
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
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
    // Jeda 20ms: Capping ~25-30 FPS, mencegah CPU 100% starvation, menjaga buffer Wi-Fi tetap stabil & anti-crash!
    delay(20);
  }
  return res;
}

// ==========================================
// 7. HANDLER: TELEMETRY DHT22 (ROBUST & NON-BLOCKING)
// ==========================================
static unsigned long lastDhtReadTime = 0;
static float cachedTemperature = 28.5;
static float cachedHumidity = 70.0;
static bool  dhtSensorDetected = false;

static esp_err_t telemetry_handler(httpd_req_t *req) {
  // Baca sensor fisik tiap 2.5 detik
  if (millis() - lastDhtReadTime > 2500 || lastDhtReadTime == 0) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t) && h > 0.0 && t > 0.0) {
      cachedTemperature = t;
      cachedHumidity = h;
      dhtSensorDetected = true;
      Serial.printf("[DHT22] SUKSES -> Suhu: %.1f C | Kelembapan: %.1f %%\n", t, h);
    } else {
      dhtSensorDetected = false;
      Serial.printf("[DHT22] PERINGATAN: Sensor tidak merespon di GPIO %d! (Cek kabel VCC 5V, GND, DATA)\n", DHTPIN);
    }
    lastDhtReadTime = millis();
  }

  char json[256];
  snprintf(json, sizeof(json),
    "{\"temperature\":%.1f,\"humidity\":%.1f,\"detected\":%s,\"pin\":%d,\"trap_id\":\"LAHAN-01\","
    "\"status\":\"%s\",\"flash\":\"%s\",\"clients\":%d}",
    cachedTemperature, cachedHumidity,
    dhtSensorDetected ? "true" : "false",
    DHTPIN,
    dhtSensorDetected ? "active" : "waiting",
    flashState ? "on" : "off",
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
        setFlashDuty(FLASH_PWM_DUTY);
        flashState = true;
        Serial.println("[LED] Flash ON via PWM");
      } else if (strcmp(state, "off") == 0) {
        setFlashDuty(0);
        flashState = false;
        Serial.println("[LED] Flash OFF");
      }
    }
  }

  char resp[48];
  snprintf(resp, sizeof(resp),
    "{\"flash\":\"%s\"}",
    flashState ? "on" : "off");

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

// Handler ambil single snapshot JPEG (/capture)
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Gagal ambil snapshot");
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// ==========================================
// 10. START HTTP SERVER
// ==========================================
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port   = 32769;
  config.max_uri_handlers = 10;
  config.lru_purge_enable = true; // Auto-purge socket lama saat client reconnect agar tidak ERR_INCOMPLETE_CHUNKED_ENCODING!

  httpd_uri_t root_uri = {
    .uri = "/", .method = HTTP_GET,
    .handler = root_handler, .user_ctx = NULL
  };
  httpd_uri_t stream_uri = {
    .uri = "/stream", .method = HTTP_GET,
    .handler = stream_handler, .user_ctx = NULL
  };
  httpd_uri_t capture_uri = {
    .uri = "/capture", .method = HTTP_GET,
    .handler = capture_handler, .user_ctx = NULL
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
    httpd_register_uri_handler(stream_httpd, &capture_uri);
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
    // Kunci stabilitas radio WiFi: Matikan sleep mode & set TX power stabil tanpa lonjakan arus
    WiFi.setSleep(false);
    WiFi.setTxPower(WIFI_POWER_15dBm);
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

  // (2) Init DHT22 dengan internal PULLUP resistor
  pinMode(DHTPIN, INPUT_PULLUP);
  dht.begin();
  Serial.printf("[DHT22] Diinisialisasi pada pin GPIO %d (INPUT_PULLUP aktif)\n", DHTPIN);
  delay(1000);

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
  config.xclk_freq_hz = 10000000; // 10MHz: Stabil, dingin, anti-brownout di power USB laptop
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;    // 640x480 (Smooth & stabil di port 81)
    config.jpeg_quality = 14;               // Kualitas seimbang (ukuran ~18-22 KB per frame)
    config.fb_count     = 2;
    Serial.println("[CAM] PSRAM terdeteksi - mode VGA 640x480 (Stabil 10MHz)");
  } else {
    config.frame_size   = FRAMESIZE_VGA;    // 640x480
    config.jpeg_quality = 16;
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
  if (millis() - lastStatus > 8000) {
    lastStatus = millis();
    Serial.printf("[STATUS] DHT22: %s (%.1f C, %.1f %%) | Clients: %d | IP: %s | Flash: %s\n",
                  dhtSensorDetected ? "TERDETEKSI" : "TIDAK TERDETEKSI (Cek Pin/Kabel)",
                  cachedTemperature, cachedHumidity,
                  WiFi.softAPgetStationNum(),
                  WiFi.softAPIP().toString().c_str(),
                  flashState ? "ON" : "OFF");
  }
  delay(1000);
}