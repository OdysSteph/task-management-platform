<?php

namespace Tests\Feature;

use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class TaskPlatformApiTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected string $jwtToken;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::create([
            'name' => 'Tester Admin',
            'email' => 'tester@example.com',
            'password' => Hash::make('secret123'),
            'role' => 'admin',
        ]);

        $this->jwtToken = (string) auth('api')->login($this->user);
    }

    protected function authHeaders(): array
    {
        return [
            'Authorization' => "Bearer {$this->jwtToken}",
            'Accept' => 'application/json',
        ];
    }

    public function test_user_can_authenticate_and_fetch_profile(): void
    {
        $loginRes = $this->postJson('/api/auth/login', [
            'email' => 'tester@example.com',
            'password' => 'secret123',
        ]);

        $loginRes->assertStatus(200)
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data' => ['token', 'profile']]);

        $meRes = $this->withHeaders($this->authHeaders())->getJson('/api/auth/me');
        $meRes->assertStatus(200)
            ->assertJsonPath('data.email', 'tester@example.com');
    }

    public function test_task_crud_and_filtering_workflow(): void
    {
        // 1. Create Task
        $createRes = $this->withHeaders($this->authHeaders())->postJson('/api/tasks', [
            'title' => 'Integrasi Payment Gateway',
            'description' => 'Menyambungkan webhook pembayaran',
            'status' => 'pending',
            'priority' => 'urgent',
            'assigned_user_id' => $this->user->id,
        ]);

        $createRes->assertStatus(201)
            ->assertJsonPath('data.title', 'Integrasi Payment Gateway');

        $taskId = $createRes->json('data.id');

        // 2. List & Filter Tasks
        $listRes = $this->withHeaders($this->authHeaders())
            ->getJson('/api/tasks?priority=urgent&keyword=Payment');

        $listRes->assertStatus(200)
            ->assertJsonPath('data.total', 1);

        // 3. Update Task
        $updateRes = $this->withHeaders($this->authHeaders())
            ->putJson("/api/tasks/{$taskId}", [
                'status' => 'in_progress',
            ]);

        $updateRes->assertStatus(200)
            ->assertJsonPath('data.status', 'in_progress');

        // 4. Add Comment
        $commentRes = $this->withHeaders($this->authHeaders())
            ->postJson("/api/tasks/{$taskId}/comments", [
                'comment' => 'Sedang dikerjakan hari ini.',
            ]);

        $commentRes->assertStatus(201)
            ->assertJsonPath('data.comment', 'Sedang dikerjakan hari ini.');

        // 5. Delete Task
        $deleteRes = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/tasks/{$taskId}");

        $deleteRes->assertStatus(200);
        $this->assertDatabaseMissing('tasks', ['id' => $taskId]);
    }

    public function test_bulk_status_update_and_file_upload_versioning(): void
    {
        Storage::fake('public');

        $taskA = Task::create([
            'title' => 'Task Alpha',
            'status' => 'pending',
            'priority' => 'low',
            'created_by' => $this->user->id,
        ]);

        // 1. Bulk Update Status
        $bulkRes = $this->withHeaders($this->authHeaders())->postJson('/api/tasks/bulk-status', [
            'task_ids' => [$taskA->id],
            'status' => 'completed',
        ]);

        $bulkRes->assertStatus(200);
        $this->assertDatabaseHas('tasks', [
            'id' => $taskA->id,
            'status' => 'completed',
        ]);

        // 2. Upload File Versi 1 & Versi 2
        $fileV1 = UploadedFile::fake()->create('spesifikasi.pdf', 200, 'application/pdf');
        $upload1 = $this->withHeaders($this->authHeaders())
            ->postJson("/api/tasks/{$taskA->id}/attachments", ['attachment' => $fileV1]);

        $upload1->assertStatus(201)
            ->assertJsonPath('data.version', 1);

        $fileV2 = UploadedFile::fake()->create('spesifikasi.pdf', 250, 'application/pdf');
        $upload2 = $this->withHeaders($this->authHeaders())
            ->postJson("/api/tasks/{$taskA->id}/attachments", ['attachment' => $fileV2]);

        $upload2->assertStatus(201)
            ->assertJsonPath('data.version', 2);
    }
}