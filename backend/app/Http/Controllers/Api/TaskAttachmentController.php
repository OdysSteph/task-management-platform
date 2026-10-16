<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Services\FileUploadService;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;
use App\Jobs\ProcessUploadedAttachmentJob;

class TaskAttachmentController extends Controller
{
    public function __construct(
        protected FileUploadService $uploadService
    ) {
    }

    protected function disk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk;
    }

    /**
     * POST /api/tasks/{id}/attachments
     * Upload reguler dengan validasi kategori, virus scan simulation, versioning, & thumbnail
     */
    public function store(Request $request, int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);

        $request->validate([
            'attachment' => [
                'required',
                'file',
                'max:102400', // Maks 100 MB (batas tertinggi untuk kategori video)
                'mimes:jpg,jpeg,png,webp,gif,pdf,doc,docx,xls,xlsx,csv,txt,mp4,webm',
            ],
        ]);

        $uploadedFile = $request->file('attachment');

        try {
            $this->uploadService->validateFileRules($uploadedFile);
        } catch (RuntimeException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        }

        // Jalankan simulasi virus scan sebelum file disimpan permanen
        $scanResult = $this->uploadService->simulateVirusScan($uploadedFile->getRealPath());
        if (!$scanResult['clean']) {
            return response()->json([
                'success' => false,
                'message' => "File ditolak oleh pemindai keamanan: terdeteksi {$scanResult['threat']}.",
            ], 422);
        }

        $record = $this->persistUploadedFile($taskItem, $uploadedFile);

        return response()->json([
            'success' => true,
            'message' => 'Lampiran berhasil divalidasi, dipindai, dan disimpan.',
            'data' => $record,
        ], 201);
    }

    /**
     * POST /api/tasks/{id}/attachments/chunk
     * Advanced Challenge: Chunked upload untuk file berukuran besar (>50MB)
     */
    public function chunkUpload(Request $request, int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);

        $data = $request->validate([
            'upload_id' => ['required', 'string', 'max:100'],
            'chunk_index' => ['required', 'integer', 'min:0'],
            'total_chunks' => ['required', 'integer', 'min:1'],
            'file_name' => ['required', 'string', 'max:255'],
            'chunk' => ['required', 'file', 'max:10240'], // Maks 10MB per chunk
        ]);

        $safeUploadId = preg_replace('/[^A-Za-z0-9\-_]/', '', $data['upload_id']);
        $chunkDir = storage_path("app/private/chunks/{$safeUploadId}");

        if (!is_dir($chunkDir)) {
            mkdir($chunkDir, 0755, true);
        }

        $chunkFile = $request->file('chunk');
        $chunkFile->move($chunkDir, "part_{$data['chunk_index']}");

        // Cek apakah seluruh chunk sudah terkumpul
        $uploadedParts = glob("{$chunkDir}/part_*") ?: [];
        if (count($uploadedParts) < (int) $data['total_chunks']) {
            return response()->json([
                'success' => true,
                'completed' => false,
                'message' => "Chunk {$data['chunk_index']} diterima.",
                'received_chunks' => count($uploadedParts),
                'total_chunks' => (int) $data['total_chunks'],
            ]);
        }

        // Gabungkan semua chunk secara berurutan
        $mergedTempPath = "{$chunkDir}/merged_" . basename($data['file_name']);
        $outStream = fopen($mergedTempPath, 'wb');

        for ($i = 0; $i < (int) $data['total_chunks']; $i++) {
            $partPath = "{$chunkDir}/part_{$i}";
            if (!file_exists($partPath)) {
                fclose($outStream);

                return response()->json([
                    'success' => false,
                    'message' => "Chunk bagian ke-{$i} tidak ditemukan.",
                ], 422);
            }

            $inStream = fopen($partPath, 'rb');
            stream_copy_to_stream($inStream, $outStream);
            fclose($inStream);
            @unlink($partPath);
        }
        fclose($outStream);

        // Buat instance UploadedFile dari hasil penggabungan untuk divalidasi & dipindai
        $assembledFile = new UploadedFile(
            $mergedTempPath,
            $data['file_name'],
            mime_content_type($mergedTempPath) ?: 'application/octet-stream',
            null,
            true
        );

        try {
            $this->uploadService->validateFileRules($assembledFile);
            $scanResult = $this->uploadService->simulateVirusScan($mergedTempPath);

            if (!$scanResult['clean']) {
                throw new RuntimeException("File hasil penggabungan ditolak: terdeteksi {$scanResult['threat']}.");
            }

            $record = $this->persistUploadedFile($taskItem, $assembledFile);
        } catch (RuntimeException $e) {
            @unlink($mergedTempPath);
            @rmdir($chunkDir);

            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        }

        @unlink($mergedTempPath);
        @rmdir($chunkDir);

        return response()->json([
            'success' => true,
            'completed' => true,
            'message' => 'Seluruh chunk berhasil digabungkan dan disimpan.',
            'data' => $record,
        ], 201);
    }

    /**
     * GET /api/tasks/{id}/attachments/versions
     * Advanced Challenge: Menampilkan riwayat versi file pada sebuah task
     */
    public function versions(Request $request, int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);

        $query = TaskAttachment::where('task_id', $taskItem->id)
            ->orderBy('file_name')
            ->orderByDesc('version');

        if ($request->filled('file_name')) {
            $query->where('file_name', $request->query('file_name'));
        }

        return response()->json([
            'success' => true,
            'data' => $query->get(),
        ]);
    }

    /**
     * GET /api/attachments/{id}/download
     */
    public function download(int $id): StreamedResponse|JsonResponse
    {
        $record = TaskAttachment::findOrFail($id);

        if (!$this->disk()->exists($record->file_path)) {
            return response()->json([
                'success' => false,
                'message' => 'Berkas fisik tidak ditemukan pada server.',
            ], 404);
        }

        return $this->disk()->download($record->file_path, $record->file_name);
    }

    /**
     * DELETE /api/attachments/{id}
     */
    public function destroy(int $id): JsonResponse
    {
        $record = TaskAttachment::findOrFail($id);

        $this->disk()->delete(array_filter([
            $record->file_path,
            $record->thumbnail_path,
        ]));

        $record->delete();

        return response()->json([
            'success' => true,
            'message' => 'Lampiran berhasil dihapus.',
        ]);
    }

    /**
     * Helper internal untuk menyimpan file, mencatat versi baru, dan membuat thumbnail gambar
     */
    protected function persistUploadedFile(Task $taskItem, UploadedFile $file): TaskAttachment
    {
        $clientName = $file->getClientOriginalName();
        $mimeType = $file->getMimeType() ?: $file->getClientMimeType();
        $fileSize = $file->getSize();

        $currentMaxVersion = (int) TaskAttachment::where('task_id', $taskItem->id)
            ->where('file_name', $clientName)
            ->max('version');

        $nextVersion = $currentMaxVersion + 1;
        $uniqueFileName = "v{$nextVersion}_" . Str::uuid()->toString() . '_' . preg_replace('/[^A-Za-z0-9.\-_]/', '_', $clientName);
        $storedPath = $file->storeAs("task_files/{$taskItem->id}", $uniqueFileName, 'public');

        $thumbnailPath = null;
        if (str_starts_with($mimeType, 'image/')) {
            $thumbnailPath = $this->uploadService->createImageThumbnail($storedPath, $taskItem->id, $uniqueFileName);
        }

        $attachment = TaskAttachment::create([
            'task_id' => $taskItem->id,
            'file_name' => $clientName,
            'file_path' => $storedPath,
            'thumbnail_path' => $thumbnailPath,
            'file_size' => $fileSize,
            'mime_type' => $mimeType,
            'version' => $nextVersion,
        ]);

        ProcessUploadedAttachmentJob::dispatch($attachment->id);

        return $attachment;
    }
}