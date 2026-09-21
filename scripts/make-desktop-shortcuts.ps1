<#
  SJ INVEST — 바탕화면 배포 런처 만들기.

  scripts 폴더의 deploy-web.bat / deploy-app.bat 을 가리키는 바로가기를
  바탕화면에 만든다. .bat 파일은 자기 위치에서 프로젝트 폴더를 스스로 찾으므로
  (%~dp0..), 바로가기만 있으면 어디서 눌러도 동작한다.

  .bat 파일 자체를 바탕화면으로 복사하면 안 된다 — 프로젝트 폴더를 못 찾는다.

  실행: scripts 폴더의 make-desktop-shortcuts.bat 을 더블클릭.
  새 PC를 세팅하거나 바탕화면 아이콘을 지웠을 때 다시 돌리면 된다.
#>

$ErrorActionPreference = 'Stop'

# 이 스크립트는 scripts 폴더 안에 있다. 프로젝트 폴더는 그 위.
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = Split-Path -Parent $scriptDir
$desktop = [Environment]::GetFolderPath('Desktop')
$icon = Join-Path $root 'build\icon.ico'

Write-Host ''
Write-Host '============================================'
Write-Host '  SJ INVEST - 바탕화면 런처 만들기'
Write-Host '============================================'
Write-Host ''
Write-Host "프로젝트 폴더 : $root"
Write-Host "바탕화면      : $desktop"
Write-Host ''

$shell = New-Object -ComObject WScript.Shell
$made = 0

function New-Launcher([string]$Name, [string]$Bat, [string]$Note) {
    $target = Join-Path $scriptDir $Bat
    if (-not (Test-Path $target)) {
        Write-Host "[건너뜀] $Name : $Bat 를 찾지 못했습니다." -ForegroundColor Yellow
        return $false
    }
    $linkPath = Join-Path $desktop ($Name + '.lnk')
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $target
    $link.WorkingDirectory = $root
    $link.Description = $Note
    if (Test-Path $icon) { $link.IconLocation = $icon }
    $link.Save()
    Write-Host "[완료] $Name" -ForegroundColor Green
    return $true
}

if (New-Launcher 'SJ OS 웹 배포' 'deploy-web.bat' '모바일 웹(PWA)을 빌드해 Cloudflare Pages 로 올립니다.') { $made++ }
if (New-Launcher 'SJ OS 앱 배포' 'deploy-app.bat' 'PC 데스크톱 설치본(.exe)을 만듭니다.') { $made++ }

Write-Host ''
if ($made -gt 0) {
    Write-Host "바탕화면에 런처 $made 개를 만들었습니다. 아이콘이 안 보이면 바탕화면에서 F5 를 누르세요."
} else {
    Write-Host '만들어진 런처가 없습니다. scripts 폴더에 .bat 파일이 있는지 확인하세요.' -ForegroundColor Yellow
}
Write-Host ''
Read-Host '엔터를 누르면 닫힙니다'
