<?php

namespace App\Jobs;

use App\Models\Task;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ExportTasksReportJob implements ShouldQueue
{
    use Queueable;

    /**
     * @param array<string, mixed> $criteria
     */
    public function __construct(
        public string $exportFormat,
        public array $criteria,
        public string $fileName
    ) {}

    protected function disk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk;
    }

    public function handle(): void
    {
        $builder = Task::with(['assignee:id,name', 'creator:id,name'])->orderByDesc('created_at');

        if (! empty($this->criteria['status'])) {
            $builder->where('status', $this->criteria['status']);
        }
        if (! empty($this->criteria['priority'])) {
            $builder->where('priority', $this->criteria['priority']);
        }

        $items = $builder->get();
        $this->disk()->makeDirectory('exports');
        $targetPath = "exports/{$this->fileName}";

        if ($this->exportFormat === 'pdf' && class_exists(\Barryvdh\DomPDF\Facade\Pdf::class)) {
            $html = $this->renderReportHtml($items);
            $pdfOutput = \Barryvdh\DomPDF\Facade\Pdf::loadHTML($html)->output();
            $this->disk()->put($targetPath, $pdfOutput);
        } elseif ($this->exportFormat === 'pdf') {
            $this->disk()->put($targetPath, $this->renderReportHtml($items));
        } else {
            $this->disk()->put($targetPath, $this->renderCsv($items));
        }

        Log::info("File laporan task berhasil dibuat: {$targetPath}");
    }

    protected function renderCsv($items): string
    {
        $buffer = fopen('php://temp', 'r+');
        fputcsv($buffer, ['ID', 'Title', 'Status', 'Priority', 'Assignee', 'Creator', 'Due Date']);

        foreach ($items as $row) {
            fputcsv($buffer, [
                $row->id,
                $row->title,
                $row->status,
                $row->priority,
                $row->assignee?->name ?? 'Unassigned',
                $row->creator?->name ?? '-',
                $row->due_date?->format('Y-m-d H:i') ?? '-',
            ]);
        }

        rewind($buffer);
        $content = stream_get_contents($buffer) ?: '';
        fclose($buffer);

        return $content;
    }

    protected function renderReportHtml($items): string
    {
        $rowsHtml = '';
        foreach ($items as $row) {
            $assignee = e($row->assignee?->name ?? 'Unassigned');
            $title = e($row->title);
            $due = $row->due_date?->format('Y-m-d') ?? '-';
            $rowsHtml .= "<tr>
                <td>{$row->id}</td>
                <td>{$title}</td>
                <td>{$row->status}</td>
                <td>{$row->priority}</td>
                <td>{$assignee}</td>
                <td>{$due}</td>
            </tr>";
        }

        return "<!DOCTYPE html><html><head><meta charset='utf-8'><style>
            body { font-family: sans-serif; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
            th { background: #f3f4f6; }
        </style></head><body>
            <h2>Task Management Report</h2>
            <table><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due Date</th></tr></thead>
            <tbody>{$rowsHtml}</tbody></table>
        </body></html>";
    }
}