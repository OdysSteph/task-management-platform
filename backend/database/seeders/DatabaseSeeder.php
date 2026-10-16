<?php

namespace Database\Seeders;

use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
        ]);

        $manager = User::create([
            'name' => 'Project Manager',
            'email' => 'manager@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $member = User::create([
            'name' => 'Team Member',
            'email' => 'member@example.com',
            'password' => Hash::make('password123'),
            'role' => 'member',
        ]);

        $extraUsers = User::factory(3)->create();
        $allUsers = collect([$admin, $manager, $member])->merge($extraUsers);

        $tasks = Task::factory(20)->make()->each(function ($task) use ($allUsers) {
            $task->assigned_user_id = $allUsers->random()->id;
            $task->created_by = $allUsers->random()->id;
            $task->save();
        });

        TaskComment::factory(15)->make()->each(function ($comment) use ($tasks, $allUsers) {
            $comment->task_id = $tasks->random()->id;
            $comment->user_id = $allUsers->random()->id;
            $comment->save();
        });

        foreach ($tasks->take(3) as $index => $task) {
            TaskAttachment::create([
                'task_id' => $task->id,
                'file_name' => "sample-spec-v1-{$index}.pdf",
                'file_path' => "attachments/tasks/{$task->id}/sample-spec-v1-{$index}.pdf",
                'file_size' => 1024 * rand(100, 900),
                'mime_type' => 'application/pdf',
                'version' => 1,
            ]);
        }
    }
}