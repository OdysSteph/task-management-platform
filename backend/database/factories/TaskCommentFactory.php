<?php

namespace Database\Factories;

use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class TaskCommentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'task_id' => Task::inRandomOrder()->value('id') ?? Task::factory(),
            'user_id' => User::inRandomOrder()->value('id') ?? User::factory(),
            'comment' => fake()->sentence(10),
            'created_at' => fake()->dateTimeBetween('-10 days', 'now'),
        ];
    }
}