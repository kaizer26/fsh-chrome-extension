# FASSEHH Chrome Extension

Ekstensi Google Chrome untuk mempermudah dan mengotomatisasi proses pada platform **FASSEHH-SM BPS (fasih-sm.bps.go.id)**.

## 🚀 Fitur Utama

1. **Scrape Data (Scraping)**
   - Mengambil data seluruh *assignment* secara massal berdasarkan Survey, Periode, Provinsi, dan Kabupaten.
   - Hasil *scrape* otomatis diunduh dalam format Excel (CSV).
2. **Automasi Approve, Reject, dan Revoke**
   - Melakukan aksi persetujuan (*Approve*), penolakan (*Reject*), atau penarikan (*Revoke*) pada banyak *assignment* sekaligus secara otomatis (dalam satu klik).
   - Menangani pop-up konfirmasi (dialog Radix UI) dan mengambil log notifikasi sukses/gagal dari sistem FASSEHH.
3. **Automasi Approve Anomali**
   - Mengotomatisasi alur kompleks untuk klik halaman catatan, menyalakan switch "Cek Anomali" dan "Anomali Admin", serta membaca anomali (usaha/keluarga) sebelum men-submit konfirmasi approval.
4. **Rekap Alokasi & Progress**
   - (Mendukung fungsi tambahan untuk merekap progress pengerjaan dari dashboard).

## 🛠 Instalasi

1. Download atau `git clone` repository ini:
   ```bash
   git clone https://github.com/kaizer26/fsh-chrome-extension.git
   ```
2. Buka Google Chrome dan masuk ke halaman ekstensi: `chrome://extensions/`
3. Aktifkan **Developer mode** (Mode Pengembang) di pojok kanan atas.
4. Klik tombol **Load unpacked** (Muat yang belum diekstrak).
5. Pilih folder tempat Anda menyimpan repository ini (pilih folder `fasih-extensions`).
6. Ekstensi FASSEHH siap digunakan! Pin ekstensi pada toolbar agar mudah diakses.

## 📖 Cara Penggunaan

### 1. Memulai (Inisialisasi)
1. Buka halaman aplikasi FASSEHH BPS: [https://fasih-sm.bps.go.id/app/](https://fasih-sm.bps.go.id/app/)
2. Pastikan Anda sudah **Login**.
3. Klik icon ekstensi FASSEHH di pojok kanan atas Chrome.
4. Akan muncul jendela ekstensi. Pada tab **Menu**, ikuti langkah berikut:
   - Pilih **Tipe Survey** (Pencacahan / Pelatihan / Uji Coba).
   - Pilih **Nama Survey**.
   - Pilih **Periode**.
   - Klik **Lanjutkan**.

### 2. Memilih Wilayah (Region)
1. Setelah klik Lanjutkan, Anda akan diminta memilih **Provinsi** dan **Kabupaten**.
2. Pilih wilayah yang ingin Anda kerjakan.
3. Anda akan melihat daftar aksi (Tombol Scrape, Approve, Reject, Revoke, dll).

### 3. Menjalankan Automasi (Approve, Reject, Revoke)
Fitur Automasi akan menjalankan aksi pada puluhan/ratusan assignment sekaligus dengan cara membuka background tab dan melakukan klik otomatis satu per satu.

1. Setelah memilih Kabupaten, Anda akan melihat input area untuk **Assignment ID**.
2. Masukkan daftar ID Assignment yang ingin diproses (pisahkan dengan baris baru / Enter).
   - *Tips: Anda bisa meng-copy paste langsung dari kolom ID Excel hasil Scrape.*
3. Klik tombol aksi yang diinginkan (Misal: **Approve**).
4. Ekstensi akan memindahkan Anda ke tab **Automasi**. Di sini, Anda bisa melihat proses berjalan secara real-time.
   - Ekstensi akan membuka tab tersembunyi (background tab) untuk mengakses satu per satu assignment dan mengkliknya.
   - Progress akan terlihat (misal: `[1/6] de82f77c...`).
   - Apabila ada yang gagal (misal karena jaringan), ekstensi akan mencatatnya.
5. **Fitur Checkpoint / Resume:**
   - Jika proses terhenti di tengah jalan atau Anda menekan tombol "Hentikan", ekstensi menyimpan **Checkpoint** terakhir.
   - Jika Anda menekan **Approve** lagi, ekstensi akan bertanya: *"Lanjut dari checkpoint [3/6] atau mulai baru?"*.
   - Fitur ini sangat aman jika tiba-tiba internet putus.
6. **Lihat & Download Hasil:**
   - Setelah proses selesai (atau dihentikan), klik tombol **Lihat dan Download Hasil**.
   - Halaman hasil akan muncul berupa tabel yang menampilkan status (SUCCESS/ERROR), pesan notifikasi, dan rincian anomali dari tiap assignment ID.

### 4. Scraping Data (Unduh Data Assignment)
1. Pada halaman pemilihan wilayah (Provinsi/Kabupaten), klik tombol **Scrape (Unduh Data)**.
2. Ekstensi akan mengambil seluruh data assignment yang ada pada wilayah tersebut dengan mem-bypass pagination API FASSEHH.
3. Setelah selesai, file akan otomatis diunduh dalam bentuk `.csv` yang bisa langsung dibuka di Excel.

## ⚙️ Cara Kerja Teknis (Background & Content Script)

Ekstensi ini dirancang secara tangguh untuk menghindari batasan browser (seperti popup ekstensi yang tertutup):
- **Popup UI:** Terpisah dari tugas automasi berat. Menampilkan antarmuka yang user-friendly dan memantau state.
- **Background Worker (`background.js`):** Mengatur antrean (queue) dan status automasi. Background ini menggunakan `chrome.tabs.sendMessage` dengan sistem jeda waktu (*wait for SPA render*) untuk mengamankan komunikasi dengan tab.
- **Content Action (`content_actions.js`):** Script mandiri (terbungkus IIFE) yang mendeteksi ikon SVG dan elemen DOM FASSEHH, meng-klik secara simulasi (termasuk Pop-up konfirmasi dialog Radix UI), dan melaporkan hasilnya kembali.

## 🤝 Kontribusi
Jika Anda menemukan bug pada web FASSEHH yang berubah struktur UI-nya, harap periksa kembali fungsi XPath di `content_actions.js`.

---
*Dibuat untuk mempermudah pekerjaan pengelolaan survey FASSEHH secara aman, otomatis, dan efisien.*
