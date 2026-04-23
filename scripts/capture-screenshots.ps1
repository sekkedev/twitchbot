# Capture screenshots of each page of a running TwitchBot window.
# Expects `npm run dev` to already be running (Electron window titled "TwitchBot").
# Produces 1280x800 PNGs under docs/screenshots/.

param(
    [string] $OutDir = "$PSScriptRoot\..\docs\screenshots",
    [int]    $Width  = 1280,
    [int]    $Height = 800
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
}
'@

function Find-MainWindow {
    for ($i = 0; $i -lt 30; $i++) {
        $p = Get-Process electron -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowTitle -eq 'TwitchBot' -and $_.MainWindowHandle -ne 0 } |
            Sort-Object -Property StartTime | Select-Object -First 1
        if ($p) { return $p }
        Start-Sleep -Milliseconds 500
    }
    throw "TwitchBot window not found after 15s"
}

function Capture-Window {
    param([IntPtr] $hwnd, [string] $path)
    # Capture only the client area so window chrome (title bar) is excluded for
    # predictable framing across themes / OS versions.
    $clientRect = New-Object Win32+RECT
    [void][Win32]::GetClientRect($hwnd, [ref] $clientRect)
    $topLeft = New-Object Win32+POINT
    $topLeft.X = 0; $topLeft.Y = 0
    [void][Win32]::ClientToScreen($hwnd, [ref] $topLeft)

    $w = $clientRect.Right - $clientRect.Left
    $h = $clientRect.Bottom - $clientRect.Top

    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($topLeft.X, $topLeft.Y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose(); $bmp.Dispose()
    Write-Host "saved $path ($w x $h)"
}

$proc = Find-MainWindow
$hwnd = $proc.MainWindowHandle
Write-Host "found window hwnd=$hwnd pid=$($proc.Id)"

# Restore (in case minimized) + resize + foreground.
[void][Win32]::ShowWindow($hwnd, 9)           # SW_RESTORE
Start-Sleep -Milliseconds 200
# Total window needs extra for the title/frame so client area hits Width x Height.
# We account for typical Windows 11 chrome: ~38px title, 2px borders. Tune if needed.
[void][Win32]::MoveWindow($hwnd, 100, 80, $Width + 16, $Height + 39, $true)
[void][Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 600

New-Item -Path $OutDir -ItemType Directory -Force | Out-Null

$pages = @(
    @{ key = '1'; name = '01-dashboard';  delayMs = 900 },
    @{ key = '2'; name = '02-commands';   delayMs = 700 },
    @{ key = '3'; name = '03-loyalty';    delayMs = 1000 },
    @{ key = '4'; name = '04-analytics';  delayMs = 1800 },
    @{ key = '5'; name = '05-settings';   delayMs = 900 }
)

foreach ($page in $pages) {
    [void][Win32]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait("%$($page.key)")
    Start-Sleep -Milliseconds $page.delayMs
    $out = Join-Path $OutDir "$($page.name).png"
    Capture-Window -hwnd $hwnd -path $out
}

Write-Host "done"
