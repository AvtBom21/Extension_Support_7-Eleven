<?php
// ─── Security helper ─────────────────────────────────────────────────────────
function safePath(string $base, string $sub): string|false {
    $real = realpath($base . DIRECTORY_SEPARATOR . $sub);
    if (!$real) return false;
    $realBase = realpath($base);
    if (!$realBase) return false;
    return str_starts_with($real, $realBase . DIRECTORY_SEPARATOR) ? $real : false;
}

// ─── Resolve __MSG_ placeholders from _locales ───────────────────────────────
function resolveMsg(string $text, string $dir): string {
    if (!preg_match('/^__MSG_(.+)__$/', $text, $m)) return $text;
    $key = strtolower($m[1]);
    foreach (['en', 'en_US', 'vi', 'zh_CN', 'ja'] as $locale) {
        $f = $dir . "/_locales/$locale/messages.json";
        if (!file_exists($f)) continue;
        $msgs = json_decode(file_get_contents($f), true) ?? [];
        if (isset($msgs[$key]['message'])) return $msgs[$key]['message'];
    }
    return basename($dir);
}

// ─── Folder utilities ────────────────────────────────────────────────────────
function folderSize(string $dir): int {
    $size = 0;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS)
    );
    foreach ($it as $f) if ($f->isFile()) $size += $f->getSize();
    return $size;
}

function fmtSize(int $bytes): string {
    if ($bytes >= 1_048_576) return number_format($bytes / 1_048_576, 1) . ' MB';
    if ($bytes >= 1_024)     return number_format($bytes / 1_024, 0) . ' KB';
    return $bytes . ' B';
}

// ─── HANDLE: icon proxy ───────────────────────────────────────────────────────
if (isset($_GET['icon'])) {
    $parts = explode('/', urldecode($_GET['icon']), 2);
    if (count($parts) === 2) {
        $folder = basename($parts[0]);
        $iconSub = ltrim($parts[1], '/\\');
        $basePath = __DIR__ . DIRECTORY_SEPARATOR . $folder;
        $iconPath = safePath($basePath, $iconSub);
        if ($iconPath && file_exists($iconPath)) {
            $ext = strtolower(pathinfo($iconPath, PATHINFO_EXTENSION));
            $mimes = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg',
                      'gif'=>'image/gif','svg'=>'image/svg+xml','webp'=>'image/webp'];
            header('Content-Type: ' . ($mimes[$ext] ?? 'image/png'));
            header('Cache-Control: public, max-age=86400');
            readfile($iconPath);
            exit;
        }
    }
    http_response_code(404); exit;
}

// ─── HANDLE: download as ZIP ─────────────────────────────────────────────────
if (isset($_GET['download'])) {
    $folder = basename(urldecode($_GET['download']));
    $extDir = __DIR__ . DIRECTORY_SEPARATOR . $folder;

    if (!is_dir($extDir) || str_starts_with($folder, '.')) {
        http_response_code(404); exit('Extension not found.');
    }

    if (!class_exists('ZipArchive')) {
        http_response_code(500); exit('ZipArchive không khả dụng trên server này.');
    }

    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . uniqid('ext_') . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        http_response_code(500); exit('Không thể tạo file ZIP.');
    }

    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($extDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $file) {
        if ($file->isFile()) {
            $rel = $folder . DIRECTORY_SEPARATOR . substr($file->getRealPath(), strlen($extDir) + 1);
            $zip->addFile($file->getRealPath(), $rel);
        }
    }
    $zip->close();

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $folder . '.zip"');
    header('Content-Length: ' . filesize($tmp));
    header('Cache-Control: no-cache');
    readfile($tmp);
    @unlink($tmp);
    exit;
}

// ─── SCAN extensions ─────────────────────────────────────────────────────────
$extensions = [];
$dirs = glob(__DIR__ . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR);

foreach ($dirs ?: [] as $dir) {
    $folderName = basename($dir);
    if (str_starts_with($folderName, '.')) continue;

    $info = [
        'folder'           => $folderName,
        'name'             => $folderName,
        'description'      => '',
        'version'          => '',
        'manifest_version' => null,
        'icon'             => null,
        'size'             => folderSize($dir),
    ];

    $manifestFile = $dir . DIRECTORY_SEPARATOR . 'manifest.json';
    if (file_exists($manifestFile)) {
        $mData = json_decode(file_get_contents($manifestFile), true) ?? [];
        $info['name']             = resolveMsg($mData['name'] ?? $folderName, $dir);
        $info['description']      = resolveMsg($mData['description'] ?? '', $dir);
        $info['version']          = $mData['version'] ?? '';
        $info['manifest_version'] = $mData['manifest_version'] ?? null;

        // Find best icon
        if (!empty($mData['icons']) && is_array($mData['icons'])) {
            krsort($mData['icons']); // prefer larger sizes
            foreach ($mData['icons'] as $iconPath) {
                $candidate = $dir . DIRECTORY_SEPARATOR . ltrim($iconPath, '/\\');
                if (file_exists($candidate)) {
                    $info['icon'] = $folderName . '/' . ltrim($iconPath, '/\\');
                    break;
                }
            }
        }
        // Fallback: check action/browser_action icon
        if (!$info['icon']) {
            $actionIcons = $mData['action']['default_icon']
                        ?? $mData['browser_action']['default_icon']
                        ?? null;
            if (is_array($actionIcons)) {
                krsort($actionIcons);
                foreach ($actionIcons as $p) {
                    $candidate = $dir . DIRECTORY_SEPARATOR . ltrim($p, '/\\');
                    if (file_exists($candidate)) {
                        $info['icon'] = $folderName . '/' . ltrim($p, '/\\');
                        break;
                    }
                }
            } elseif (is_string($actionIcons)) {
                $candidate = $dir . DIRECTORY_SEPARATOR . ltrim($actionIcons, '/\\');
                if (file_exists($candidate)) $info['icon'] = $folderName . '/' . ltrim($actionIcons, '/\\');
            }
        }
    }

    $extensions[] = $info;
}

usort($extensions, fn($a, $b) => mb_strtolower($a['name']) <=> mb_strtolower($b['name']));
$total = count($extensions);
$totalSize = array_sum(array_column($extensions, 'size'));
?>
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Extension Library</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Figtree:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #07080E;
  --surface:  #0D0F1A;
  --card:     #10121E;
  --card-h:   #141728;
  --border:   rgba(255,255,255,0.07);
  --border-h: rgba(255,255,255,0.14);
  --text:     #DDE1F4;
  --muted:    #5B5F7A;
  --accent:   #5A74FF;
  --accent2:  #8B9FFF;
  --green:    #2ECC89;
  --green-bg: rgba(46,204,137,0.1);
  --green-h:  rgba(46,204,137,0.18);
  --mv2:      #F5A623;
  --mv2-bg:   rgba(245,166,35,0.12);
  --mv3:      #34C7FF;
  --mv3-bg:   rgba(52,199,255,0.12);
  --rad:      14px;
  --rad-sm:   8px;
}

html { scroll-behavior: smooth; }
body {
  font-family: 'Figtree', sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.6;
}

/* ── Noise texture overlay ── */
body::before {
  content: '';
  position: fixed; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none; z-index: 0; opacity: 0.4;
}

/* ── Layout ── */
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; position: relative; z-index: 1; }

/* ── Header ── */
header {
  padding: 56px 0 40px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 40px;
}
.header-inner { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.logo { display: flex; align-items: center; gap: 14px; }
.logo-icon {
  width: 48px; height: 48px;
  background: linear-gradient(135deg, #5A74FF 0%, #8B60FF 100%);
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 32px rgba(90,116,255,0.4);
  flex-shrink: 0;
}
.logo-icon svg { width: 26px; height: 26px; }
.logo-text h1 {
  font-family: 'Syne', sans-serif;
  font-size: 28px; font-weight: 800;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, #DDE1F4 0%, #7B90FF 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.logo-text p { color: var(--muted); font-size: 14px; margin-top: 2px; }

.stats { display: flex; gap: 24px; }
.stat { text-align: right; }
.stat-val {
  font-family: 'Syne', sans-serif;
  font-size: 22px; font-weight: 700;
  color: var(--accent2);
}
.stat-lbl { font-size: 12px; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }

/* ── Search ── */
.search-row { margin-bottom: 32px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.search-wrap {
  flex: 1; min-width: 240px;
  position: relative;
}
.search-wrap svg {
  position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
  width: 18px; height: 18px; color: var(--muted); pointer-events: none;
}
#search {
  width: 100%; height: 44px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--rad-sm);
  color: var(--text);
  font-family: 'Figtree', sans-serif;
  font-size: 14px;
  padding: 0 16px 0 42px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
#search:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(90,116,255,0.15);
}
#search::placeholder { color: var(--muted); }

.filter-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-btn {
  height: 36px; padding: 0 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--muted);
  font-family: 'Figtree', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 0.18s;
}
.filter-btn:hover { border-color: var(--border-h); color: var(--text); }
.filter-btn.active {
  background: rgba(90,116,255,0.15);
  border-color: var(--accent);
  color: var(--accent2);
}

/* ── Empty state ── */
#empty {
  display: none;
  text-align: center;
  padding: 80px 24px;
  color: var(--muted);
}
#empty svg { width: 56px; height: 56px; margin-bottom: 16px; opacity: 0.3; }
#empty p { font-size: 15px; }

/* ── Cards grid ── */
#grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding-bottom: 64px;
}

.ext-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--rad);
  padding: 20px;
  display: flex; flex-direction: column; gap: 14px;
  transition: background 0.2s, border-color 0.2s, transform 0.2s, box-shadow 0.2s;
  animation: fadeUp 0.35s ease both;
}
.ext-card:hover {
  background: var(--card-h);
  border-color: var(--border-h);
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Card header ── */
.card-head { display: flex; gap: 14px; align-items: flex-start; }
.ext-icon {
  width: 52px; height: 52px; flex-shrink: 0;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.ext-icon img { width: 100%; height: 100%; object-fit: contain; }
.ext-icon svg { width: 28px; height: 28px; opacity: 0.25; }
.card-title { flex: 1; min-width: 0; }
.card-title h3 {
  font-size: 15px; font-weight: 600;
  color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.3;
  margin-bottom: 6px;
}
.badges { display: flex; gap: 5px; flex-wrap: wrap; }
.badge {
  display: inline-flex; align-items: center;
  height: 20px; padding: 0 7px;
  border-radius: 4px;
  font-size: 11px; font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.02em;
}
.badge-ver { background: rgba(90,116,255,0.12); color: var(--accent2); }
.badge-mv2 { background: var(--mv2-bg); color: var(--mv2); }
.badge-mv3 { background: var(--mv3-bg); color: var(--mv3); }

/* ── Description ── */
.ext-desc {
  font-size: 13px; color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.55;
  min-height: 40px;
}

/* ── Meta row ── */
.card-meta {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--muted);
  font-family: 'JetBrains Mono', monospace;
}
.meta-folder {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 55%;
}

/* ── Download button ── */
.btn-dl {
  display: flex; align-items: center; gap: 8px;
  width: 100%; height: 40px;
  background: var(--green-bg);
  border: 1px solid rgba(46,204,137,0.2);
  border-radius: var(--rad-sm);
  color: var(--green);
  font-family: 'Figtree', sans-serif;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  justify-content: center;
  transition: background 0.18s, border-color 0.18s, transform 0.12s;
}
.btn-dl:hover {
  background: var(--green-h);
  border-color: rgba(46,204,137,0.4);
}
.btn-dl:active { transform: scale(0.98); }
.btn-dl svg { width: 15px; height: 15px; }

/* ── Count bar ── */
.count-bar {
  font-size: 13px; color: var(--muted);
  margin-bottom: 16px;
}
.count-bar span { color: var(--accent2); font-weight: 600; }

/* ── Footer ── */
footer {
  border-top: 1px solid var(--border);
  padding: 24px 0;
  text-align: center;
  font-size: 12px; color: var(--muted);
}

/* ── Responsive ── */
@media (max-width: 600px) {
  header { padding: 36px 0 28px; }
  .header-inner { flex-direction: column; align-items: flex-start; gap: 16px; }
  .stats { gap: 20px; }
}
</style>
</head>
<body>
<div class="wrap">

<!-- ── Header ── -->
<header>
  <div class="header-inner">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </div>
      <div class="logo-text">
        <h1>Extension Library</h1>
        <p>Kho Chrome Extensions — Tải về &amp; Cài đặt</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-val"><?= $total ?></div>
        <div class="stat-lbl">Extensions</div>
      </div>
      <div class="stat">
        <div class="stat-val"><?= fmtSize($totalSize) ?></div>
        <div class="stat-lbl">Tổng dung lượng</div>
      </div>
    </div>
  </div>
</header>

<!-- ── Search & Filter ── -->
<div class="search-row">
  <div class="search-wrap">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input type="text" id="search" placeholder="Tìm kiếm extension…" autocomplete="off" oninput="filterCards()">
  </div>
  <div class="filter-btns">
    <button class="filter-btn active" onclick="setFilter('all', this)">Tất cả</button>
    <button class="filter-btn" onclick="setFilter('mv3', this)">Manifest v3</button>
    <button class="filter-btn" onclick="setFilter('mv2', this)">Manifest v2</button>
  </div>
</div>

<!-- ── Count bar ── -->
<div class="count-bar" id="countBar">
  Hiển thị <span id="shownCount"><?= $total ?></span> / <?= $total ?> extensions
</div>

<!-- ── Card grid ── -->
<div id="grid">
<?php foreach ($extensions as $i => $ext): ?>
  <div class="ext-card"
       data-name="<?= htmlspecialchars(mb_strtolower($ext['name']), ENT_QUOTES) ?>"
       data-desc="<?= htmlspecialchars(mb_strtolower($ext['description']), ENT_QUOTES) ?>"
       data-folder="<?= htmlspecialchars(mb_strtolower($ext['folder']), ENT_QUOTES) ?>"
       data-mv="<?= (int)$ext['manifest_version'] ?>"
       style="animation-delay: <?= min($i * 30, 300) ?>ms">

    <!-- Icon + Title -->
    <div class="card-head">
      <div class="ext-icon">
        <?php if ($ext['icon']): ?>
          <img src="?icon=<?= urlencode($ext['icon']) ?>"
               alt=""
               onerror="this.parentNode.innerHTML='<svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.32 2.498l-1.144-.275-.003-.001A9 9 0 0112 18.75 9 9 0 014.265 18.924l-1.144.275c-1.35.3-2.32-1.498-1.32-2.498L3.2 15.3\'/>\'</svg>'"
               loading="lazy">
        <?php else: ?>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.32 2.498l-1.144-.275A9 9 0 0112 18.75 9 9 0 014.265 18.924l-1.144.275c-1.35.3-2.32-1.498-1.32-2.498L3.2 15.3"/>
          </svg>
        <?php endif; ?>
      </div>
      <div class="card-title">
        <h3 title="<?= htmlspecialchars($ext['name'], ENT_QUOTES) ?>"><?= htmlspecialchars($ext['name']) ?></h3>
        <div class="badges">
          <?php if ($ext['version']): ?>
            <span class="badge badge-ver">v<?= htmlspecialchars($ext['version']) ?></span>
          <?php endif; ?>
          <?php if ($ext['manifest_version'] == 3): ?>
            <span class="badge badge-mv3">MV3</span>
          <?php elseif ($ext['manifest_version'] == 2): ?>
            <span class="badge badge-mv2">MV2</span>
          <?php endif; ?>
        </div>
      </div>
    </div>

    <!-- Description -->
    <p class="ext-desc"><?= $ext['description'] ? htmlspecialchars($ext['description']) : '<em style="opacity:.5">Không có mô tả</em>' ?></p>

    <!-- Meta -->
    <div class="card-meta">
      <span class="meta-folder" title="<?= htmlspecialchars($ext['folder'], ENT_QUOTES) ?>">
        📁 <?= htmlspecialchars($ext['folder']) ?>
      </span>
      <span><?= fmtSize($ext['size']) ?></span>
    </div>

    <!-- Download -->
    <a class="btn-dl" href="?download=<?= urlencode($ext['folder']) ?>">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Tải về ZIP
    </a>
  </div>
<?php endforeach; ?>
</div>

<!-- ── Empty state ── -->
<div id="empty">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
  <p>Không tìm thấy extension nào phù hợp.</p>
</div>

</div><!-- .wrap -->

<footer>
  <div class="wrap">
    Extension Library &mdash; <?= $total ?> extensions &mdash; <?= fmtSize($totalSize) ?> &mdash;
    Tải file ZIP → giải nén → Chrome: <code>chrome://extensions</code> → Developer mode → Load unpacked
  </div>
</footer>

<script>
let activeFilter = 'all';

function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterCards();
}

function filterCards() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const cards = document.querySelectorAll('.ext-card');
  let shown = 0;

  cards.forEach(card => {
    const mv = parseInt(card.dataset.mv) || 0;
    const matchFilter =
      activeFilter === 'all' ||
      (activeFilter === 'mv3' && mv === 3) ||
      (activeFilter === 'mv2' && mv === 2);

    const matchSearch = !q ||
      card.dataset.name.includes(q) ||
      card.dataset.desc.includes(q) ||
      card.dataset.folder.includes(q);

    const visible = matchFilter && matchSearch;
    card.style.display = visible ? '' : 'none';
    if (visible) shown++;
  });

  document.getElementById('shownCount').textContent = shown;
  document.getElementById('empty').style.display = shown === 0 ? 'block' : 'none';
  document.getElementById('grid').style.display = shown === 0 ? 'none' : '';
}
</script>
</body>
</html>