#Requires -Version 5.1
<#
.SYNOPSIS
  Permanent fix: live JSON on github.io + Pages deploy after every ingest.

.EXAMPLE
  cd C:\Users\Mike\dev\hantavirus-dashboard
  powershell -ExecutionPolicy Bypass -File .\scripts\Apply-PermanentPagesFix.ps1
#>
param([switch]$NoPush)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if (-not (Test-Path '.git')) { throw 'Not a git repo.' }

git checkout main | Out-Null
git pull origin main --rebase
if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }

$utf8 = New-Object System.Text.UTF8Encoding $false

$loadData = @'
import type { CasesFile, NewsFile, RedditIntelFile } from './types'

const LIVE_DATA_REPO = 'Beastros/hantavirus-dashboard'
const LIVE_DATA_BRANCH = 'main'

function basePath(): string {
  const base = import.meta.env.BASE_URL
  return base.endsWith('/') ? base : `${base}/`
}

function isGithubPages(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname.endsWith('.github.io')
}

function dataJsonUrl(file: string): string {
  if (isGithubPages()) {
    return `https://cdn.jsdelivr.net/gh/${LIVE_DATA_REPO}@${LIVE_DATA_BRANCH}/public/data/${file}`
  }
  return `${basePath()}data/${file}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const bust = url.includes('?') ? `&_=${Date.now()}` : `?_=${Date.now()}`
  const res = await fetch(`${url}${bust}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return res.json() as Promise<T>
}

export function loadCases(): Promise<CasesFile> {
  return fetchJson<CasesFile>(dataJsonUrl('cases.json'))
}
export function loadNews(): Promise<NewsFile> {
  return fetchJson<NewsFile>(dataJsonUrl('news.json'))
}
export function loadRedditIntel(): Promise<RedditIntelFile> {
  return fetchJson<RedditIntelFile>(dataJsonUrl('reddit_hot.json'))
}
export function loadIndividualCases(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('cases-individual.json'))
}
export function loadIngestStatus(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('ingest-status.json'))
}
export function loadShipPosition(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('ship-position.json'))
}

export type ShipTrackPoint = {
  t?: string
  lat: number
  lng: number
  source?: string
  note?: string
}

export function loadShipTrack(): Promise<{ updated?: string; mmsi?: string; points: ShipTrackPoint[] }> {
  return fetchJson(dataJsonUrl('ship-track.json'))
}
export function loadTrends(): Promise<any> {
  return fetchJson<any>(dataJsonUrl('trends.json'))
}
'@

$ingestYml = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot '.github\workflows\ingest.yml') -ErrorAction SilentlyContinue
if ($ingestYml -notmatch 'publish-pages:') {
  $ingestPath = Join-Path $RepoRoot '.github\workflows\ingest.yml'
  $ingestNew = @'
name: Ingest RSS + AI extraction
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

concurrency:
  group: ingest-main
  cancel-in-progress: false

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  ingest:
    runs-on: ubuntu-latest
    env:
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install dependencies
        run: pip install -r ingest/requirements.txt
      - name: Mirror r/hantavirus intel (hot + new)
        continue-on-error: true
        working-directory: ingest
        env:
          REDDIT_SUBREDDIT: hantavirus
          REDDIT_HOT_LIMIT: '18'
        run: python reddit_hot.py
      - name: Run ingest (RSS + AI)
        continue-on-error: true
        working-directory: ingest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          AIS_API_KEY: ${{ secrets.AIS_API_KEY }}
        run: python run.py
      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          date -u +%Y-%m-%dT%H:%M:%SZ > public/data/last-build.txt
          git add public/data/
          git commit -m "chore: ingest refresh" || echo "[info] nothing to commit"
          git fetch origin main
          git pull --rebase origin main
          git push origin main

  publish-pages:
    needs: ingest
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: package-lock.json
      - name: Install and build
        env:
          GITHUB_REPOSITORY: ${{ github.repository }}
          VITE_MAPBOX_TOKEN: ${{ secrets.VITE_MAPBOX_TOKEN }}
        run: |
          npm ci
          npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
        id: deployment
'@
  [System.IO.File]::WriteAllText($ingestPath, $ingestNew.TrimEnd() + "`n", $utf8)
  Write-Host 'Updated ingest.yml (publish-pages job)' -ForegroundColor Cyan
} else {
  Write-Host 'ingest.yml already has publish-pages' -ForegroundColor Green
}

$pagesPath = Join-Path $RepoRoot '.github\workflows\pages.yml'
$pagesNew = @'
name: GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: package-lock.json
      - name: Install and build
        env:
          GITHUB_REPOSITORY: ${{ github.repository }}
          VITE_MAPBOX_TOKEN: ${{ secrets.VITE_MAPBOX_TOKEN }}
        run: |
          npm ci
          echo "Token present: ${{ secrets.VITE_MAPBOX_TOKEN != '' }}"
          npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
'@
$pagesCur = Get-Content -Raw -LiteralPath $pagesPath -ErrorAction SilentlyContinue
if ($pagesCur -match 'workflow_run:') {
  [System.IO.File]::WriteAllText($pagesPath, $pagesNew.TrimEnd() + "`n", $utf8)
  Write-Host 'Updated pages.yml (removed broken workflow_run)' -ForegroundColor Cyan
}

[System.IO.File]::WriteAllText((Join-Path $RepoRoot 'src\loadData.ts'), $loadData.TrimEnd() + "`n", $utf8)
Write-Host 'Updated src/loadData.ts (live JSON from main via jsDelivr)' -ForegroundColor Cyan

git add src/loadData.ts .github/workflows/ingest.yml .github/workflows/pages.yml scripts/Apply-PermanentPagesFix.ps1
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Nothing to commit — fix may already be applied.' -ForegroundColor Yellow
  exit 0
}

git commit -m 'fix(pages): live data from main + deploy after each ingest'
if ($NoPush) {
  Write-Host 'Committed. Run: git push origin main' -ForegroundColor Yellow
  exit 0
}
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
Write-Host 'Done. GitHub Pages will build on push; every ingest will redeploy after that.' -ForegroundColor Green
