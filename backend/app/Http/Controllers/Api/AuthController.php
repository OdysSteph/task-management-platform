<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PHPOpenSourceSaver\JWTAuth\JWTGuard;

class AuthController extends Controller
{
    /**
     * Helper agar IDE (Intelephense) mengenali method attempt(), logout(), dan factory()
     */
    protected function guard(): JWTGuard
    {
        /** @var JWTGuard $guard */
        $guard = auth('api');

        return $guard;
    }

    public function login(Request $request): JsonResponse
    {
        $input = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $jwtToken = $this->guard()->attempt($input);

        if (! $jwtToken) {
            return response()->json([
                'success' => false,
                'message' => 'Kredensial login tidak valid.',
            ], 401);
        }

        return response()->json([
            'success' => true,
            'message' => 'Autentikasi berhasil.',
            'data' => [
                'token' => $jwtToken,
                'type' => 'Bearer',
                'expires_in_seconds' => $this->guard()->factory()->getTTL() * 60,
                'profile' => $this->guard()->user(),
            ],
        ]);
    }

    public function me(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->guard()->user(),
        ]);
    }

    public function logout(): JsonResponse
    {
        $this->guard()->logout();

        return response()->json([
            'success' => true,
            'message' => 'Sesi pengguna telah diakhiri.',
        ]);
    }
}