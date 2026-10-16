<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Task;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TaskController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $builder = Task::query()
            ->with(['assignee:id,name,email,role', 'creator:id,name,email,role'])
            ->withCount(['attachments', 'comments']);

        // Filter dinamis berdasarkan parameter query
        $builder->when($request->filled('status'), fn ($q) => $q->where('status', $request->query('status')))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->query('priority')))
            ->when($request->filled('assigned_user_id'), fn ($q) => $q->where('assigned_user_id', $request->query('assigned_user_id')))
            ->when($request->filled('keyword'), function ($q) use ($request) {
                $term = $request->query('keyword');
                $q->where(fn ($sub) => $sub->where('title', 'like', "%{$term}%")->orWhere('description', 'like', "%{$term}%"));
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

        $taskItem->update($payload);

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
}