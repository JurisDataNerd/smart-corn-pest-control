# Smart Trap Tanaman Jagung Pakan

Sistem Kecerdasan Buatan (AI) dan *Computer Vision* (YOLO) *End-to-End* untuk deteksi dini, pemantauan otomatis, dan rekomendasi Pengendalian Hama Terpadu (PHT / IPM) pada komoditas tanaman jagung pakan serta hama pengerat kebun.

---

## 🌽 Sasaran Hama Jagung Pakan & Hama Pengerat

Sistem ini dilatih secara terpadu menggunakan **8.300+ citra lapangan** untuk mengenali 4 hama perusak utama:

| Nama Hama (Indonesia) | Label Model / Dataset | Nama Ilmiah | Gejala & Bagian Tanaman yang Diserang |
| :--- | :--- | :--- | :--- |
| **Penggerek Batang Jagung** | `Asian-Corn-Borer` | *Ostrinia furnacalis* | Menggerek dan melubangi bagian dalam batang serta pangkal tongkol jagung. |
| **Ulat Tongkol Jagung** | `Bollworm` | *Helicoverpa armigera / zea* | Memakan rambut jagung dan merusak bulir biji jagung muda di dalam tongkol. |
| **Ulat Grayak Jagung** | `Fall-Armyworm` | *Spodoptera frugiperda* | Merusak daun pupus (*whorl*) dan pucuk jagung hingga berlubang besar. |
| **Hama Tikus Ladang / Sawah** | `Rat` | *Rattus spp.* | Merusak dan mengerat tongkol jagung matang, memotong pangkal batang, dan membuat lubang sarang di pematang kebun. |

---

## 🏗️ Arsitektur Sistem

```mermaid
flowchart TD
    subgraph Input["Input Citra / Video Lahan"]
        A1["Foto Lapangan (Kamera HP / Upload File)"]
        A2["Kamera Pantau Langsung (Live Stream)"]
    end

    subgraph Engine["Mesin AI & Backend (FastAPI + YOLO)"]
        B1["Praperlakuan Citra & Normalisasi Ukuran"]
        B2["Deteksi Objek YOLO (Bounding Box & Skor Akurasi)"]
        B3["Mesin Rekomendasi PHT / Ambang Batas Ekonomi"]
        B4["Database SQLite (Penyimpanan Riwayat Pemeriksaan)"]
    end

    subgraph Dashboard["Antarmuka Pengguna (Frontend React)"]
        C1["Tampilan Foto dengan Kotak Penanda Hama"]
        C2["Status Bahaya: Aman, Waspada, atau Bahaya Tinggi"]
        C3["Panduan Langkah Pengendalian untuk Petani"]
        C4["Ringkasan & Riwayat Persebaran Hama di Lahan"]
    end

    A1 & A2 --> B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B3 --> C1 & C2 & C3 & C4
```

---

## ✨ Fitur Utama

1. **Upload Foto Tanaman Jagung & Hama**:
   - Petani dapat mengunggah foto tongkol, batang, daun jagung, atau tikus langsung dari galeri HP atau komputer.
   - Pilihan melihat **Foto dengan Tanda Hama** atau **Foto Asli**.

2. **Kamera Pantau Langsung (Live Camera)**:
   - Menggunakan kamera ponsel atau *webcam* untuk memindai tanaman jagung dan hama secara *real-time*.
   - Menampilkan kotak penanda hama langsung di atas aliran video.
   - Tombol **"Simpan Catatan Foto Ini"** untuk menyimpan riwayat temuan ke sistem.

3. **Panduan Tindakan Pengendalian Ramah Petani (IPM)**:
   - Memberikan status yang jelas:
     - 🟢 **KONDISI AMAN**: Populasi hama nihil atau di bawah ambang batas ekonomi.
     - 🟡 **WASPADA**: Populasi hama mulai muncul, disarankan pelepasan musuh alami (*Trichogramma* / burung hantu), atau pembersihan pematang.
     - 🔴 **BAHAYA TINGGI**: Ambang kerusakan terlampaui, rekomendasi penyemprotan terarah (*Bacillus thuringiensis*) atau perangkap bubu TBS.

4. **Riwayat & Statistik Lahan**:
   - Menghitung total hama yang terpantau pada setiap titik lahan.
   - Grafik persentase persebaran jenis hama perusak jagung.

---

## 🚀 Panduan Memulai Cepat

### 1. Menjalankan Sekaligus (Bun Monorepo / Script)
Gunakan **Bun** dari root directory untuk menjalankan Backend & Frontend secara paralel:
```bash
bun dev
# atau
bun start
# atau
./start.sh
```

- **Dashboard Web Petani**: [http://localhost:5173](http://localhost:5173)
- **Dokumentasi API Backend (FastAPI Swagger)**: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)

---

### 2. Menjalankan Layanan Secara Terpisah

#### Menjalankan Server Backend (FastAPI):
```bash
./run_backend.sh
```

#### Menjalankan Dashboard Frontend (React + Vite):
```bash
./run_frontend.sh
```

#### Menjalankan Pengujian Integrasi Otomatis:
```bash
PYTHONPATH=. backend/venv/bin/python backend/tests/test_backend.py
```

---

## 🧠 Melatih Ulang Model YOLO

Jika Anda menambahkan gambar atau dataset baru:
```bash
PYTHONPATH=. backend/venv/bin/python backend/train_yolo.py
```
Bobot model terbaik akan otomatis disimpan ke dalam `backend/weights/corn_pest_yolo.pt`.
