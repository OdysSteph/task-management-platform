<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\BulkUpdateTaskStatusJob;
use App\Jobs\ExportTasksReportJob;
use App\Jobs\SendTaskAssignedNotificationJob;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TaskController extends Controller
{
    protected function currentUser(): ?User
    {
        /** @var User|null $account */
        $account = auth('api')->user();

        return $account;
    }

    public function index(Request $request): JsonResponse
    {
        $builder = Task::query()
            ->with(['assignee:id,name,email,role', 'creator:id,name,email,role'])
            ->withCount(['attachments', 'comments']);

        $builder->when($request->filled('status'), fn ($q) => $q->where('status', $request->query('status')))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->query('priority')))
            ->when($request->filled('assigned_user_id'), fn ($q) => $q->where('assigned_user_id', $request->query('assigned_user_id')))
            ->when($request->filled('keyword'), function ($q) use ($request) {
                $term = $request->query('keyword');
                $q->where(fn ($sub) => $sub->where('title', 'like', "%{$term}%")->orWhere('description', 'like', "%{$term}%"));
            });

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
        $actor = $this->currentUser();

        // RBAC: Hanya Admin dan Manager yang boleh membuat task baru
        if ($actor && $actor->role === 'member') {
            return response()->json([
                'success' => false,
                'message' => 'Akses ditolak: Role Member tidak diizinkan membuat task baru.',
            ], 403);
        }

        $payload = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'status' => ['sometimes', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'urgent'])],
            'assigned_user_id' => ['nullable', 'exists:users,id'],
            'due_date' => ['nullable', 'date'],
        ]);

        $payload['created_by'] = $actor?->id;

        $taskItem = Task::create($payload);

        if (! empty($taskItem->assigned_user_id)) {
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
        $actor = $this->currentUser();
        $oldAssignee = $taskItem->assigned_user_id;

        // RBAC untuk Role Member: Hanya boleh mengubah status pada task yang ditugaskan kepadanya
        if ($actor && $actor->role === 'member') {
            if ((int) $taskItem->assigned_user_id !== (int) $actor->id) {
                return response()->json([
                    'success' => false,
                    'message' => 'Akses ditolak: Anda hanya dapat memperbarui status task yang ditugaskan kepada Anda.',
                ], 403);
            }

            $memberPayload = $request->validate([
                'status' => ['required', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            ]);

            $taskItem->update(['status' => $memberPayload['status']]);

            return response()->json([
                'success' => true,
                'message' => 'Status task berhasil diperbarui.',
                'data' => $taskItem->fresh(['assignee:id,name,email', 'creator:id,name,email']),
            ]);
        }

        $payload = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'status' => ['sometimes', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            'priority' => ['sometimes', Rule::in(['low', 'medium', 'high', 'urgent'])],
            'assigned_user_id' => ['nullable', 'exists:users,id'],
            'due_date' => ['nullable', 'date'],
        ]);

        $taskItem->update($payload);

        if (! empty($taskItem->assigned_user_id) && $taskItem->assigned_user_id !== $oldAssignee) {
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
        $actor = $this->currentUser();

        // RBAC: Member dilarang menghapus; Manager hanya boleh menghapus task buatannya sendiri
        if ($actor && $actor->role === 'member') {
            return response()->json([
                'success' => false,
                'message' => 'Akses ditolak: Role Member tidak dapat menghapus task.',
            ], 403);
        }

        if ($actor && $actor->role === 'manager' && (int) $taskItem->created_by !== (int) $actor->id) {
            return response()->json([
                'success' => false,
                'message' => 'Akses ditolak: Manager hanya dapat menghapus task yang dibuatnya sendiri.',
            ], 403);
        }

        $taskItem->delete();

        return response()->json([
            'success' => true,
            'message' => 'Task berhasil dihapus.',
        ]);
    }

    public function bulkUpdateStatus(Request $request): JsonResponse
    {
        $actor = $this->currentUser();

        if ($actor && $actor->role === 'member') {
            return response()->json([
                'success' => false,
                'message' => 'Akses ditolak: Fitur Bulk Update hanya untuk Admin dan Manager.',
            ], 403);
        }

        $validated = $request->validate([
            'task_ids' => ['required', 'array', 'min:1'],
            'task_ids.*' => ['integer', 'exists:tasks,id'],
            'status' => ['required', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
        ]);

        BulkUpdateTaskStatusJob::dispatchSync(
            $validated['task_ids'],
            $validated['status'],
            (int) $actor?->id
        );

        return response()->json([
            'success' => true,
            'message' => 'Status seluruh task terpilih berhasil diperbarui.',
            'updated_count' => count($validated['task_ids']),
        ]);
    }

    public function exportReport(Request $request): JsonResponse
    {
        $actor = $this->currentUser();

        if ($actor && $actor->role === 'member') {
            return response()->json([
                'success' => false,
                'message' => 'Akses ditolak: Fitur Export Laporan hanya untuk Admin dan Manager.',
            ], 403);
        }

        $validated = $request->validate([
            'format' => ['required', Rule::in(['csv', 'pdf'])],
            'status' => ['nullable', Rule::in(['pending', 'in_progress', 'completed', 'cancelled'])],
            'priority' => ['nullable', Rule::in(['low', 'medium', 'high', 'urgent'])],
        ]);

        $ext = $validated['format'];
        $fileName = 'tasks_report_' . now()->format('Ymd_His') . '.' . $ext;

        ExportTasksReportJob::dispatchSync(
            $ext,
            [
                'status' => $validated['status'] ?? null,
                'priority' => $validated['priority'] ?? null,
            ],
            $fileName
        );

        return response()->json([
            'success' => true,
            'message' => 'Laporan berhasil dibuat.',
            'data' => [
                'file_name' => $fileName,
                'download_endpoint' => "/tasks/exports/{$fileName}",
            ],
        ]);
    }

    public function downloadExport(string $fileName): StreamedResponse|JsonResponse
    {
        $safeName = basename($fileName);
        $relativePath = "exports/{$safeName}";

        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        if (! $disk->exists($relativePath)) {
            return response()->json([
                'success' => false,
                'message' => 'File laporan tidak ditemukan.',
            ], 404);
        }

        return $disk->download($relativePath, $safeName);
    }

    public function users(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => User::select('id', 'name', 'email', 'role')->orderBy('name')->get(),
        ]);
    }

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