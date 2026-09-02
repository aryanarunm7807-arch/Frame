(() => {
  'use strict';

  /* ============ Theme ============ */
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');
  const themeLabel = document.getElementById('themeLabel');

  function applyTheme(theme){
    body.setAttribute('data-theme', theme);
    themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
    try{ localStorage.setItem('frame-theme', theme); }catch(e){}
  }

  (function initTheme(){
    let saved = null;
    try{ saved = localStorage.getItem('frame-theme'); }catch(e){}
    if(saved){ applyTheme(saved); }
    else{
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark ? 'dark' : 'light');
    }
  })();

  themeToggle.addEventListener('click', () => {
    const current = body.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ============ State ============ */
  let originalImage = null;   // HTMLImageElement
  let originalFile = null;    // File
  let naturalWidth = 0, naturalHeight = 0;

  /* ============ Elements ============ */
  const dropzone = document.getElementById('dropzone');
  const workspace = document.getElementById('workspace');
  const fileInput = document.getElementById('fileInput');
  const selectBtn = document.getElementById('selectBtn');
  const replaceBtn = document.getElementById('replaceBtn');
  const previewCanvas = document.getElementById('previewCanvas');
  const histogramCanvas = document.getElementById('histogramCanvas');
  const specDims = document.getElementById('specDims');
  const specSize = document.getElementById('specSize');
  const specFormat = document.getElementById('specFormat');

  /* ============ File intake ============ */
  selectBtn.addEventListener('click', () => fileInput.click());
  replaceBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if(e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragenter','dragover'].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave','drop'].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) handleFile(f);
  });

  const MAX_FILE_MB = 40;
  const dropzoneError = document.getElementById('dropzoneError');

  function showDropzoneError(msg){
    if(!dropzoneError) return;
    dropzoneError.textContent = msg;
    dropzoneError.hidden = false;
  }
  function clearDropzoneError(){
    if(!dropzoneError) return;
    dropzoneError.hidden = true;
  }

  // Shared by the main analyze dropzone and the two color-match slots, so
  // the same validation (type, size, decodability, minimum dimensions)
  // always applies no matter where a photo comes in.
  function validateAndLoadImage(file){
    return new Promise((resolve, reject) => {
      if(!file.type.startsWith('image/')){
        reject(`"${file.name}" isn't an image file — try a JPEG, PNG, or WebP.`);
        return;
      }
      if(file.size > MAX_FILE_MB * 1024 * 1024){
        reject(`That file is ${formatBytes(file.size)} — Frame works best under ${MAX_FILE_MB} MB in-browser.`);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject('Could not read that file — try again or pick a different image.');
      reader.onload = e => {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onerror = () => reject('That image could not be decoded — it may be corrupted or an unsupported format.');
        img.onload = () => {
          if(img.naturalWidth < 2 || img.naturalHeight < 2){
            reject('That image is too small to use.');
            return;
          }
          resolve({ file, img, dataUrl });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleFile(file){
    clearDropzoneError();
    validateAndLoadImage(file).then(({ file, img }) => {
      originalImage = img;
      originalFile = file;
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;
      dropzone.hidden = true;
      workspace.hidden = false;
      renderAll(file);
    }).catch(showDropzoneError);
  }

  /* ============ Render pipeline ============ */
  function renderAll(file){
    drawPreview();
    const pixels = getPixelData(originalImage);
    const stats = computeStats(pixels);
    drawHistogram(stats.luminanceHist);
    renderChecks(stats);
    renderGauge(stats);
    specDims.textContent = `${naturalWidth} × ${naturalHeight}`;
    specSize.textContent = formatBytes(file.size);
    specFormat.textContent = (file.type || 'image').split('/')[1].toUpperCase();

    initResizeTab();
    initCompressTab(file.size);
  }

  function drawPreview(){
    const maxW = 640;
    const scale = Math.min(1, maxW / naturalWidth);
    const w = Math.round(naturalWidth * scale);
    const h = Math.round(naturalHeight * scale);
    previewCanvas.width = w;
    previewCanvas.height = h;
    const ctx = previewCanvas.getContext('2d');
    ctx.drawImage(originalImage, 0, 0, w, h);
  }

  function getPixelData(img, maxDim = 400){
    // downscale for analysis speed, stats are proportionally representative
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  /* ============ Pixel analysis ============ */
  function computeStats(data){
    const lumHist = new Array(256).fill(0);
    let sumLum = 0, sumR = 0, sumG = 0, sumB = 0;
    let shadowClip = 0, highlightClip = 0;
    const n = data.length / 4;

    for(let i = 0; i < data.length; i += 4){
      const r = data[i], g = data[i+1], b = data[i+2];
      const lum = 0.299*r + 0.587*g + 0.114*b;
      const lumBucket = Math.min(255, Math.round(lum));
      lumHist[lumBucket]++;
      sumLum += lum;
      sumR += r; sumG += g; sumB += b;
      if(lum <= 5) shadowClip++;
      if(lum >= 250) highlightClip++;
    }

    const meanLuminance = sumLum / n;
    let variance = 0;
    for(let i = 0; i < data.length; i += 4){
      const r = data[i], g = data[i+1], b = data[i+2];
      const lum = 0.299*r + 0.587*g + 0.114*b;
      variance += (lum - meanLuminance) ** 2;
    }
    const stdDev = Math.sqrt(variance / n);

    const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
    // warm/cool cast proxy: difference between R and B channel means
    const rbGap = meanR - meanB;

    const shadowClipPct = (shadowClip / n) * 100;
    const highlightClipPct = (highlightClip / n) * 100;

    return {
      luminanceHist: lumHist,
      meanLuminance, stdDev,
      meanR, meanG, meanB, rbGap,
      shadowClipPct, highlightClipPct
    };
  }

  /* ============ Histogram drawing ============ */
  function drawHistogram(hist){
    const canvas = histogramCanvas;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 400;
    const cssH = 90;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const max = Math.max(...hist);
    const accent = getComputedStyle(body).getPropertyValue('--accent').trim();
    const flag = getComputedStyle(body).getPropertyValue('--flag').trim();
    const barW = cssW / hist.length;

    // Shade the clipping zones (bucket 0 and buckets 250–255) so the reader can
    // see, not just read, where the shadow/highlight clipping checks are measured.
    ctx.fillStyle = flag;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(0, 0, barW * 6, cssH);
    ctx.fillRect(cssW - barW * 6, 0, barW * 6, cssH);

    ctx.fillStyle = accent;
    for(let i = 0; i < hist.length; i++){
      const h = max > 0 ? (hist[i] / max) * (cssH - 4) : 0;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(i * barW, cssH - h, Math.max(1, barW - 0.4), h);
    }
    ctx.globalAlpha = 1;
  }

  /* ============ Checks (fixed order, always all four) ============ */
  // Target values are the center of each "good" band, so a suggested
  // adjustment is always "how far from the middle of acceptable" — not a guess.
  const EXPOSURE_TARGET = 127.5;   // midpoint of 0–255
  const CONTRAST_TARGET = 60;      // midpoint of the 40–80 good band
  const CLIP_LIMIT = 3;            // % of pixels, matches the flag threshold below

  function getExposureResult(mean){
    const stops = Math.log2(EXPOSURE_TARGET / Math.max(1, mean));
    if(mean < 85) return { status:'flag', label:'Underexposed', text:`Mean brightness is ${Math.round(mean)}/255 — try increasing exposure by about +${stops.toFixed(1)} stops to reach the ${EXPOSURE_TARGET} midpoint.` };
    if(mean > 170) return { status:'flag', label:'Overexposed', text:`Mean brightness is ${Math.round(mean)}/255 — try reducing exposure by about ${stops.toFixed(1)} stops to reach the ${EXPOSURE_TARGET} midpoint.` };
    return { status:'good', label:'Well exposed', text:`Mean brightness is ${Math.round(mean)}/255, close to the ${EXPOSURE_TARGET} midpoint.` };
  }

  function getContrastResult(stdDev){
    if(stdDev < 40){
      const pct = Math.round((CONTRAST_TARGET / Math.max(1, stdDev) - 1) * 100);
      return { status:'flag', label:'Low contrast', text:`Luminance std dev is ${stdDev.toFixed(0)} — try increasing contrast by roughly +${pct}% to reach ~${CONTRAST_TARGET}.` };
    }
    if(stdDev > 80){
      const pct = Math.round((1 - CONTRAST_TARGET / stdDev) * 100);
      return { status:'flag', label:'High contrast', text:`Luminance std dev is ${stdDev.toFixed(0)} — try reducing contrast by roughly -${pct}% to reach ~${CONTRAST_TARGET}.` };
    }
    return { status:'good', label:'Good contrast', text:`Luminance std dev is ${stdDev.toFixed(0)}, within the 40–80 target band.` };
  }

  function getWhiteBalanceResult(rbGap){
    const shift = Math.round(Math.abs(rbGap) / 2);
    if(rbGap > 18) return { status:'flag', label:'Warm cast', text:`Red leads blue by ${rbGap.toFixed(0)} (0–255 scale) — try shifting white balance about ${shift} points toward blue.` };
    if(rbGap < -18) return { status:'flag', label:'Cool cast', text:`Blue leads red by ${Math.abs(rbGap).toFixed(0)} (0–255 scale) — try shifting white balance about ${shift} points toward red.` };
    return { status:'good', label:'Neutral balance', text:`R/B channel gap is ${rbGap.toFixed(0)}, within the neutral ±18 range.` };
  }

  function getClippingResult(shadowPct, highlightPct){
    const shadowFlag = shadowPct > CLIP_LIMIT, highlightFlag = highlightPct > CLIP_LIMIT;
    if(shadowFlag && highlightFlag) return { status:'flag', label:'Clipping both ends', text:`${shadowPct.toFixed(1)}% pure black, ${highlightPct.toFixed(1)}% pure white (target: under ${CLIP_LIMIT}% each) — detail is lost at both extremes.` };
    if(shadowFlag) return { status:'flag', label:'Shadow clipping', text:`${shadowPct.toFixed(1)}% of pixels are pure black (target: under ${CLIP_LIMIT}%) — try lifting shadows a stop or two to bring that back into range.` };
    if(highlightFlag) return { status:'flag', label:'Highlight clipping', text:`${highlightPct.toFixed(1)}% of pixels are pure white (target: under ${CLIP_LIMIT}%) — try pulling highlights down a stop or two to bring that back into range.` };
    return { status:'good', label:'No significant clipping', text:`Shadow and highlight clipping are both under ${CLIP_LIMIT}% (${shadowPct.toFixed(1)}% / ${highlightPct.toFixed(1)}%).` };
  }

  const checkIcon = {
    good: `<svg viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L4.75 8.75L9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    flag: `<svg viewBox="0 0 12 12" fill="none"><path d="M6 3.5V6.5M6 8.5H6.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.25"/></svg>`
  };

  function renderChecks(stats){
    const results = [
      getExposureResult(stats.meanLuminance),
      getContrastResult(stats.stdDev),
      getWhiteBalanceResult(stats.rbGap),
      getClippingResult(stats.shadowClipPct, stats.highlightClipPct)
    ];
    const list = document.getElementById('checksList');
    list.innerHTML = results.map(r => `
      <div class="check-row">
        <span class="check-icon ${r.status}">${checkIcon[r.status]}</span>
        <div class="check-body">
          <div class="check-label">${r.label}</div>
          <div class="check-text">${r.text}</div>
        </div>
      </div>
    `).join('');
    return results;
  }

  /* ============ Gauge ============ */
  // Continuous per-check score: 100 at the ideal center, falling off linearly
  // to 0 at maxDistance away. This means two "flagged" images aren't scored
  // the same just because they both crossed a threshold — how far past it matters.
  function falloffScore(distance, maxDistance){
    return Math.max(0, 100 - (distance / maxDistance) * 100);
  }

  function computeOverallScore(stats){
    const exposureScore = falloffScore(Math.abs(stats.meanLuminance - EXPOSURE_TARGET), EXPOSURE_TARGET);
    const contrastScore = falloffScore(Math.abs(stats.stdDev - CONTRAST_TARGET), CONTRAST_TARGET);
    const whiteBalanceScore = falloffScore(Math.abs(stats.rbGap), 60);
    const clippingScore = falloffScore(stats.shadowClipPct + stats.highlightClipPct, 20);
    return Math.round((exposureScore + contrastScore + whiteBalanceScore + clippingScore) / 4);
  }

  function renderGauge(stats){
    const score = computeOverallScore(stats);

    const fill = document.getElementById('gaugeFill');
    const needle = document.getElementById('gaugeNeedle');
    const scoreEl = document.getElementById('gaugeScore');
    const captionEl = document.getElementById('gaugeCaption');

    const circumference = 314; // approx length of the arc path
    const offset = circumference - (score / 100) * circumference;

    requestAnimationFrame(() => {
      fill.style.strokeDashoffset = offset;
      const angle = -90 + (score / 100) * 180; // -90deg to +90deg sweep
      needle.style.transform = `rotate(${angle}deg)`;
    });

    let flagColor = getComputedStyle(body).getPropertyValue('--flag').trim();
    let goodColor = getComputedStyle(body).getPropertyValue('--good').trim();
    let accentColor = getComputedStyle(body).getPropertyValue('--accent').trim();
    fill.style.stroke = score >= 75 ? goodColor : score >= 50 ? accentColor : flagColor;

    scoreEl.textContent = score;
    captionEl.textContent = score === 100 ? 'Clean across the board'
      : score >= 75 ? 'Mostly on target'
      : score >= 50 ? 'A few things to fix'
      : 'Several areas need work';
  }

  /* ============ Resize tab ============ */
  const MAX_DIMENSION = 8000; // px per side — keeps canvas ops fast and memory-safe

  function initResizeTab(){
    const widthInput = document.getElementById('resizeWidth');
    const heightInput = document.getElementById('resizeHeight');
    const lockBtn = document.getElementById('lockAspect');
    const estimateEl = document.getElementById('resizeEstimate');
    const downloadBtn = document.getElementById('downloadResize');
    const presetChips = document.querySelectorAll('.preset-chip');

    widthInput.value = naturalWidth;
    heightInput.value = naturalHeight;
    widthInput.max = heightInput.max = MAX_DIMENSION;
    let locked = true;
    lockBtn.setAttribute('aria-pressed', 'true');
    const ratio = naturalWidth / naturalHeight;

    lockBtn.onclick = () => {
      locked = !locked;
      lockBtn.setAttribute('aria-pressed', String(locked));
    };

    // Clamp to [1, MAX_DIMENSION] on blur so an empty, zero, or huge value
    // can never reach the canvas — invalid mid-typing states are still allowed.
    function clampInput(input){
      const n = parseInt(input.value);
      if(!n || n < 1) input.value = 1;
      else if(n > MAX_DIMENSION) input.value = MAX_DIMENSION;
    }
    widthInput.onblur = () => { clampInput(widthInput); updateEstimate(); };
    heightInput.onblur = () => { clampInput(heightInput); updateEstimate(); };

    widthInput.oninput = () => {
      if(locked && widthInput.value){
        heightInput.value = Math.round(widthInput.value / ratio);
      }
      updateEstimate();
    };
    heightInput.oninput = () => {
      if(locked && heightInput.value){
        widthInput.value = Math.round(heightInput.value * ratio);
      }
      updateEstimate();
    };

    presetChips.forEach(chip => {
      chip.onclick = () => {
        presetChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const scale = parseFloat(chip.dataset.scale);
        widthInput.value = Math.round(naturalWidth * scale);
        heightInput.value = Math.round(naturalHeight * scale);
        updateEstimate();
      };
    });

    function updateEstimate(){
      const w = parseInt(widthInput.value) || naturalWidth;
      const h = parseInt(heightInput.value) || naturalHeight;
      const pixelRatio = (w * h) / (naturalWidth * naturalHeight);
      const est = Math.max(1024, Math.round((originalFile.size) * pixelRatio));
      estimateEl.textContent = formatBytes(est);
    }
    updateEstimate();

    downloadBtn.onclick = () => {
      const w = Math.min(MAX_DIMENSION, Math.max(1, parseInt(widthInput.value) || naturalWidth));
      const h = Math.min(MAX_DIMENSION, Math.max(1, parseInt(heightInput.value) || naturalHeight));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(originalImage, 0, 0, w, h);
      c.toBlob(blob => {
        downloadBlob(blob, appendSuffix(originalFile.name, `-${w}x${h}`));
      }, originalFile.type || 'image/png', 0.92);
    };
  }

  /* ============ Compress tab ============ */
  function initCompressTab(originalSize){
    const slider = document.getElementById('qualitySlider');
    const qualityValue = document.getElementById('qualityValue');
    const originalEl = document.getElementById('compressOriginal');
    const estimateEl = document.getElementById('compressEstimate');
    const reductionEl = document.getElementById('compressReduction');
    const downloadBtn = document.getElementById('downloadCompress');

    originalEl.textContent = formatBytes(originalSize);

    let debounceTimer = null;
    function updatePreview(){
      const q = parseInt(slider.value) / 100;
      qualityValue.textContent = `${slider.value}%`;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const c = document.createElement('canvas');
        c.width = naturalWidth; c.height = naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(originalImage, 0, 0, naturalWidth, naturalHeight);
        c.toBlob(blob => {
          estimateEl.textContent = formatBytes(blob.size);
          const reduction = Math.max(0, Math.round((1 - blob.size / originalSize) * 100));
          reductionEl.textContent = `${reduction}%`;
        }, 'image/jpeg', q);
      }, 180);
    }

    slider.oninput = updatePreview;
    updatePreview();

    downloadBtn.onclick = () => {
      const q = parseInt(slider.value) / 100;
      const c = document.createElement('canvas');
      c.width = naturalWidth; c.height = naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(originalImage, 0, 0, naturalWidth, naturalHeight);
      c.toBlob(blob => {
        downloadBlob(blob, appendSuffix(originalFile.name, '-compressed', 'jpg'));
      }, 'image/jpeg', q);
    };
  }

  /* ============ Tabs ============ */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  /* ============ Helpers ============ */
  function formatBytes(bytes){
    if(bytes < 1024) return `${bytes} B`;
    if(bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/(1024*1024)).toFixed(2)} MB`;
  }

  function appendSuffix(filename, suffix, forceExt){
    const dot = filename.lastIndexOf('.');
    const base = dot > -1 ? filename.slice(0, dot) : filename;
    const ext = forceExt || (dot > -1 ? filename.slice(dot+1) : 'png');
    return `${base}${suffix}.${ext}`;
  }

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ============ Mode switcher ============ */
  const modeButtons = document.querySelectorAll('.mode-btn');
  const modeAnalyze = document.getElementById('modeAnalyze');
  const modeMatch = document.getElementById('modeMatch');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isMatch = btn.dataset.mode === 'match';
      modeAnalyze.hidden = isMatch;
      modeMatch.hidden = !isMatch;
    });
  });

  /* ============ Color science: Reinhard et al. lαβ color transfer ============
     "Color Transfer between Images" (Reinhard, Ashikhmin, Gooch, Shirley, 2001).
     RGB is converted into a decorrelated lαβ space (via LMS cone space) where
     lightness, and two roughly-independent color axes, can each be rescaled
     on their own without smearing color into brightness or vice versa. */
  function rgbToLab(r, g, b){
    let L = 0.3811*r + 0.5783*g + 0.0402*b;
    let M = 0.1967*r + 0.7244*g + 0.0782*b;
    let S = 0.0241*r + 0.1288*g + 0.8444*b;
    L = Math.log10(Math.max(L, 1));
    M = Math.log10(Math.max(M, 1));
    S = Math.log10(Math.max(S, 1));
    return [
      (L + M + S) / Math.sqrt(3),
      (L + M - 2*S) / Math.sqrt(6),
      (L - M) / Math.sqrt(2)
    ];
  }

  function labToRgb(l, a, b){
    const L = l/Math.sqrt(3) + a/Math.sqrt(6) + b/Math.sqrt(2);
    const M = l/Math.sqrt(3) + a/Math.sqrt(6) - b/Math.sqrt(2);
    const S = l/Math.sqrt(3) - 2*a/Math.sqrt(6);
    const Le = Math.pow(10, L), Me = Math.pow(10, M), Se = Math.pow(10, S);
    return [
      clamp255(4.4679*Le - 3.5873*Me + 0.1193*Se),
      clamp255(-1.2186*Le + 2.3809*Me - 0.1624*Se),
      clamp255(0.0497*Le - 0.2439*Me + 1.2045*Se)
    ];
  }

  function clamp255(v){ return Math.min(255, Math.max(0, v)); }

  // Mean and std dev of each lαβ channel across a sample of pixels — this is
  // the entire "color grade" the algorithm captures: not the image content,
  // just how its tones and colors are statistically distributed.
  function computeLabStats(pixels){
    const n = pixels.length / 4;
    const ls = new Float32Array(n), as = new Float32Array(n), bs = new Float32Array(n);
    let sumL = 0, sumA = 0, sumB = 0;
    for(let i = 0, p = 0; i < pixels.length; i += 4, p++){
      const [l, a, b] = rgbToLab(pixels[i], pixels[i+1], pixels[i+2]);
      ls[p] = l; as[p] = a; bs[p] = b;
      sumL += l; sumA += a; sumB += b;
    }
    const lMean = sumL/n, aMean = sumA/n, bMean = sumB/n;
    let vl = 0, va = 0, vb = 0;
    for(let p = 0; p < n; p++){
      vl += (ls[p]-lMean)**2; va += (as[p]-aMean)**2; vb += (bs[p]-bMean)**2;
    }
    return {
      lMean, aMean, bMean,
      lStd: Math.sqrt(vl/n) || 1,
      aStd: Math.sqrt(va/n) || 1,
      bStd: Math.sqrt(vb/n) || 1
    };
  }

  // The core transfer: recenter each target pixel's deviation from the
  // target's own mean, scaled by the ratio of standard deviations, onto the
  // reference's mean. This matches statistics, not pixels — it's why the
  // result keeps the target's content but reads with the reference's grade.
  function applyColorTransfer(imageData, targetStats, refStats){
    const data = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const od = out.data;
    for(let i = 0; i < data.length; i += 4){
      const [l, a, b] = rgbToLab(data[i], data[i+1], data[i+2]);
      const l2 = (l - targetStats.lMean) * (refStats.lStd / targetStats.lStd) + refStats.lMean;
      const a2 = (a - targetStats.aMean) * (refStats.aStd / targetStats.aStd) + refStats.aMean;
      const b2 = (b - targetStats.bMean) * (refStats.bStd / targetStats.bStd) + refStats.bMean;
      const [r, g, bb] = labToRgb(l2, a2, b2);
      od[i] = r; od[i+1] = g; od[i+2] = bb; od[i+3] = data[i+3];
    }
    return out;
  }

  function blendImageData(original, graded, strength){
    const out = new ImageData(original.width, original.height);
    const a = original.data, b = graded.data, o = out.data;
    for(let i = 0; i < a.length; i += 4){
      o[i]   = a[i]   + (b[i]   - a[i])   * strength;
      o[i+1] = a[i+1] + (b[i+1] - a[i+1]) * strength;
      o[i+2] = a[i+2] + (b[i+2] - a[i+2]) * strength;
      o[i+3] = a[i+3];
    }
    return out;
  }

  function drawCapped(img, maxDim){
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  /* ============ Color match section ============ */
  (function initMatchSection(){
    const MATCH_MAX_DIMENSION = 2400; // caps the per-pixel Lab transform so it stays fast on the main thread

    let refState = null;    // { file, img }
    let targetState = null; // { file, img, workCanvas, workImageData }
    let lastGraded = null;  // full working-res ImageData at 100% strength
    let lastBlendedCanvas = null; // full working-res canvas at the current strength, used for download

    const matchError = document.getElementById('matchError');
    const matchResult = document.getElementById('matchResult');
    const matchStatus = document.getElementById('matchStatus');
    const resultCanvas = document.getElementById('matchResultCanvas');
    const refThumb = document.getElementById('matchRefThumb');
    const targetThumb = document.getElementById('matchTargetThumb');
    const strengthSlider = document.getElementById('matchStrengthSlider');
    const strengthValue = document.getElementById('matchStrengthValue');
    const outputSizeEl = document.getElementById('matchOutputSize');
    const downloadBtn = document.getElementById('downloadMatch');

    function showMatchError(msg){ matchError.textContent = msg; matchError.hidden = false; }
    function clearMatchError(){ matchError.hidden = true; }
    function setStatus(msg){ matchStatus.textContent = msg; }

    function drawThumb(canvas, img){
      const maxW = 300;
      const scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    function setupSlot(role){
      const slot = document.querySelector(`.match-slot[data-role="${role}"]`);
      const input = document.getElementById(`${role}FileInput`);
      const selectBtn = slot.querySelector('[data-select]');
      const preview = document.getElementById(`${role}Preview`);
      const inner = slot.querySelector('.match-slot-inner');

      function load(file){
        clearMatchError();
        validateAndLoadImage(file).then(({ file, img }) => {
          if(role === 'reference'){
            refState = { file, img };
          } else {
            const workCanvas = drawCapped(img, MATCH_MAX_DIMENSION);
            targetState = {
              file, img, workCanvas,
              workImageData: workCanvas.getContext('2d').getImageData(0, 0, workCanvas.width, workCanvas.height)
            };
          }
          drawThumb(preview, img);
          inner.hidden = true;
          preview.hidden = false;
          runMatchIfReady();
        }).catch(showMatchError);
      }

      selectBtn.addEventListener('click', () => input.click());
      preview.addEventListener('click', () => input.click());
      input.addEventListener('change', e => { if(e.target.files[0]) load(e.target.files[0]); });

      ['dragenter','dragover'].forEach(evt => slot.addEventListener(evt, e => {
        e.preventDefault(); e.stopPropagation(); slot.classList.add('dragover');
      }));
      ['dragleave','drop'].forEach(evt => slot.addEventListener(evt, e => {
        e.preventDefault(); e.stopPropagation(); slot.classList.remove('dragover');
      }));
      slot.addEventListener('drop', e => {
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if(f) load(f);
      });
    }

    setupSlot('reference');
    setupSlot('target');

    function runMatchIfReady(){
      if(!refState || !targetState) return;
      matchResult.hidden = false;
      drawThumb(refThumb, refState.img);
      drawThumb(targetThumb, targetState.img);
      downloadBtn.disabled = true;
      strengthSlider.disabled = true;
      setStatus('Matching colors…');

      // Defer the heavy pass one tick so the "Matching colors…" status
      // actually paints before the main thread gets busy.
      setTimeout(() => {
        const refStats = computeLabStats(getPixelData(refState.img, 300));
        const targetStats = computeLabStats(getPixelData(targetState.img, 300));
        lastGraded = applyColorTransfer(targetState.workImageData, targetStats, refStats);
        renderAtStrength();
        downloadBtn.disabled = false;
        strengthSlider.disabled = false;
        setStatus('');
      }, 30);
    }

    function renderAtStrength(){
      if(!lastGraded || !targetState) return;
      const strength = parseInt(strengthSlider.value) / 100;
      const blended = blendImageData(targetState.workImageData, lastGraded, strength);
      const tmp = document.createElement('canvas');
      tmp.width = blended.width; tmp.height = blended.height;
      tmp.getContext('2d').putImageData(blended, 0, 0);
      lastBlendedCanvas = tmp;

      const maxW = 300;
      const scale = Math.min(1, maxW / tmp.width);
      resultCanvas.width = Math.round(tmp.width * scale);
      resultCanvas.height = Math.round(tmp.height * scale);
      resultCanvas.getContext('2d').drawImage(tmp, 0, 0, resultCanvas.width, resultCanvas.height);

      const capped = tmp.width < targetState.img.naturalWidth;
      outputSizeEl.textContent = `${tmp.width} × ${tmp.height}${capped ? ' (capped for speed)' : ''}`;
    }

    strengthSlider.oninput = () => {
      strengthValue.textContent = `${strengthSlider.value}%`;
      renderAtStrength();
    };

    downloadBtn.onclick = () => {
      if(!lastBlendedCanvas || !targetState) return;
      lastBlendedCanvas.toBlob(blob => {
        downloadBlob(blob, appendSuffix(targetState.file.name, '-color-matched'));
      }, targetState.file.type || 'image/png', 0.92);
    };
  })();

})();
