# Installs the t3tui binary from GitHub Releases:
#   irm https://raw.githubusercontent.com/callumalpass/t3tui/main/install.ps1 | iex
# T3TUI_INSTALL_DIR picks where it goes (default %LOCALAPPDATA%\Programs\t3tui); T3TUI_VERSION picks a release (e.g. 0.1.0).
# Run through iex, so it throws rather than exits: exit would close the terminal.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 may not offer TLS 1.2 by default.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repo = 'callumalpass/t3tui'
  $dir = if ($env:T3TUI_INSTALL_DIR) { $env:T3TUI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\t3tui' }
  # Windows on Arm runs the x64 build under emulation.
  $file = 't3tui-windows-x64.exe.gz'
  $base = if ($env:T3TUI_VERSION) { "https://github.com/$repo/releases/download/v$($env:T3TUI_VERSION -replace '^v', '')" } else { "https://github.com/$repo/releases/latest/download" }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Write-Host "Downloading $file..."
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile "$tmp\$file"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile "$tmp\SHA256SUMS"

    $listed = Get-Content "$tmp\SHA256SUMS" | Where-Object { ($_ -split '\s+\*?')[1] -eq $file } | Select-Object -First 1
    $expected = if ($listed) { ($listed -split '\s+')[0] } else { $null }
    $actual = (Get-FileHash -Algorithm SHA256 "$tmp\$file").Hash
    if (-not $expected -or $expected -ne $actual) { throw "$file doesn't match its checksum; nothing was installed" }

    $source = [IO.File]::OpenRead("$tmp\$file")
    $target = [IO.File]::Create("$tmp\t3tui.exe")
    try {
      $gunzip = New-Object IO.Compression.GZipStream($source, [IO.Compression.CompressionMode]::Decompress)
      $gunzip.CopyTo($target)
    } finally {
      $target.Dispose()
      $source.Dispose()
    }

    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    # A running t3tui can't be replaced, but it can be moved aside; it removes that copy on its next start.
    $exe = Join-Path $dir 't3tui.exe'
    if (Test-Path $exe) { Move-Item -Force $exe "$exe.old-$PID" }
    Move-Item "$tmp\t3tui.exe" $exe
    Write-Host "Installed $(& $exe version) to $exe"

    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (($path -split ';') -notcontains $dir) {
      [Environment]::SetEnvironmentVariable('Path', ($(if ($path) { "$path;$dir" } else { $dir })), 'User')
      $env:Path = "$env:Path;$dir"
      Write-Host "Added $dir to your PATH. Terminals already open need a restart to see it."
    }
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
