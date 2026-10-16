<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class TaskFactory extends Factory
{
    public function definition(): array
    {
        return [
            'title' => fake()->sentence(4),
            'description' => fake()->paragraph(2),
            'status' => fake()->randomElement(['pending', 'in_progress', 'completed', 'cancelled']),
            'priority' => fake()->randomElement(['low', 'medium', 'high', 'urgent']),
            'assigned_user_id' => User::inRandomOrder()->value('id') ?? User::factory(),
            'created_by' => User::inRandomOrder()->value('id') ?? User::factory(),
            'due_date' => fake()->dateTimeBetween('-5 days', '+30 days'),
        ];
    }
}