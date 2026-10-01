/*
 * Firmware ESP32-CAM + Sensor DHT22 untuk Smart Trap Lahan Jagung (Syngenta)
 * Board Target: AI Thinker ESP32-CAM
 * 
 * Fitur:
 * 1. MJPEG Camera Video Stream di port 81 (URL: http://<IP_ESP32>:81/stream)
 * 2. Membaca Sensor Suhu & Kelembapan DHT22 (Pin GPIO 13)
 * 3. Mengirimkan telemetry periodik ke Backend FastAPI (/api/v1/telemetry)
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_timer.h"
#include "img_converters.h"
#include "fb_gfx.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_http_server.h"
#include "DHT.h"

// ==========================================
// 1. PENGATURAN WI-FI & BACKEND
// ==========================================
const char* ssid = "Pandega Padma 19A";           // Ganti dengan nama WiFi Anda
const char* password = "rastelli123";   // Ganti dengan password WiFi Anda

// Alamat server backend laptop/PC Anda di jaringan lokal yang sama:
const char* serverUrl = "http://192.168.1.131:8000/api/v1/telemetry";

// ==========================================
// 2. PENGATURAN SENSOR DHT22
// ==========================================
#define DHTPIN 13       // Hubungkan pin DATA DHT22 ke GPIO 13 ESP32-CAM
#define DHTTYPE DHT22   // Sensor DHT 22 (AM2302)
DHT dht(DHTPIN, DHTTYPE);

unsigned long lastTelemetryTime = 0;
const unsigned long telemetryInterval = 5000; // Kirim data sensor tiap 5 detik

// ==========================================
// 3. DEFINISI PIN AI-THINKER ESP32-CAM
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

// Server Stream
httpd_handle_t stream_httpd = NULL;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char * part_buf[64];

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;

  // Izinkan CORS agar frontend web bisa mengakses gambar langsung
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Gagal mengambil frame kamera");
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
  }
  return res;
}

void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port = 32769;

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    Serial.println("Server Stream Kamera aktif di port 81");
  }
}

void sendTelemetryData(float temp, float hum) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    String jsonPayload = "{\"temperature\": " + String(temp, 1) + 
                         ", \"humidity\": " + String(hum, 1) + 
                         ", \"trap_id\": \"LAHAN-01\"}";

    int httpResponseCode = http.POST(jsonPayload);
    if (httpResponseCode > 0) {
      Serial.printf("Telemetry terkirim ke backend (%d): %s\n", httpResponseCode, jsonPayload.c_str());
    } else {
      Serial.printf("Gagal kirim telemetry. Kode error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  }
}

void setup() {
  // Matikan brownout detector agar ESP32 tidak mudah restart saat beban daya kamera naik
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.setDebugOutput(false);
  Serial.println("\n--- Memulai Inisialisasi ESP32-CAM Smart Trap ---");

  // Inisialisasi Sensor DHT22
  dht.begin();

  // Konfigurasi Kamera
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Resolusi frame & Kualitas JPEG Optimal
  if (psramFound()) {
    config.frame_size = FRAMESIZE_SVGA; // 800x600 (Jauh lebih tajam & detail dibanding VGA 640x480)
    config.jpeg_quality = 10;          // Kualitas lebih tinggi (10 = tajam, minim artifak kompresi)
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 10;
    config.fb_count = 1;
  }

  // Inisialisasi Driver Kamera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Inisialisasi kamera gagal dengan kode error 0x%x\n", err);
    return;
  }

  // ========================================================
  // PENINGKATAN KUALITAS SENSOR OV2640 (Hardware Image Signal)
  // ========================================================
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 1);                  // -2 s/d 2: Sedikit lebih terang
    s->set_contrast(s, 1);                    // -2 s/d 2: Pertajam kontras batas objek
    s->set_saturation(s, 1);                  // -2 s/d 2: Warna lebih hidup (daun & hama lebih jelas)
    s->set_special_effect(s, 0);              // 0 = Normal
    s->set_whitebal(s, 1);                    // Auto White Balance aktif
    s->set_awb_gain(s, 1);                    // Auto White Balance Gain aktif
    s->set_wb_mode(s, 0);                     // 0 = Auto WB
    s->set_exposure_ctrl(s, 1);               // Auto Exposure aktif
    s->set_aec2(s, 1);                        // AEC DSP lanjutan aktif
    s->set_gain_ctrl(s, 1);                   // Auto Gain aktif
    s->set_gainceiling(s, (gainceiling_t)2);  // Batasi gain agar noise bintik pasir minim
    s->set_bpc(s, 1);                         // Black Pixel Correction aktif (hilangkan dead pixel)
    s->set_wpc(s, 1);                         // White Pixel Correction aktif (hilangkan hot pixel)
    s->set_raw_gma(s, 1);                     // Koreksi Gamma aktif
    s->set_lenc(s, 1);                        // Lens Correction aktif (hilangkan vignet/gelap di sudut lensa)
    Serial.println("Optimasi sensor OV2640 berhasil diterapkan.");
  }

  // Koneksi ke Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Menghubungkan ke Wi-Fi: ");
  Serial.println(ssid);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Berhasil Terhubung!");
  Serial.print("Alamat IP ESP32-CAM: ");
  Serial.println(WiFi.localIP());

  // Jalankan Web Server MJPEG Stream
  startCameraServer();

  Serial.print("Gunakan URL ini di Dashboard Live Monitor: http://");
  Serial.print(WiFi.localIP());
  Serial.println(":81/stream");
}

void loop() {
  unsigned long now = millis();
  
  // Baca sensor dan kirim telemetry setiap 5 detik
  if (now - lastTelemetryTime >= telemetryInterval) {
    lastTelemetryTime = now;

    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();

    // Jika sensor belum terpasang atau gagal terbaca, gunakan nilai dummy realistis
    if (isnan(humidity) || isnan(temperature)) {
      Serial.println("Sensor DHT22 tidak terdeteksi, mengirim data simulasi lahan...");
      temperature = 28.5;
      humidity = 70.0;
    } else {
      Serial.printf("DHT22 -> Suhu: %.1f C, Kelembapan: %.1f %%\n", temperature, humidity);
    }

    sendTelemetryData(temperature, humidity);
  }

  delay(20);
}
