# Architecture Decisions & Database Schema Documentation

Dokumen ini menjelaskan keputusan arsitektur perangkat lunak, pola desain (*design patterns*), mekanisme keamanan, serta rancangan skema database dan strategi *indexing* pada **TaskHub Pro**.

## 1. Keputusan Arsitektur (Architecture Decisions)

### 1.1 Decoupled Client-Server Architecture
Sistem dipisahkan secara tegas antara **Backend RESTful API (Laravel 13)** di direktori `backend/` dan **Frontend Single Page Application (React + Vite)** di direktori `frontend/`:
- **Alasan**: Memungkinkan pengembangan, pengujian, dan *scaling* independen antara lapisan API dan antarmuka pengguna, serta memudahkan integrasi dengan aplikasi *mobile* atau pihak ketiga di masa depan.

### 1.2 Stateless JWT Authentication
Autentikasi API diimplementasikan menggunakan **JSON Web Token (JWT)** melalui paket `php-open-source-saver/jwt-auth` pada guard `api`:
- **Alasan**: Tidak membebani penyimpanan sesi di sisi server (*stateless*), mendukung klaim kustom (`role` dan `name`), serta sangat cocok untuk komunikasi lintas domain (CORS) antara React SPA dan Laravel API.

### 1.3 Service Layer Pattern (`FileUploadService`)
Logika bisnis terkait pemrosesan berkas tidak diletakkan di dalam Controller, melainkan dipisahkan ke dalam class `App\Services\FileUploadService`:
- **Tanggung Jawab**:
  1. Validasi aturan MIME type dan batas ukuran per kategori (Gambar maks 10MB, Dokumen maks 25MB, Video maks 100MB).
  2. Pencegahan *double extension exploit* (misalnya `payload.php.jpg`).
  3. Simulasi pemindaian virus menggunakan deteksi *signature* standar **EICAR** dan inspeksi *embedded script payload* (`<?php`).
  4. Pembuatan *thumbnail* gambar secara proporsional (maksimal 300x300 piksel) menggunakan ekstensi native **PHP GD** dengan mempertahankan transparansi PNG/WebP.
- **Alasan**: Menjaga `TaskAttachmentController` tetap bersih (*thin controller*), mematuhi prinsip *Single Responsibility Principle (SRP)*, dan memudahkan pengujian melalui *Unit Test* tanpa ketergantungan HTTP atau database.

### 1.4 Asynchronous & Queue Processing Architecture
Empat operasi intensif dipisahkan ke dalam class `Job` (`ShouldQueue`) di `app/Jobs/`:
1. `SendTaskAssignedNotificationJob`: Mengirim email notifikasi ketika sebuah task ditugaskan kepada pengguna baru.
2. `BulkUpdateTaskStatusJob`: Memperbarui status banyak task sekaligus secara efisien menggunakan pemrosesan per kelompok (*chunking*).
3. `ProcessUploadedAttachmentJob`: Memverifikasi keamanan berkas dan membuat *thumbnail* gambar di latar belakang.
4. `ExportTasksReportJob`: Menghasilkan laporan tugas dalam format **CSV** maupun **PDF** (`barryvdh/laravel-dompdf`).

### 1.5 Real-Time Synchronization & Chunked Upload
- **Real-Time Updates**: Menggunakan kombinasi **BroadcastChannel API** untuk sinkronisasi instan antar-tab di browser yang sama serta *smart background polling* untuk menyegarkan daftar task dan diskusi komentar tanpa *reload* halaman.
- **Chunked File Upload**: Endpoint `POST /api/tasks/{id}/attachments/chunk` menerima potongan berkas berukuran besar secara bertahap (`part_0`, `part_1`, dst.), menggabungkannya kembali menggunakan *binary stream* (`stream_copy_to_stream`) agar hemat memori RAM, lalu memvalidasi hasil akhirnya.

## 2. Dokumentasi Skema Database & Indexing

Database dirancang menggunakan **MySQL (`utf8mb4_unicode_ci`)** dengan 4 tabel inti yang saling berelasi. File SQL skema dan data awal tersedia di `backend/database/sql/schema.sql` dan `backend/database/sql/seed_dump.sql`.

### 2.1 Tabel `users`
Menyimpan data akun pengguna dan peran aksesnya.
| Kolom | Tipe Data | Constraint / Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT UNSIGNED` | `PRIMARY KEY`, `AUTO_INCREMENT` | ID unik pengguna |
| `name` | `VARCHAR(255)` | `NOT NULL` | Nama lengkap pengguna |
| `email` | `VARCHAR(255)` | `NOT NULL`, `UNIQUE` | Email login pengguna |
| `password` | `VARCHAR(255)` | `NOT NULL` | Hash password (Bcrypt) |
| `role` | `ENUM('admin','manager','member')` | `DEFAULT 'member'`, `INDEX` | Peran pengguna di dalam sistem |
| `created_at` | `TIMESTAMP` | `NULLABLE` | Waktu pembuatan akun |
| `updated_at` | `TIMESTAMP` | `NULLABLE` | Waktu pembaruan terakhir |

### 2.2 Tabel `tasks`
Menyimpan data tugas utama beserta status, prioritas, pembuat, dan penerima tugas.
| Kolom | Tipe Data | Constraint / Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT UNSIGNED` | `PRIMARY KEY`, `AUTO_INCREMENT` | ID unik task |
| `title` | `VARCHAR(255)` | `NOT NULL` | Judul tugas |
| `description` | `TEXT` | `NULLABLE` | Deskripsi detail tugas |
| `status` | `ENUM('pending','in_progress','completed','cancelled')` | `DEFAULT 'pending'`, `INDEX` | Status pengerjaan tugas |
| `priority` | `ENUM('low','medium','high','urgent')` | `DEFAULT 'medium'`, `INDEX` | Tingkat prioritas tugas |
| `assigned_user_id` | `BIGINT UNSIGNED` | `NULLABLE`, `FK -> users.id (ON DELETE SET NULL)` | Pengguna yang ditugaskan |
| `created_by` | `BIGINT UNSIGNED` | `NOT NULL`, `FK -> users.id (ON DELETE CASCADE)` | Pengguna pembuat tugas |
| `due_date` | `DATETIME` | `NULLABLE`, `INDEX` | Batas waktu penyelesaian |
| `created_at` | `TIMESTAMP` | `NULLABLE` | Waktu pembuatan task |
| `updated_at` | `TIMESTAMP` | `NULLABLE` | Waktu pembaruan terakhir |

- **Strategi Indexing Tabel `tasks`**:
  - Single-column index pada `status`, `priority`, dan `due_date` untuk mempercepat *filtering* dan *sorting* pada endpoint `GET /api/tasks`.
  - Composite index pada `(assigned_user_id, status)` untuk mengoptimalkan query daftar tugas per anggota tim berdasarkan statusnya.

### 2.3 Tabel `task_attachments`
Menyimpan metadata berkas lampiran, lokasi *thumbnail*, dan nomor versi berkas.
| Kolom | Tipe Data | Constraint / Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT UNSIGNED` | `PRIMARY KEY`, `AUTO_INCREMENT` | ID unik lampiran |
| `task_id` | `BIGINT UNSIGNED` | `NOT NULL`, `FK -> tasks.id (ON DELETE CASCADE)`, `INDEX` | Relasi ke tabel `tasks` |
| `file_name` | `VARCHAR(255)` | `NOT NULL` | Nama asli berkas saat diunggah |
| `file_path` | `VARCHAR(255)` | `NOT NULL` | Path penyimpanan di disk `public` |
| `thumbnail_path` | `VARCHAR(255)` | `NULLABLE` | Path gambar thumbnail (khusus gambar) |
| `file_size` | `BIGINT UNSIGNED` | `NOT NULL` | Ukuran berkas dalam satuan *bytes* |
| `mime_type` | `VARCHAR(100)` | `NOT NULL`, `INDEX` | Tipe MIME berkas |
| `version` | `INT UNSIGNED` | `DEFAULT 1` | Nomor versi berkas (otomatis bertambah) |
| `uploaded_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Waktu berkas diunggah |

### 2.4 Tabel `task_comments`
Menyimpan daftar komentar diskusi pada setiap task.
| Kolom | Tipe Data | Constraint / Default | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT UNSIGNED` | `PRIMARY KEY`, `AUTO_INCREMENT` | ID unik komentar |
| `task_id` | `BIGINT UNSIGNED` | `NOT NULL`, `FK -> tasks.id (ON DELETE CASCADE)` | Relasi ke tabel `tasks` |
| `user_id` | `BIGINT UNSIGNED` | `NOT NULL`, `FK -> users.id (ON DELETE CASCADE)` | Penulis komentar |
| `comment` | `TEXT` | `NOT NULL` | Isi pesan komentar |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Waktu komentar dikirim |

- **Strategi Indexing Tabel `task_comments`**:
  - Composite index pada `(task_id, created_at)` agar pengambilan daftar komentar per task secara berurutan selalu cepat tanpa *filesort*.