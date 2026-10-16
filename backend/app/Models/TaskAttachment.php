<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

class TaskAttachment extends Model
{
    const CREATED_AT = 'uploaded_at';
    const UPDATED_AT = null;

    protected $fillable = [
        'task_id',
        'file_name',
        'file_path',
        'thumbnail_path',
        'file_size',
        'mime_type',
        'version',
        'uploaded_at',
    ];

    protected $appends = [
        'file_url',
        'thumbnail_url',
    ];

    protected function casts(): array
    {
        return [
            'file_size' => 'integer',
            'version' => 'integer',
            'uploaded_at' => 'datetime',
        ];
    }

    protected function publicDisk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk;
    }

    public function getFileUrlAttribute(): string
    {
        return $this->publicDisk()->url($this->file_path);
    }

    public function getThumbnailUrlAttribute(): ?string
    {
        return $this->thumbnail_path
            ? $this->publicDisk()->url($this->thumbnail_path)
            : null;
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }
}