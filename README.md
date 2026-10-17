# TaskHub Pro — Full-Stack Task Management Platform

Aplikasi manajemen tugas (*Task Management Platform*) berbasis **Laravel 13 RESTful API** dan **React (Vite)** yang dilengkapi autentikasi JWT, pengelolaan file lampiran (*drag-and-drop*, *thumbnail* otomatis, *versioning*, *chunked upload*, & simulasi pemindaian virus), pemrosesan antrean latar belakang (*Background Jobs*), serta pembaruan *real-time*.

## Fitur Utama

- **Autentikasi & Otorisasi JWT**: Login, Logout, dan inspeksi sesi pengguna aktif (`/api/auth/*`).
- **Manajemen Task (CRUD & Query Lanjutan)**: Paginasi, pencarian kata kunci, filter multi-kriteria (`status`, `priority`, `assigned_user_id`, rentang tanggal), dan pengurutan kolom dinamis.
- **Sistem Upload File Aman**:
  - Validasi kategori & batas ukuran file (Gambar maks 10MB, Dokumen maks 25MB, Video maks 100MB).
  - Pembuatan *thumbnail* proporsional otomatis menggunakan PHP GD.
  - Simulasi pemindaian keamanan (*EICAR signature* & deteksi injeksi *script*).
  - Sistem *File Versioning* (`v1`, `v2`, dst.) dan dukungan *Chunked Upload* untuk file besar.
- **Pemrosesan Latar Belakang (Laravel Queue)**:
  - Notifikasi email saat penugasan task (`SendTaskAssignedNotificationJob`).
  - Pembaruan status task secara massal (`BulkUpdateTaskStatusJob`).
  - Pemrosesan lampiran & pembuatan thumbnail (`ProcessUploadedAttachmentJob`).
  - Ekspor laporan ke format **CSV** dan **PDF** (`ExportTasksReportJob`).
- **Frontend React Modern & Responsif**:
  - Antarmuka *Drag-and-Drop* file dengan indikator *progress bar* (`0% - 100%`).
  - Sistem komentar dan sinkronisasi status *real-time* lintas tab.

## Struktur Direktori

```text
task-management-platform/
├── backend/                  # Aplikasi Backend Laravel REST API
│   ├── app/
│   ├── database/
│   │   └── sql/              # File schema.sql & seed_dump.sql
│   └── tests/                # Unit & Feature Automated Tests
├── frontend/                 # Aplikasi Frontend React (Vite)
├── documentation/            # Dokumentasi Teknis Proyek
│   ├── api-docs/
│   │   └── api-reference.md  # Spesifikasi Endpoint REST API
│   ├── architecture.md       # Desain Database & Keputusan Arsitektur
│   └── setup-guide.md        # Panduan Instalasi & Pengujian Lengkap
└── README.md