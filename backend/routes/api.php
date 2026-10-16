<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\TaskAttachmentController;
use App\Http\Controllers\Api\TaskController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login', [AuthController::class, 'login']);

Route::middleware('auth:api')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    Route::get('/tasks', [TaskController::class, 'index']);
    Route::get('/tasks/{id}', [TaskController::class, 'show']);
    Route::post('/tasks', [TaskController::class, 'store']);
    Route::put('/tasks/{id}', [TaskController::class, 'update']);
    Route::delete('/tasks/{id}', [TaskController::class, 'destroy']);

    Route::post('/tasks/{id}/attachments', [TaskAttachmentController::class, 'store']);
    Route::post('/tasks/{id}/attachments/chunk', [TaskAttachmentController::class, 'chunkUpload']);
    Route::post('/tasks/bulk-status', [TaskController::class, 'bulkUpdateStatus']);
    Route::post('/tasks/export', [TaskController::class, 'exportReport']);
    Route::get('/tasks/{id}/attachments/versions', [TaskAttachmentController::class, 'versions']);
    Route::get('/attachments/{id}/download', [TaskAttachmentController::class, 'download']);
    Route::delete('/attachments/{id}', [TaskAttachmentController::class, 'destroy']);

    Route::get('/users', [TaskController::class, 'users']);
    Route::post('/tasks/{id}/comments', [TaskController::class, 'storeComment']);

    Route::post('/tasks/bulk-status', [TaskController::class, 'bulkUpdateStatus']);
    Route::post('/tasks/export', [TaskController::class, 'exportReport']);
    Route::get('/tasks/exports/{fileName}', [TaskController::class, 'downloadExport']);

});