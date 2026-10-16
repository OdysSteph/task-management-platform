<?php

namespace App\Jobs;

use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class SendTaskAssignedNotificationJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(
        public int $taskId,
        public int $assignedUserId
    ) {}

    public function handle(): void
    {
        $task = Task::find($this->taskId);
        $recipient = User::find($this->assignedUserId);

        if (! $task || ! $recipient) {
            return;
        }

        $emailSubject = "Penugasan Task Baru: {$task->title}";
        $emailContent = "Halo {$recipient->name},\n\n"
            . "Anda mendapatkan penugasan task berikut:\n"
            . "Judul    : {$task->title}\n"
            . "Prioritas: {$task->priority}\n"
            . "Status   : {$task->status}\n"
            . "Tenggat  : " . ($task->due_date?->format('d M Y H:i') ?? '-') . "\n\n"
            . "Silakan cek aplikasi Task Management untuk detail selengkapnya.";

        Mail::raw($emailContent, function ($mail) use ($recipient, $emailSubject) {
            $mail->to($recipient->email, $recipient->name)
                ->subject($emailSubject);
        });

        Log::info("Email penugasan task #{$task->id} terkirim ke {$recipient->email}");
    }
}