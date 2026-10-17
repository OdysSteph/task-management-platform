<?php

namespace Tests\Unit;

use App\Services\FileUploadService;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\TestCase;
use RuntimeException;

class FileUploadServiceTest extends TestCase
{
    protected FileUploadService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new FileUploadService();
    }

    public function test_valid_image_passes_validation(): void
    {
        $file = UploadedFile::fake()->image('dashboard-preview.png', 400, 400)->size(500);

        $this->service->validateFileRules($file);
        $this->assertTrue(true);
    }

    public function test_double_extension_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('ekstensi ganda');

        $file = UploadedFile::fake()->create('exploit.php.jpg', 100, 'image/jpeg');
        $this->service->validateFileRules($file);
    }

    public function test_oversized_image_exceeding_10mb_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);

        $file = UploadedFile::fake()->create('huge-photo.jpg', 12000, 'image/jpeg');
        $this->service->validateFileRules($file);
    }

    public function test_virus_scanner_detects_eicar_signature(): void
    {
        $tempFile = tempnam(sys_get_temp_dir(), 'scan_');
        file_put_contents($tempFile, 'X5O!P%@AP[4\ZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

        $result = $this->service->simulateVirusScan($tempFile);
        @unlink($tempFile);

        $this->assertFalse($result['clean']);
        $this->assertSame('EICAR-Test-Signature', $result['threat']);
    }

    public function test_virus_scanner_passes_clean_document(): void
    {
        $tempFile = tempnam(sys_get_temp_dir(), 'clean_');
        file_put_contents($tempFile, 'Dokumen spesifikasi proyek normal tanpa payload berbahaya.');

        $result = $this->service->simulateVirusScan($tempFile);
        @unlink($tempFile);

        $this->assertTrue($result['clean']);
        $this->assertNull($result['threat']);
    }
}