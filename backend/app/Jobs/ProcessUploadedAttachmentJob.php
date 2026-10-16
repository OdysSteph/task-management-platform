<?php

namespace App\Jobs;

use App\Models\TaskAttachment;
use App\Services\FileUploadService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ProcessUploadedAttachmentJob implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public int $attachmentId
    ) {}

    protected function disk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk;
    }

    public function handle(FileUploadService $uploadService): void
    {
        $record = TaskAttachment::find($this->attachmentId);

        if (! $record || ! $this->disk()->exists($record->file_path)) {
            return;
        }

        $absolutePath = $this->disk()->path($record->file_path);
        $scan = $uploadService->simulateVirusScan($absolutePath);

        if (! $scan['clean']) {
            $this->disk()->delete(array_filter([$record->file_path, $record->thumbnail_path]));
            $record->delete();
            Log::warning("Attachment #{$this->attachmentId} dihapus karena terdeteksi ancaman: {$scan['threat']}");

            return;
        }

        if (str_starts_with($record->mime_type, 'image/') && ! $record->thumbnail_path) {
            $thumbPath = $uploadService->createImageThumbnail(
                $record->file_path,
                $record->task_id,
                basename($record->file_path)
            );

            if ($thumbPath) {
                $record->update(['thumbnail_path' => $thumbPath]);
            }
        }

        Log::info("Pemrosesan background selesai untuk attachment #{$record->id}.");
    }
}