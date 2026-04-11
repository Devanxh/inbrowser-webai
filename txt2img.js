/**
 * txt2img.js — Text-to-Image Studio Logic
 * Uses web-txt2img's Txt2ImgWorkerClient to run SD-Turbo / Janus-Pro-1B
 * entirely in the browser via WebGPU.
 */

import { Txt2ImgWorkerClient } from 'web-txt2img';

// ─── DOM References ────────────────────────────────────────────────────────────
const $webgpuWarning    = document.getElementById('webgpu-warning');
const $capWebgpu        = document.getElementById('cap-webgpu');
const $capF16           = document.getElementById('cap-f16');
const $modelStatusDot   = document.getElementById('t2i-model-status-dot');
const $modelName        = document.getElementById('t2i-model-name');
const $modelMeta        = document.getElementById('t2i-model-meta');
const $modelPills       = document.querySelectorAll('.model-pill');
const $prompt           = document.getElementById('t2i-prompt');
const $seed             = document.getElementById('t2i-seed');
const $randomizeBtn     = document.getElementById('t2i-randomize-btn');
const $generateBtn      = document.getElementById('t2i-generate-btn');
const $generateLabel    = document.getElementById('t2i-generate-label');
const $stopBtn          = document.getElementById('t2i-stop-btn');
const $progressArea     = document.getElementById('t2i-progress-area');
const $progressFill     = document.getElementById('t2i-progress-fill');
const $progressLabel    = document.getElementById('t2i-progress-label');
const $statusText       = document.getElementById('t2i-status-text');
const $speedText        = document.getElementById('t2i-speed-text');
const $errorEl          = document.getElementById('t2i-error');
const $errorText        = document.getElementById('t2i-error-text');
const $outputCard       = document.getElementById('t2i-output-card');
const $placeholder      = document.getElementById('t2i-placeholder');
const $shimmer          = document.getElementById('t2i-shimmer');
const $outputImg        = document.getElementById('t2i-output-img');
const $outputActions    = document.getElementById('t2i-output-actions');
const $outputMeta       = document.getElementById('t2i-output-meta');
const $downloadBtn      = document.getElementById('t2i-download-btn');
const $sidebarToggle    = document.getElementById('t2i-sidebar-toggle');
const $sidebar          = document.getElementById('t2i-sidebar');

// ─── State ─────────────────────────────────────────────────────────────────────
let client         = null;
let selectedModel  = 'sd-turbo';
let loadedModel    = null;   // which model is currently loaded
let isGenerating   = false;
let currentAbort   = null;
let currentBlobUrl = null;

// Download speed tracking
let _dlStart      = null;
let _dlLastBytes  = 0;
let _dlLastTime   = null;

// ─── Capability Detection ──────────────────────────────────────────────────────
async function detectCapabilities() {
  if (!client) return;
  try {
    const caps = await client.detect();

    $capWebgpu.textContent = caps.webgpu ? '✓ Supported' : '✗ Not available';
    $capWebgpu.style.color = caps.webgpu ? 'var(--success)' : 'var(--danger)';

    $capF16.textContent = caps.shaderF16 ? '✓ Supported' : '✗ Not available';
    $capF16.style.color = caps.shaderF16 ? 'var(--success)' : 'var(--text-muted)';

    if (!caps.webgpu) {
      $webgpuWarning.classList.add('visible');
      setGenerateEnabled(false);
    }
  } catch (e) {
    $capWebgpu.textContent = 'Unknown';
    $capF16.textContent    = 'Unknown';
  }
}

// ─── Model Pills ───────────────────────────────────────────────────────────────
$modelPills.forEach(pill => {
  pill.addEventListener('click', () => {
    if (isGenerating) return;
    $modelPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedModel = pill.dataset.model;
    // If a different model was loaded, mark as needing reload
    if (loadedModel && loadedModel !== selectedModel) {
      setModelStatus('idle', 'No model loaded', 'Select Generate to load ' + selectedModel);
      loadedModel = null;
    }
  });
});

// ─── Seed Randomize ────────────────────────────────────────────────────────────
$randomizeBtn.addEventListener('click', () => {
  $seed.value = Math.floor(Math.random() * 2147483647);
});

// ─── Progress Helpers ──────────────────────────────────────────────────────────
function setProgress(p = {}) {
  $progressArea.classList.add('visible');

  const pct = p.pct != null ? Math.round(p.pct) : null;

  // Fill bar
  if (pct != null) {
    $progressFill.style.width = pct + '%';
  } else {
    // Indeterminate — keep the shimmer going at ~20%
    $progressFill.style.width = '20%';
  }

  // Size string
  let sizeStr = '';
  if (p.bytesDownloaded != null && p.totalBytesExpected != null) {
    const dl   = (p.bytesDownloaded / 1024 / 1024).toFixed(1);
    const tot  = (p.totalBytesExpected / 1024 / 1024).toFixed(1);
    sizeStr    = ` (${dl} / ${tot} MB)`;

    // Speed tracking
    const now = Date.now();
    if (!_dlStart) { _dlStart = now; _dlLastTime = now; _dlLastBytes = p.bytesDownloaded; }
    const elapsed = (now - _dlLastTime) / 1000;
    if (elapsed > 0.8) {
      const bps = (p.bytesDownloaded - _dlLastBytes) / elapsed;
      _dlLastTime  = now;
      _dlLastBytes = p.bytesDownloaded;
      if (bps > 0) {
        const remaining = (p.totalBytesExpected - p.bytesDownloaded) / bps;
        $speedText.textContent = `${fmtSpeed(bps)} · ~${fmtTime(remaining)} left`;
      }
    }
  } else {
    $speedText.textContent = '';
  }

  // Label
  const pctStr = pct != null ? ` ${pct}%` : '';
  $progressLabel.textContent = `${p.message ?? p.phase ?? 'Working'}${pctStr}${sizeStr}`;
}

function hideProgress() {
  $progressArea.classList.remove('visible');
  $progressFill.style.width = '0%';
  _dlStart = null; _dlLastBytes = 0; _dlLastTime = null;
  $speedText.textContent = '';
}

function fmtSpeed(bps) {
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps > 1024)         return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function fmtTime(sec) {
  if (sec < 60)   return `${Math.ceil(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

// ─── Model Status ──────────────────────────────────────────────────────────────
function setModelStatus(state, name, meta) {
  $modelStatusDot.className = 'model-status-dot';
  if (state === 'ready')   $modelStatusDot.classList.add('ready');
  if (state === 'loading') $modelStatusDot.style.background = 'var(--gold)';
  $modelName.textContent = name;
  $modelMeta.textContent = meta;
}

// ─── UI Enable/Disable ─────────────────────────────────────────────────────────
function setGenerateEnabled(enabled) {
  $generateBtn.disabled = !enabled;
}

function setGeneratingUI(generating) {
  isGenerating = generating;
  $generateBtn.disabled = generating;
  $stopBtn.classList.toggle('visible', generating);
  $modelPills.forEach(p => { p.disabled = generating; });
}

// ─── Error ─────────────────────────────────────────────────────────────────────
function showError(msg) {
  $errorText.textContent = msg;
  $errorEl.classList.add('visible');
}
function hideError() {
  $errorEl.classList.remove('visible');
}

// ─── Output Display ────────────────────────────────────────────────────────────
function showShimmer() {
  $placeholder.classList.add('hidden');
  $shimmer.classList.add('visible');
  $outputImg.classList.remove('visible');
  $outputActions.classList.remove('visible');
  $outputCard.classList.remove('has-image');
}

function showImage(blob, meta) {
  // Release previous blob URL
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = URL.createObjectURL(blob);

  $shimmer.classList.remove('visible');
  $outputImg.src = currentBlobUrl;
  $outputImg.classList.add('visible');

  // Download button
  $downloadBtn.href = currentBlobUrl;
  $downloadBtn.download = `lumina-${selectedModel}-${Date.now()}.png`;
  $outputMeta.textContent = meta || '';
  $outputActions.classList.add('visible');
  $outputCard.classList.add('has-image');
}

function resetOutputCard() {
  $shimmer.classList.remove('visible');
  $placeholder.classList.remove('hidden');
  $outputImg.classList.remove('visible');
  $outputActions.classList.remove('visible');
  $outputCard.classList.remove('has-image');
}

// ─── Load Model ────────────────────────────────────────────────────────────────
async function ensureModelLoaded() {
  if (loadedModel === selectedModel) return true;

  // Unload previous model if different
  if (loadedModel) {
    setModelStatus('idle', 'Switching model…', '');
    try { await client.unload(); } catch (_) {}
    loadedModel = null;
  }

  setModelStatus('loading', selectedModel, 'Downloading / loading…');
  $statusText.textContent = `Loading ${selectedModel}…`;
  setProgress({ message: `Loading ${selectedModel}`, pct: null });

  const res = await client.load(
    selectedModel,
    { backendPreference: ['webgpu'] },
    (p) => {
      const msg = p.message ?? p.phase ?? 'Loading';
      setProgress({ ...p, message: msg });
      $statusText.textContent = msg;
    }
  );

  if (!res?.ok) {
    const errMsg = res?.message ?? 'Failed to load model';
    showError(`Model load failed: ${errMsg}`);
    setModelStatus('idle', 'Load failed', errMsg);
    return false;
  }

  loadedModel = selectedModel;
  const backend = res.backendUsed ?? 'webgpu';
  setModelStatus('ready', selectedModel, `${backend.toUpperCase()} · Ready`);
  return true;
}

// ─── Generate ─────────────────────────────────────────────────────────────────
async function generate() {
  const prompt = $prompt.value.trim();
  if (!prompt) {
    $prompt.focus();
    return;
  }

  hideError();
  setGeneratingUI(true);
  showShimmer();

  try {
    // 1) Load model if not already loaded
    const loaded = await ensureModelLoaded();
    if (!loaded) {
      setGeneratingUI(false);
      resetOutputCard();
      return;
    }

    // 2) Build params
    const seedVal = parseInt($seed.value, 10);
    const params = {
      prompt,
      ...(Number.isFinite(seedVal) ? { seed: seedVal } : {}),
    };

    // 3) Generate
    $statusText.textContent = 'Generating…';
    setProgress({ message: 'Generating image', pct: null });

    const { promise, abort } = client.generate(
      params,
      (e) => {
        const msg = e.phase ? `${e.phase}` : 'Generating';
        setProgress({ ...e, message: msg });
        $statusText.textContent = msg;
      },
      { busyPolicy: 'queue', debounceMs: 100 }
    );
    currentAbort = abort;

    const result = await promise;
    currentAbort = null;

    if (result.ok) {
      const timeS   = (result.timeMs / 1000).toFixed(1);
      const metaStr = `${selectedModel} · ${timeS}s · ${result.backendUsed ?? 'webgpu'}`;
      showImage(result.blob, metaStr);
      hideProgress();
      $statusText.textContent = 'Done';
    } else if (result.reason === 'aborted') {
      $statusText.textContent = 'Aborted';
      hideProgress();
      resetOutputCard();
    } else {
      showError(result.message ?? 'Generation failed');
      hideProgress();
      resetOutputCard();
    }
  } catch (err) {
    showError(err?.message ?? String(err));
    hideProgress();
    resetOutputCard();
  } finally {
    setGeneratingUI(false);
  }
}

// ─── Stop / Abort ──────────────────────────────────────────────────────────────
$stopBtn.addEventListener('click', async () => {
  if (currentAbort) {
    try { await currentAbort(); } catch (_) {}
  }
});

// ─── Generate Button ───────────────────────────────────────────────────────────
$generateBtn.addEventListener('click', () => {
  if (!isGenerating) generate();
});

// ─── Enter in Prompt (Ctrl+Enter / Cmd+Enter) ──────────────────────────────────
$prompt.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!isGenerating) generate();
  }
});

// ─── Sidebar Toggle (mobile) ───────────────────────────────────────────────────
$sidebarToggle.addEventListener('click', () => {
  $sidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if ($sidebar.classList.contains('open') &&
      !$sidebar.contains(e.target) &&
      e.target !== $sidebarToggle) {
    $sidebar.classList.remove('open');
  }
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  // Create the worker client
  client = Txt2ImgWorkerClient.createDefault();

  // Detect capabilities
  await detectCapabilities();

  // Enable generate button (WebGPU check will disable it if not supported)
  if ($generateBtn.disabled !== true) {
    setGenerateEnabled(true);
  }

  // Try to list models and update pill meta with real sizes
  try {
    const models = await client.listModels();
    models.forEach(m => {
      const pill = document.querySelector(`[data-model="${m.id}"]`);
      if (pill) {
        const meta = pill.querySelector('.model-pill-meta');
        if (meta && m.sizeGBApprox) {
          const sizeStr = m.sizeGBApprox < 1
            ? `~${Math.round(m.sizeGBApprox * 1024)} MB`
            : `~${m.sizeGBApprox.toFixed(1)} GB`;
          // Keep the existing suffix info
          meta.textContent = `${sizeStr} · ${meta.textContent.split('·').slice(1).join('·').trim()}`;
        }
      }
    });
  } catch (_) { /* non-critical */ }
}

boot();
