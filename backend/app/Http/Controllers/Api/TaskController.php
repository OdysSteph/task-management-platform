<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Task;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use App\Jobs\BulkUpdateTaskStatusJob;
use App\Jobs\ExportTasksReportJob;
use App\Jobs\SendTaskAssignedNotificationJob;
use Illuminate\Support\Facades\Storage;
use App\Models\TaskComment;
use App\Models\User;

class TaskController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $builder = Task::query()
            ->with(['assignee:id,name,email,role', 'creator:id,name,email,role'])
            ->withCount(['attachments', 'comments']);

        // Filter dinamis berdasarkan parameter query
        $builder->when($request->filled('status'), fn($q) => $q->where('status', $request->query('status')))
            ->when($request->filled('priority'), fn($q) => $q->where('priority', $request->query('priority')))
            ->when($request->filled('assigned_user_id'), fn($q) => $q->where('assigned_user_id', $request->query('assigned_user_id')))
            ->when($request->filled('keyword'), function ($q) use ($request) {
                $term = $request->query('keyword');
                $q->where(fn($sub) => $sub->where('title', 'like', "%{$term}%")->orWhere('description', 'like', "%{$term}%"));
            });

        // Pengurutan (Sorting) dengan daftar kolom yang diizinkan
        $sortableFields = ['id', 'title', 'status', 'priority', 'due_date', 'created_at'];
        $sortColumn = in_array($request->query('sort_by'), $sortableFields, true)
            ? $request->query('sort_by')
            : 'created_at';
        $sortDir = strtolower($request->query('sort_dir', 'desc')) === 'asc' ? 'asc' : 'desc';

        $perPage = max(1, min((int) $request->query('per_page', 10), 50));
        $paginated = $builder->orderBy($sortColumn, $sortDir)->paginate($perPage);

        return response()->json([
            'success' => true,
            'data' => $paginated,
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $taskItem = Task::with([
            'assignee:id,name,email,role',
            'creator:id,name,email,role',
            'attachments',
            'comments.user:id,name,email',
        ])->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $taskItem,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $payload = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'status' => ['sometimes', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'urgent'])],
            'assigned_user_id' => ['nullable', 'exists:users,id'],
            'due_date' => ['nullable', 'date'],
        ]);

        $payload['created_by'] = auth('api')->id();

        $taskItem = Task::create($payload);

        if (!empty($taskItem->assigned_user_id)) {
            SendTaskAssignedNotificationJob::dispatch($taskItem->id, (int) $taskItem->assigned_user_id);
        }

        return response()->json([
            'success' => true,
            'message' => 'Task baru berhasil ditambahkan.',
            'data' => $taskItem->load(['assignee:id,name,email', 'creator:id,name,email']),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);

        $payload = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'status' => ['sometimes', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'urgent'])],
            'assigned_user_id' => ['nullable', 'exists:users,id'],
            'due_date' => ['nullable', 'date'],
        ]);
        $previousAssignee = $taskItem->assigned_user_id;
        $taskItem->update($payload);

        if (!empty($taskItem->assigned_user_id) && $taskItem->assigned_user_id !== $previousAssignee) {
            SendTaskAssignedNotificationJob::dispatch($taskItem->id, (int) $taskItem->assigned_user_id);
        }

        return response()->json([
            'success' => true,
            'message' => 'Data task berhasil diperbarui.',
            'data' => $taskItem->fresh(['assignee:id,name,email', 'creator:id,name,email']),
        ]);
    }

    public function destroy(int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);
        $taskItem->delete();

        return response()->json([
            'success' => true,
            'message' => 'Task berhasil dihapus.',
        ]);
    }


    public function bulkUpdateStatus(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'task_ids' => ['required', 'array', 'min:1'],
            'task_ids.*' => ['integer', 'exists:tasks,id'],
            'status' => ['required', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
        ]);

        BulkUpdateTaskStatusJob::dispatch(
            $validated['task_ids'],
            $validated['status'],
            (int) auth('api')->id()
        );

        return response()->json([
            'success' => true,
            'message' => 'Permintaan bulk update status telah dimasukkan ke antrean (queue).',
            'queued_count' => count($validated['task_ids']),
        ], 202);
    }


    public function exportReport(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'format' => ['required', Rule::in(['csv', 'pdf'])],
            'status' => ['nullable', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            'priority' => ['nullable', Rule::in(['low', 'medium', 'high', 'urgent'])],
        ]);

        $ext = $validated['format'];
        $fileName = 'tasks_report_' . now()->format('Ymd_His') . '.' . $ext;

        ExportTasksReportJob::dispatch(
            $ext,
            [
                'status' => $validated['status'] ?? null,
                'priority' => $validated['priority'] ?? null,
            ],
            $fileName
        );

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return response()->json([
            'success' => true,
            'message' => 'Proses ekspor laporan sedang dijalankan di background.',
            'data' => [
                'file_name' => $fileName,
                'download_url' => $disk->url("exports/{$fileName}"),
            ],
        ], 202);
    }

    /**
     * GET /api/users - Mengambil daftar user untuk dropdown Assignee di Frontend
     */
    public function users(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => User::select('id', 'name', 'email', 'role')->orderBy('name')->get(),
        ]);
    }

    /**
     * POST /api/tasks/{id}/comments - Menambahkan komentar pada task
     */
    public function storeComment(Request $request, int $id): JsonResponse
    {
        $taskItem = Task::findOrFail($id);

        $validated = $request->validate([
            'comment' => ['required', 'string', 'max:2000'],
        ]);

        $newComment = TaskComment::create([
            'task_id' => $taskItem->id,
            'user_id' => (int) auth('api')->id(),
            'comment' => $validated['comment'],
            'created_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Komentar berhasil ditambahkan.',
            'data' => $newComment->load('user:id,name,email'),
        ], 201);
    }
}