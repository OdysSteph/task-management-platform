# Setup & Deployment Guide — TaskHub Pro

Panduan lengkap untuk menginstal, mengonfigurasi, menjalankan, menguji, dan melakukan *deployment* pada proyek **TaskHub Pro (Task Management Platform)**.

## 1. Prasyarat Sistem (System Requirements)

Pastikan lingkungan pengembangan lokal atau server memiliki komponen berikut:
- **PHP**: Versi 8.2 ke atas (disarankan PHP 8.3 / 8.4 / 8.5)
- **Ekstensi PHP Wajib**:
  - `pdo_mysql` & `mysqli` (koneksi database utama MySQL)
  - `pdo_sqlite` & `sqlite3` (untuk menjalankan automated testing in-memory)
  - `sodium` (untuk enkripsi dan penandatanganan token JWT)
  - `gd` (untuk pembuatan thumbnail gambar otomatis)
  - `fileinfo` & `zip` (untuk validasi MIME type dan pengelolaan berkas)
- **Composer**: Versi 2.x
- **Database**: MySQL 8.0+ atau MariaDB 10.6+
- **Node.js & NPM**: Node.js v18+ dan NPM v9+

## 2. Instalasi & Konfigurasi Backend (`backend/`)

1. Masuk ke direktori `backend` dan instal seluruh dependensi PHP:
   ```powershell
   cd backend
   composer install
   ```

2. Salin file konfigurasi `.env` (jika belum ada) dan buat *application key*:
   ```powershell
   cp .env.example .env
   php artisan key:generate
   ```

3. Buat database baru di MySQL:
   ```sql
   CREATE DATABASE task_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

4. Sesuaikan variabel koneksi database dan antrean di dalam file `backend/.env`:
   ```env
   DB_CONNECTION=mysql
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_DATABASE=task_management
   DB_USERNAME=root
   DB_PASSWORD=

   QUEUE_CONNECTION=database
   MAIL_MAILER=log
   ```

5. Generate *secret key* untuk JWT Authentication:
   ```powershell
   php artisan jwt:secret
   ```

6. Jalankan migrasi tabel beserta *database seeder* (membuat 6 sampel user, 20 task, 15 komentar, dan 3 lampiran awal):
   ```powershell
   php artisan migrate:fresh --seed
   ```
   *(Alternatif: Anda juga dapat mengimpor file SQL langsung dari `backend/database/sql/seed_dump.sql`).*

7. Buat *symbolic link* penyimpanan publik dan jalankan server pengembangan Laravel:
   ```powershell
   php artisan storage:link
   php artisan serve
   ```
   Server REST API akan berjalan di `[http://127.0.0.1:8000](http://127.0.0.1:8000)`.

8. Jalankan *Queue Worker* pada terminal terpisah untuk memproses job asinkron:
   ```powershell
   php artisan queue:work
   ```

## 3. Instalasi & Konfigurasi Frontend (`frontend/`)

1. Buka terminal baru, masuk ke direktori `frontend`, dan instal seluruh paket NPM:
   ```powershell
   cd frontend
   npm install
   ```

2. Jalankan server pengembangan Vite:
   ```powershell
   npm run dev
   ```

3. Buka browser dan akses aplikasi di `http://localhost:5173`.

## 4. Akun Demo Pengujian (Hasil Seeder)

Gunakan salah satu kredensial berikut untuk masuk ke dalam aplikasi:
- **Admin**: `admin@example.com` | Password: `password123`
- **Manager**: `manager@example.com` | Password: `password123`
- **Member**: `member@example.com` | Password: `password123`

## 5. Menjalankan Automated Testing

Proyek ini dilengkapi *Unit Test* (`tests/Unit/FileUploadServiceTest.php`) dan *Feature/Integration Test* (`tests/Feature/TaskPlatformApiTest.php`). Jalankan perintah berikut dari dalam folder `backend`:

```powershell
php artisan test
```

## 6. Panduan Deployment ke Production (Deployment Guide)

1. **Backend (Laravel)**:
   - Gunakan web server **Nginx** atau **Apache** yang diarahkan ke direktori `backend/public`.
   - Atur `APP_ENV=production` dan `APP_DEBUG=false` pada file `.env`.
   - Optimalkan konfigurasi dan rute dengan perintah:
     ```bash
     php artisan config:cache
     php artisan route:cache
     php artisan view:cache
     ```
   - Gunakan **Supervisor** di Linux untuk menjaga proses `php artisan queue:work --tries=3` tetap berjalan secara otomatis di latar belakang.

2. **Frontend (React Vite)**:
   - Sesuaikan konstanta `API_BASE` di `frontend/src/App.jsx` ke URL domain API produksi Anda.
   - Bangun aset statis produksi dengan perintah:
     ```bash
     npm run build
     ```
   - Unggah isi folder `frontend/dist/` ke layanan hosting statis (Vercel, Netlify, Cloudflare Pages, atau Nginx).