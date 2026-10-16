<?php

namespace App\Services;

use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class FileUploadService
{
    /**
     * Daftar MIME type yang diizinkan beserta batas ukuran (dalam bytes)
     */
    private const ALLOWED_CATEGORIES = [
        'image' => [
            'mimes' => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            'max_bytes' => 10 * 1024 * 1024, // 10 MB
        ],
        'document' => [
            'mimes' => [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/plain',
                'text/csv',
            ],
            'max_bytes' => 25 * 1024 * 1024, // 25 MB
        ],
        'video' => [
            'mimes' => ['video/mp4', 'video/webm'],
            'max_bytes' => 100 * 1024 * 1024, // 100 MB
        ],
    ];

    protected function publicDisk(): FilesystemAdapter
    {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk;
    }

    /**
     * Validasi kategori, ekstensi ganda, dan batas ukuran per jenis file
     */
    public function validateFileRules(UploadedFile $file): void
    {
        $originalName = $file->getClientOriginalName();

        // Cegah double extension berbahaya (misal: shell.php.jpg)
        if (preg_match('/\.(php|phtml|phar|exe|sh|bat|cmd)\./i', $originalName)) {
            throw new RuntimeException('Nama file mengandung ekstensi ganda yang dilarang.');
        }

        $mime = $file->getMimeType() ?: $file->getClientMimeType();
        $size = $file->getSize();

        foreach (self::ALLOWED_CATEGORIES as $category => $rules) {
            if (in_array($mime, $rules['mimes'], true)) {
                if ($size > $rules['max_bytes']) {
                    $maxMb = $rules['max_bytes'] / (1024 * 1024);
                    throw new RuntimeException("Ukuran file kategori {$category} melebihi batas maksimal {$maxMb} MB.");
                }

                return;
            }
        }

        throw new RuntimeException("Tipe file ({$mime}) tidak didukung oleh sistem.");
    }

    /**
     * Simulasi pemindaian virus (EICAR signature & injeksi script PHP di dalam file non-kode)
     */
    public function simulateVirusScan(string $absoluteFilePath): array
    {
        if (! is_readable($absoluteFilePath)) {
            throw new RuntimeException('File tidak dapat dibaca untuk pemindaian keamanan.');
        }

        // Baca 64 KB pertama untuk efisiensi memori pada file besar
        $handle = fopen($absoluteFilePath, 'rb');
        $sampleContent = fread($handle, 65536) ?: '';
        fclose($handle);

        $eicarSignature = 'X5O!P%@AP[4\ZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

        if (str_contains($sampleContent, $eicarSignature)) {
            return [
                'clean' => false,
                'threat' => 'EICAR-Test-Signature',
            ];
        }

        if (str_contains($sampleContent, '<?php') || str_contains($sampleContent, '<?= ')) {
            return [
                'clean' => false,
                'threat' => 'Embedded-PHP-Payload',
            ];
        }

        return [
            'clean' => true,
            'threat' => null,
        ];
    }

    /**
     * Buat thumbnail proporsional (maks 300x300 px) untuk file gambar menggunakan PHP GD
     */
    public function createImageThumbnail(string $storedFilePath, int $taskId, string $fileName): ?string
    {
        if (! extension_loaded('gd')) {
            return null;
        }

        $sourceFullPath = $this->publicDisk()->path($storedFilePath);
        $imageInfo = @getimagesize($sourceFullPath);

        if (! $imageInfo) {
            return null;
        }

        [$origWidth, $origHeight, $imageType] = $imageInfo;
        $rawContent = @file_get_contents($sourceFullPath);
        $sourceImage = $rawContent ? @imagecreatefromstring($rawContent) : false;

        if (! $sourceImage) {
            return null;
        }

        $maxDim = 300;
        $ratio = min($maxDim / max($origWidth, 1), $maxDim / max($origHeight, 1), 1);
        $targetWidth = max(1, (int) round($origWidth * $ratio));
        $targetHeight = max(1, (int) round($origHeight * $ratio));

        $thumbCanvas = imagecreatetruecolor($targetWidth, $targetHeight);

        // Pertahankan transparansi untuk PNG & WebP
        if (in_array($imageType, [IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) {
            imagealphablending($thumbCanvas, false);
            imagesavealpha($thumbCanvas, true);
        }

        imagecopyresampled(
            $thumbCanvas,
            $sourceImage,
            0,
            0,
            0,
            0,
            $targetWidth,
            $targetHeight,
            $origWidth,
            $origHeight
        );

        $thumbRelativeDir = "task_files/{$taskId}/thumbnails";
        $this->publicDisk()->makeDirectory($thumbRelativeDir);

        $thumbRelativePath = "{$thumbRelativeDir}/thumb_{$fileName}";
        $thumbFullPath = $this->publicDisk()->path($thumbRelativePath);

        match ($imageType) {
            IMAGETYPE_PNG => imagepng($thumbCanvas, $thumbFullPath, 8),
            IMAGETYPE_WEBP => imagewebp($thumbCanvas, $thumbFullPath, 80),
            IMAGETYPE_GIF => imagegif($thumbCanvas, $thumbFullPath),
            default => imagejpeg($thumbCanvas, $thumbFullPath, 82),
        };

        imagedestroy($sourceImage);
        imagedestroy($thumbCanvas);

        return $thumbRelativePath;
    }
}