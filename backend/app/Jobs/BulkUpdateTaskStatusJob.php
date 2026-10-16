<?php

namespace App\Jobs;

use App\Models\Task;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class BulkUpdateTaskStatusJob implements ShouldQueue
{
    use Queueable;

    /**
     * @param array<int> $taskIds
     */
    public function __construct(
        public array $taskIds,
        public string $targetStatus,
        public int $actorUserId
    ) {}

    public function handle(): void
    {
        $affectedRows = 0;

        foreach (array_chunk($this->taskIds, 50) as $batchIds) {
            $affectedRows += Task::whereIn('id', $batchIds)->update([
                'status' => $this->targetStatus,
                'updated_at' => now(),
            ]);
        }

        Log::info("Bulk status update selesai: {$affectedRows} task diubah menjadi '{$this->targetStatus}' oleh user #{$this->actorUserId}.");
    }
}