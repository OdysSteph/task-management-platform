<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Task;
use App\Models\TaskAttachment;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TaskAttachmentController extends Controller
{
    /**
     * Helper agar IDE (Intelephense) mengenali method download(), path(), dan url()
     */
    protected function disk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk;
    }

    public function store(Request $request, int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);

        $request->validate([
            'attachment' => [
                'required',
                'file',
                'max:20480', // Batas 20 MB
                'mimes:jpg,jpeg,png,webp,gif,pdf,doc,docx,xls,xlsx,csv,txt,mp4,webm',
            ],
        ]);

        $uploadedFile = $request->file('attachment');
        $clientName = $uploadedFile->getClientOriginalName();

        // Hitung nomor versi otomatis jika nama file yang sama diunggah ulang
        $currentMaxVersion = (int) TaskAttachment::where('task_id', $taskItem->id)
            ->where('file_name', $clientName)
            ->max('version');

        $uniqueFileName = Str::uuid()->toString() . '_' . preg_replace('/[^A-Za-z0-9.\-_]/', '_', $clientName);
        $storedPath = $uploadedFile->storeAs("task_files/{$taskItem->id}", $uniqueFileName, 'public');

        $record = TaskAttachment::create([
            'task_id' => $taskItem->id,
            'file_name' => $clientName,
            'file_path' => $storedPath,
            'file_size' => $uploadedFile->getSize(),
            'mime_type' => $uploadedFile->getClientMimeType(),
            'version' => $currentMaxVersion + 1,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Lampiran berhasil disimpan.',
            'data' => $record,
        ], 201);
    }

    public function download(int $id): StreamedResponse|JsonResponse
    {
        $record = TaskAttachment::findOrFail($id);

        if (! $this->disk()->exists($record->file_path)) {
            return response()->json([
                'success' => false,
                'message' => 'Berkas fisik tidak ditemukan pada server.',
            ], 404);
        }

        return $this->disk()->download($record->file_path, $record->file_name);
    }

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
}