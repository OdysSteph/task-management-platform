<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

    protected function casts(): array
    {
        return [
            'file_size' => 'integer',
            'version' => 'integer',
            'uploaded_at' => 'datetime',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }
}