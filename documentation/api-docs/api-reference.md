# Dokumentasi RESTful API

Base URL: `http://127.0.0.1:8000/api`

Seluruh endpoint (kecuali `/auth/login`) wajib menyertakan header:
- `Authorization: Bearer <jwt_token>`
- `Accept: application/json`

## 1. Authentication
| Method | Endpoint | Deskripsi | Body / Parameter |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | Login user & dapatkan token JWT | `{ "email": "admin@example.com", "password": "password123" }` |
| `GET` | `/auth/me` | Ambil profil user yang sedang login | - |
| `POST` | `/auth/logout` | Akhiri sesi token JWT saat ini | - |

## 2. Task Management & Queue Operations
| Method | Endpoint | Deskripsi | Query / Body Parameter |
| :--- | :--- | :--- | :--- |
| `GET` | `/tasks` | Daftar task (paginasi, filter, sort) | `?status=&priority=&assigned_user_id=&keyword=&sort_by=created_at&sort_dir=desc&page=1` |
| `GET` | `/tasks/{id}` | Detail task beserta file & komentar | - |
| `POST` | `/tasks` | Buat task baru | `{ "title", "description", "status", "priority", "assigned_user_id", "due_date" }` |
| `PUT` | `/tasks/{id}` | Perbarui data task | `{ "title", "description", "status", "priority", "assigned_user_id", "due_date" }` |
| `DELETE` | `/tasks/{id}` | Hapus task | - |
| `POST` | `/tasks/bulk-status` | Ubah status banyak task sekaligus | `{ "task_ids": [1, 2], "status": "completed" }` |
| `POST` | `/tasks/export` | Buat file laporan CSV atau PDF | `{ "format": "csv", "status": "completed" }` |
| `GET` | `/tasks/exports/{fileName}` | Unduh file laporan hasil ekspor | - |
| `POST` | `/tasks/{id}/comments` | Tambah komentar pada task | `{ "comment": "Teks komentar" }` |
| `GET` | `/users` | Daftar user untuk pilihan Assignee | - |

## 3. File Attachments
| Method | Endpoint | Deskripsi | Body / Parameter |
| :--- | :--- | :--- | :--- |
| `POST` | `/tasks/{id}/attachments` | Upload file lampiran (`multipart/form-data`) | Form field: `attachment` (file) |
| `POST` | `/tasks/{id}/attachments/chunk` | Upload file besar per bagian (*chunk*) | `upload_id`, `chunk_index`, `total_chunks`, `file_name`, `chunk` |
| `GET` | `/tasks/{id}/attachments/versions` | Lihat riwayat versi file pada task | `?file_name=opsional` |
| `GET` | `/attachments/{id}/download` | Unduh file lampiran | - |
| `DELETE` | `/attachments/{id}` | Hapus file lampiran & thumbnail | - |