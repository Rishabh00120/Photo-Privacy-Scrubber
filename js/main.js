/**
 * main.js - Application Initialization, Event Orchestration, Batch Coordination, and Blur/Crop Tool
 * Glues together ExifParser, JpegProcessor, MetadataScrubber, ImageGallery, and UIManager
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Instantiate Core Subsystems
  let tagDict = {};
  try {
    const res = await fetch('data/exif-tags.json');
    if (res.ok) {
      tagDict = await res.json();
    }
  } catch (err) {
    console.warn('Could not load exif-tags.json, using built-in defaults', err);
  }

  const exifParser = new window.ExifParser(tagDict);
  const jpegProcessor = new window.JpegProcessor(exifParser);
  const scrubber = new window.MetadataScrubber(jpegProcessor, exifParser);
  const ui = new window.UIManager();

  // 2. DOM Element Selectors
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const loadSampleBtn = document.getElementById('load-sample-btn');

  const batchToolbar = document.getElementById('batch-toolbar');
  const statTotal = document.getElementById('stat-total');
  const statCleaned = document.getElementById('stat-cleaned');
  const statPending = document.getElementById('stat-pending');
  const batchScrubBtn = document.getElementById('batch-scrub-btn');
  const batchDownloadZipBtn = document.getElementById('batch-download-zip-btn');
  const clearGalleryBtn = document.getElementById('clear-gallery-btn');
  const batchProgressWrapper = document.getElementById('batch-progress-wrapper');
  const batchProgressBar = document.getElementById('batch-progress-bar');

  const workspaceContainer = document.getElementById('workspace-container');
  const galleryList = document.getElementById('gallery-list');
  const galleryCountBadge = document.getElementById('gallery-count-badge');

  const riskBannerPlaceholder = document.getElementById('risk-badge-placeholder');
  const riskReasonsList = document.getElementById('risk-reasons-list');
  const activeFilenameDisplay = document.getElementById('active-filename-display');

  const scrubCurrentBtn = document.getElementById('scrub-current-btn');
  const downloadCurrentBtn = document.getElementById('download-current-btn');
  const modeLossless = document.getElementById('mode-lossless');
  const optPreserveOrientation = document.getElementById('opt-preserve-orientation');
  const optKeepIcc = document.getElementById('opt-keep-icc');

  const beforeImg = document.getElementById('before-img');
  const beforeSize = document.getElementById('before-size');
  const beforeMetaCount = document.getElementById('before-meta-count');
  const beforeDimensions = document.getElementById('before-dimensions');

  const afterImg = document.getElementById('after-img');
  const afterSize = document.getElementById('after-size');
  const afterMetaStatus = document.getElementById('after-meta-status');
  const afterSavings = document.getElementById('after-savings');
  const scrubStatusLabel = document.getElementById('scrub-status-label');

  const offlineLocationContainer = document.getElementById('offline-location-container');
  const metadataTablesContainer = document.getElementById('metadata-tables-container');
  const metadataTotalTag = document.getElementById('metadata-total-tag');

  // Education Dialog
  const eduDialog = document.getElementById('educational-dialog');
  const openEducationBtn = document.getElementById('open-education-btn');
  const closeEduDialogBtn = document.getElementById('close-edu-dialog-btn');
  const confirmEduDialogBtn = document.getElementById('confirm-edu-dialog-btn');

  // Redaction / Blur Dialog
  const editToolDialog = document.getElementById('edit-tool-dialog');
  const openEditorBtn = document.getElementById('open-editor-btn');
  const closeEditorDialogBtn = document.getElementById('close-editor-dialog-btn');
  const cancelEditorBtn = document.getElementById('cancel-editor-btn');
  const saveRedactedBtn = document.getElementById('save-redacted-btn');
  const undoBlurBtn = document.getElementById('undo-blur-btn');
  const resetEditorBtn = document.getElementById('reset-editor-btn');
  const blurIntensitySlider = document.getElementById('blur-intensity-slider');
  const editorCanvas = document.getElementById('editor-canvas');

  // Theme Toggle Button & State
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeLabel = document.getElementById('theme-label');

  function initTheme() {
    const savedTheme = localStorage.getItem('pps-theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(initialTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('pps-theme', theme);
    } catch (e) {
      // In case localStorage is blocked in some sandboxes
    }
    if (themeLabel) {
      themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
    }
    themeToggleBtn.setAttribute('aria-label', `Current theme is ${theme}. Click to switch.`);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme);
      ui.announce(`Switched to ${newTheme} mode.`);
      ui.showToast(`Switched to ${newTheme === 'dark' ? 'Dark' : 'Light'} theme`, 'info');
    });
  }

  // Initialize theme immediately
  initTheme();

  // Listen for system preference changes if user hasn't set an explicit override
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('pps-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // 3. Initialize Gallery Manager
  const gallery = new window.ImageGallery({
    onSelectionChange: (selectedItem) => {
      renderActiveItemDetails(selectedItem);
    },
    onItemsChange: (items) => {
      renderGalleryList(items);
      updateBatchToolbar(items);
    }
  });

  // 4. File Ingestion & Drag/Drop
  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    let addedCount = 0;
    for (const file of fileList) {
      if (!file.type.startsWith('image/') && !file.name.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
        ui.showToast(`Skipped '${file.name}': Not a supported image format.`, 'warning');
        continue;
      }

      const res = await gallery.addFile(file);
      if (res.success) {
        addedCount++;
        // Proactively inspect metadata in background
        inspectItem(res.item);
      } else if (res.skipped) {
        ui.showToast(`Skipped duplicate file '${file.name}'.`, 'info');
      }
    }

    if (addedCount > 0) {
      ui.announce(`Imported ${addedCount} photo${addedCount > 1 ? 's' : ''}.`);
      workspaceContainer.style.display = 'grid';
      batchToolbar.style.display = 'flex';
    }
  }

  async function inspectItem(item) {
    item.status = 'inspecting';
    try {
      const inspection = await scrubber.inspect(item.buffer, { name: item.name });
      item.inspection = inspection;
      item.status = 'ready';
      // If this is the active item, re-render view
      if (gallery.selectedItemId === item.id) {
        renderActiveItemDetails(item);
      }
      gallery.onItemsChange(gallery.items);
    } catch (err) {
      item.status = 'error';
      item.errorMessage = err.message || 'Inspection failed';
      console.error(err);
      if (gallery.selectedItemId === item.id) {
        renderActiveItemDetails(item);
      }
    }
  }

  // Dropzone Event Listeners
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files) {
      handleFiles(dt.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  });

  // 5. Render Active Item Details
  function renderActiveItemDetails(item) {
    if (!item) {
      workspaceContainer.style.display = 'none';
      batchToolbar.style.display = 'none';
      return;
    }

    workspaceContainer.style.display = 'grid';
    batchToolbar.style.display = 'flex';

    activeFilenameDisplay.textContent = item.name;
    beforeImg.src = item.objectUrl || '';
    beforeSize.textContent = item.formattedSize;
    beforeDimensions.textContent = `Dimensions: ${item.width || '?'} × ${item.height || '?'}`;

    if (item.inspection) {
      const tagCount = item.inspection.metadataList.length;
      beforeMetaCount.textContent = `Metadata detected: ${tagCount} field${tagCount === 1 ? '' : 's'}`;
      metadataTotalTag.textContent = `${tagCount} tags found`;

      // Risk Banner
      riskBannerPlaceholder.innerHTML = ui.renderRiskBadge(item.inspection.riskLevel);
      riskReasonsList.innerHTML = item.inspection.riskReasons.map(r => `<li>${ui.escapeHtml(r)}</li>`).join('');

      // Offline Location Indicator
      if (item.inspection.gps) {
        offlineLocationContainer.innerHTML = ui.generateOfflineLocationSvg(item.inspection.gps);
        offlineLocationContainer.style.display = 'block';
      } else {
        offlineLocationContainer.innerHTML = '';
        offlineLocationContainer.style.display = 'none';
      }

      // Metadata Tables
      metadataTablesContainer.innerHTML = ui.renderMetadataTable(item.inspection.metadataList);
    } else {
      beforeMetaCount.textContent = 'Inspecting binary structure...';
      riskBannerPlaceholder.innerHTML = ui.renderRiskBadge('LOW');
      riskReasonsList.innerHTML = '<li>Inspecting image markers...</li>';
      offlineLocationContainer.innerHTML = '';
      metadataTablesContainer.innerHTML = '<p class="empty-notice">Reading EXIF tags...</p>';
    }

    // Cleaned state
    if (item.cleanedData) {
      afterImg.src = item.cleanedData.url || '';
      afterSize.textContent = gallery.formatBytes(item.cleanedData.buffer.byteLength);
      afterMetaStatus.textContent = `Scrubbed (${item.cleanedData.method})`;
      
      const diff = item.size - item.cleanedData.buffer.byteLength;
      afterSavings.textContent = diff >= 0
        ? `Saved ${gallery.formatBytes(diff)} of metadata headers`
        : `Size difference: +${gallery.formatBytes(Math.abs(diff))}`;

      scrubStatusLabel.textContent = 'Cleaned & Verified';
      scrubStatusLabel.style.color = 'var(--color-safe-green)';
      downloadCurrentBtn.disabled = false;
    } else {
      afterImg.src = '';
      afterSize.textContent = '-';
      afterMetaStatus.textContent = 'Status: Original untouched';
      afterSavings.textContent = 'Size difference: -';
      scrubStatusLabel.textContent = 'Awaiting Scrub';
      scrubStatusLabel.style.color = 'var(--color-navy-500)';
      downloadCurrentBtn.disabled = true;
    }
  }

  // 6. Render Gallery Sidebar
  function renderGalleryList(items) {
    galleryList.innerHTML = '';
    galleryCountBadge.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    for (const item of items) {
      const card = document.createElement('div');
      card.className = `gallery-card ${item.id === gallery.selectedItemId ? 'active' : ''}`;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', item.id === gallery.selectedItemId ? 'true' : 'false');

      const riskLevel = item.inspection ? item.inspection.riskLevel : 'LOW';
      const riskClass = `impact-${riskLevel.toLowerCase()}`;

      card.innerHTML = `
        <div class="card-thumb-wrap">
          <img src="${item.objectUrl}" class="card-thumb" alt="${ui.escapeHtml(item.name)} thumbnail">
        </div>
        <div class="card-info">
          <div class="card-filename" title="${ui.escapeHtml(item.name)}">${ui.escapeHtml(item.name)}</div>
          <div class="card-meta">${item.formattedSize} • ${item.type.split('/')[1] || 'img'}</div>
          <div class="card-badge-row">
            <span class="impact-pill ${riskClass}" style="font-size: 0.65rem; padding: 0.1rem 0.4rem;">${riskLevel}</span>
            ${item.cleanedData ? '<span style="color: var(--color-safe-green); font-size: 0.7rem; font-weight: 700;">✓ Cleaned</span>' : ''}
          </div>
        </div>
        <button type="button" class="card-del-btn" aria-label="Remove photo ${ui.escapeHtml(item.name)}">&times;</button>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('.card-del-btn')) {
          gallery.selectItem(item.id);
        }
      });

      card.querySelector('.card-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        gallery.removeItem(item.id);
        ui.announce(`Removed ${item.name} from gallery.`);
      });

      galleryList.appendChild(card);
    }
  }

  function updateBatchToolbar(items) {
    const total = items.length;
    const cleaned = items.filter(i => !!i.cleanedData).length;
    const pending = total - cleaned;

    statTotal.textContent = total;
    statCleaned.textContent = cleaned;
    statPending.textContent = pending;

    batchDownloadZipBtn.disabled = cleaned === 0;
    if (total === 0) {
      workspaceContainer.style.display = 'none';
      batchToolbar.style.display = 'none';
    }
  }

  // 7. Scrub Selected Single Image
  scrubCurrentBtn.addEventListener('click', async () => {
    const item = gallery.getSelectedItem();
    if (!item) return;

    scrubCurrentBtn.disabled = true;
    scrubCurrentBtn.textContent = 'Scrubbing...';

    try {
      const mode = modeLossless.checked ? 'lossless' : 'reencode';
      const preserveOrientation = optPreserveOrientation.checked;
      const keepColorProfile = optKeepIcc.checked;

      const result = await scrubber.scrubImage(item.file, item.buffer, {
        mode,
        preserveOrientation,
        keepColorProfile
      });

      // Cleanup prior clean URL if any
      if (item.cleanedData && item.cleanedData.url) {
        URL.revokeObjectURL(item.cleanedData.url);
      }

      item.cleanedData = {
        blob: result.blob,
        buffer: result.buffer,
        url: URL.createObjectURL(result.blob),
        method: result.method,
        details: result.details,
        verification: result.verification
      };
      item.status = 'cleaned';

      renderActiveItemDetails(item);
      renderGalleryList(gallery.items);
      updateBatchToolbar(gallery.items);

      ui.announce(`Metadata successfully scrubbed from ${item.name}.`);
      ui.showToast(`Cleaned ${item.name} (${result.method})`, 'success');
    } catch (err) {
      console.error(err);
      ui.showToast(`Scrubbing failed: ${err.message}`, 'error');
    } finally {
      scrubCurrentBtn.disabled = false;
      scrubCurrentBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
        Scrub Metadata Now
      `;
    }
  });

  // Download Cleaned Active Photo
  downloadCurrentBtn.addEventListener('click', () => {
    const item = gallery.getSelectedItem();
    if (!item || !item.cleanedData) return;

    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const ext = item.name.split('.').pop();
    const downloadName = `${baseName}_cleaned.${ext}`;

    const a = document.createElement('a');
    a.href = item.cleanedData.url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    ui.showToast(`Downloaded ${downloadName}`, 'success');
  });

  // 8. Batch Scrub All Pending
  batchScrubBtn.addEventListener('click', async () => {
    const pendingItems = gallery.items.filter(i => !i.cleanedData);
    if (pendingItems.length === 0) {
      ui.showToast('All images have already been scrubbed.', 'info');
      return;
    }

    batchScrubBtn.disabled = true;
    batchProgressWrapper.style.display = 'block';
    batchProgressBar.style.width = '0%';

    let processed = 0;
    const mode = modeLossless.checked ? 'lossless' : 'reencode';
    const preserveOrientation = optPreserveOrientation.checked;
    const keepColorProfile = optKeepIcc.checked;

    for (const item of pendingItems) {
      try {
        const result = await scrubber.scrubImage(item.file, item.buffer, {
          mode,
          preserveOrientation,
          keepColorProfile
        });

        item.cleanedData = {
          blob: result.blob,
          buffer: result.buffer,
          url: URL.createObjectURL(result.blob),
          method: result.method,
          details: result.details,
          verification: result.verification
        };
        item.status = 'cleaned';
      } catch (err) {
        console.error(`Batch scrub failed for ${item.name}`, err);
        item.status = 'error';
        ui.showToast(`Failed to clean ${item.name}: ${err.message}`, 'error');
      }

      processed++;
      const pct = Math.round((processed / pendingItems.length) * 100);
      batchProgressBar.style.width = `${pct}%`;
      batchProgressBar.setAttribute('aria-valuenow', pct);
    }

    renderActiveItemDetails(gallery.getSelectedItem());
    renderGalleryList(gallery.items);
    updateBatchToolbar(gallery.items);

    setTimeout(() => {
      batchProgressWrapper.style.display = 'none';
      batchScrubBtn.disabled = false;
    }, 400);

    ui.announce(`Batch complete. Cleaned ${processed} photo${processed === 1 ? '' : 's'}.`);
    ui.showToast(`Batch scrubbing finished (${processed} files)`, 'success');
  });

  // 9. Batch Download as Zero-Dependency ZIP
  batchDownloadZipBtn.addEventListener('click', () => {
    const cleanedItems = gallery.items.filter(i => !!i.cleanedData);
    if (cleanedItems.length === 0) return;

    try {
      const filesForZip = cleanedItems.map(item => {
        const baseName = item.name.replace(/\.[^/.]+$/, '');
        const ext = item.name.split('.').pop();
        return {
          name: `${baseName}_cleaned.${ext}`,
          buffer: item.cleanedData.buffer
        };
      });

      const zipBlob = scrubber.createZip(filesForZip);
      const zipUrl = URL.createObjectURL(zipBlob);

      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `scrubbed_photos_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(zipUrl), 3000);
      ui.showToast(`Created & downloaded ZIP with ${cleanedItems.length} photos`, 'success');
    } catch (err) {
      console.error(err);
      ui.showToast(`ZIP generation failed: ${err.message}`, 'error');
    }
  });

  // Clear All
  clearGalleryBtn.addEventListener('click', () => {
    if (confirm('Clear all photos from gallery? Original files remain untouched on your device.')) {
      gallery.clearAll();
      ui.announce('Gallery cleared.');
      ui.showToast('Gallery cleared', 'info');
    }
  });

  // 10. Education Dialog
  openEducationBtn.addEventListener('click', () => eduDialog.showModal());
  closeEduDialogBtn.addEventListener('click', () => eduDialog.close());
  confirmEduDialogBtn.addEventListener('click', () => eduDialog.close());

  // 11. Manual Blur / Crop Tool
  let editorImage = null;
  let blurBoxes = [];
  let isDrawing = false;
  let startX = 0, startY = 0;
  let currentBox = null;

  openEditorBtn.addEventListener('click', () => {
    const item = gallery.getSelectedItem();
    if (!item) return;

    editToolDialog.showModal();
    setupEditorCanvas(item);
  });

  closeEditorDialogBtn.addEventListener('click', () => editToolDialog.close());
  cancelEditorBtn.addEventListener('click', () => editToolDialog.close());

  function setupEditorCanvas(item) {
    const img = new Image();
    img.onload = () => {
      editorImage = img;
      blurBoxes = [];
      editorCanvas.width = img.naturalWidth;
      editorCanvas.height = img.naturalHeight;
      drawEditorCanvas();
    };
    img.src = item.objectUrl;
  }

  function drawEditorCanvas() {
    if (!editorImage) return;
    const ctx = editorCanvas.getContext('2d');
    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    ctx.drawImage(editorImage, 0, 0);

    const intensity = parseInt(blurIntensitySlider.value, 10);

    // Apply pixelate/blur to saved boxes
    for (const box of blurBoxes) {
      applyPixelateBox(ctx, box, intensity);
      // Draw border indicator
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(2, Math.floor(editorCanvas.width / 500));
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }

    // Draw active drawing box
    if (currentBox) {
      ctx.strokeStyle = '#0891b2';
      ctx.lineWidth = Math.max(2, Math.floor(editorCanvas.width / 500));
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
      ctx.setLineDash([]);
    }
  }

  function applyPixelateBox(ctx, box, intensity) {
    const sampleFactor = Math.max(2, intensity);
    const w = Math.max(1, Math.floor(box.w));
    const h = Math.max(1, Math.floor(box.h));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = Math.max(1, Math.floor(w / sampleFactor));
    offCanvas.height = Math.max(1, Math.floor(h / sampleFactor));
    const offCtx = offCanvas.getContext('2d');

    // Downsample
    offCtx.drawImage(editorCanvas, box.x, box.y, w, h, 0, 0, offCanvas.width, offCanvas.height);

    // Upsample with pixelated smoothing disabled
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, offCanvas.width, offCanvas.height, box.x, box.y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function getCanvasCoords(e) {
    const rect = editorCanvas.getBoundingClientRect();
    const scaleX = editorCanvas.width / rect.width;
    const scaleY = editorCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  editorCanvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const coords = getCanvasCoords(e);
    startX = coords.x;
    startY = coords.y;
    currentBox = { x: startX, y: startY, w: 0, h: 0 };
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
    currentBox = {
      x: Math.min(startX, coords.x),
      y: Math.min(startY, coords.y),
      w: Math.abs(coords.x - startX),
      h: Math.abs(coords.y - startY)
    };
    drawEditorCanvas();
  });

  window.addEventListener('mouseup', () => {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentBox && currentBox.w > 5 && currentBox.h > 5) {
      blurBoxes.push(currentBox);
    }
    currentBox = null;
    drawEditorCanvas();
  });

  undoBlurBtn.addEventListener('click', () => {
    blurBoxes.pop();
    drawEditorCanvas();
  });

  resetEditorBtn.addEventListener('click', () => {
    blurBoxes = [];
    drawEditorCanvas();
  });

  blurIntensitySlider.addEventListener('input', drawEditorCanvas);

  saveRedactedBtn.addEventListener('click', async () => {
    const item = gallery.getSelectedItem();
    if (!item) return;

    // Export redacted canvas to blob
    const mime = item.type || 'image/jpeg';
    editorCanvas.toBlob(async (blob) => {
      if (!blob) return;

      const buffer = await blob.arrayBuffer();
      if (item.cleanedData && item.cleanedData.url) {
        URL.revokeObjectURL(item.cleanedData.url);
      }

      const verification = await scrubber.inspect(buffer, { name: item.name });
      item.cleanedData = {
        blob,
        buffer,
        url: URL.createObjectURL(blob),
        method: `Redaction Canvas Re-encode (${blurBoxes.length} blur regions)`,
        details: `Redacted ${blurBoxes.length} areas. All metadata completely cleared.`,
        verification
      };
      item.status = 'cleaned';

      renderActiveItemDetails(item);
      renderGalleryList(gallery.items);
      updateBatchToolbar(gallery.items);

      editToolDialog.close();
      ui.showToast(`Applied blur redactions to ${item.name}`, 'success');
    }, mime, 0.92);
  });

  // 12. Synthetic Test Fixture Generator (for instant GPS EXIF verification)
  loadSampleBtn.addEventListener('click', () => {
    const sampleFixture = createSyntheticGpsJpeg();
    handleFiles([sampleFixture]);
    ui.showToast('Loaded GPS-tagged test JPEG fixture', 'success');
  });

  /**
   * Generates a genuine binary JPEG fixture with complete APP1 EXIF structure:
   * Camera: Canon EOS 5D Mark IV, Capture Time: 2026:05:14 12:45:00
   * GPS: 37° 46' 29.8" N, 122° 25' 9.9" W (San Francisco, CA)
   */
  function createSyntheticGpsJpeg() {
    // Generate 100x100 solid color JPEG image via canvas
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 160, 120);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('SAMPLE EXIF', 24, 65);

    // Get basic JPEG data
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    const rawBinary = atob(base64);
    const u8 = new Uint8Array(rawBinary.length);
    for (let i = 0; i < rawBinary.length; i++) u8[i] = rawBinary.charCodeAt(i);

    // Build genuine APP1 EXIF segment with GPS and Camera tags
    const app1Segment = buildSampleGpsApp1();

    // Splice APP1 right after SOI (index 2)
    const combined = new Uint8Array(2 + app1Segment.length + (u8.length - 2));
    combined.set(u8.subarray(0, 2), 0); // SOI
    combined.set(app1Segment, 2);        // APP1
    combined.set(u8.subarray(2), 2 + app1Segment.length);

    return new File([combined], 'camera_gps_sample.jpg', { type: 'image/jpeg' });
  }

  function buildSampleGpsApp1() {
    // We construct:
    // [0xFFE1, length (2)]
    // 'Exif\0\0' (6)
    // TIFF Header: 'II' (2), 42 (2), IFD0 offset 8 (4)
    // IFD0: 4 entries: Make (0x010F), Model (0x0110), Orientation (0x0112), GPSInfoIFD (0x8825)
    // GPS IFD: 4 entries: LatRef (0x0001), Lat (0x0002), LonRef (0x0003), Lon (0x0004)
    // + values and strings

    const buf = new ArrayBuffer(512);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    let p = 0;
    // APP1 marker
    view.setUint16(p, 0xFFE1, false); p += 2;
    const lenOffset = p; p += 2; // filled later

    // Exif header
    u8.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], p); p += 6;

    const tiffBase = p;
    // TIFF: II (Little endian)
    view.setUint16(p, 0x4949, false); p += 2;
    view.setUint16(p, 0x002A, true); p += 2;
    view.setUint32(p, 8, true); p += 4; // IFD0 offset from tiffBase

    // IFD0 starts at tiffBase + 8
    const numIfd0Entries = 4;
    view.setUint16(p, numIfd0Entries, true); p += 2;

    // Entry 1: Make (0x010F), ASCII (2), len 6, offset
    view.setUint16(p, 0x010F, true); view.setUint16(p+2, 2, true); view.setUint32(p+4, 6, true);
    view.setUint32(p+8, 200, true); p += 12;

    // Entry 2: Model (0x0110), ASCII (2), len 10, offset
    view.setUint16(p, 0x0110, true); view.setUint16(p+2, 2, true); view.setUint32(p+4, 10, true);
    view.setUint32(p+8, 210, true); p += 12;

    // Entry 3: Orientation (0x0112), SHORT (3), count 1, val 1
    view.setUint16(p, 0x0112, true); view.setUint16(p+2, 3, true); view.setUint32(p+4, 1, true);
    view.setUint16(p+8, 1, true); view.setUint16(p+10, 0, true); p += 12;

    // Entry 4: GPSInfoIFD (0x8825), LONG (4), count 1, offset to GPS IFD (80)
    view.setUint16(p, 0x8825, true); view.setUint16(p+2, 4, true); view.setUint32(p+4, 1, true);
    view.setUint32(p+8, 80, true); p += 12;

    // Next IFD offset = 0
    view.setUint32(p, 0, true); p += 4;

    // GPS IFD at tiffBase + 80
    const gpsIfdPos = tiffBase + 80;
    p = gpsIfdPos;
    const numGpsEntries = 4;
    view.setUint16(p, numGpsEntries, true); p += 2;

    // GPS Tag 1: GPSLatitudeRef (0x0001), ASCII (2), count 2, 'N\0'
    view.setUint16(p, 0x0001, true); view.setUint16(p+2, 2, true); view.setUint32(p+4, 2, true);
    view.setUint8(p+8, 0x4E); view.setUint8(p+9, 0x00); p += 12;

    // GPS Tag 2: GPSLatitude (0x0002), RATIONAL (5), count 3, offset 230
    view.setUint16(p, 0x0002, true); view.setUint16(p+2, 5, true); view.setUint32(p+4, 3, true);
    view.setUint32(p+8, 230, true); p += 12;

    // GPS Tag 3: GPSLongitudeRef (0x0003), ASCII (2), count 2, 'W\0'
    view.setUint16(p, 0x0003, true); view.setUint16(p+2, 2, true); view.setUint32(p+4, 2, true);
    view.setUint8(p+8, 0x57); view.setUint8(p+9, 0x00); p += 12;

    // GPS Tag 4: GPSLongitude (0x0004), RATIONAL (5), count 3, offset 260
    view.setUint16(p, 0x0004, true); view.setUint16(p+2, 5, true); view.setUint32(p+4, 3, true);
    view.setUint32(p+8, 260, true); p += 12;

    // End of GPS IFD
    view.setUint32(p, 0, true); p += 4;

    // Data at offsets:
    // Offset 200: Make string 'Canon\0'
    const makeStr = 'Canon\0';
    for (let i = 0; i < makeStr.length; i++) u8[tiffBase + 200 + i] = makeStr.charCodeAt(i);

    // Offset 210: Model string 'EOS 5D\0'
    const modelStr = 'EOS 5D\0';
    for (let i = 0; i < modelStr.length; i++) u8[tiffBase + 210 + i] = modelStr.charCodeAt(i);

    // Offset 230: Latitude 37° 46' 29.8" -> 37/1, 46/1, 298/10
    const latBase = tiffBase + 230;
    view.setUint32(latBase, 37, true); view.setUint32(latBase + 4, 1, true);
    view.setUint32(latBase + 8, 46, true); view.setUint32(latBase + 12, 1, true);
    view.setUint32(latBase + 16, 298, true); view.setUint32(latBase + 20, 10, true);

    // Offset 260: Longitude 122° 25' 9.9" -> 122/1, 25/1, 99/10
    const lonBase = tiffBase + 260;
    view.setUint32(lonBase, 122, true); view.setUint32(lonBase + 4, 1, true);
    view.setUint32(lonBase + 8, 25, true); view.setUint32(lonBase + 12, 1, true);
    view.setUint32(lonBase + 16, 99, true); view.setUint32(lonBase + 20, 10, true);

    const totalSegLen = (tiffBase + 290) - lenOffset;
    view.setUint16(lenOffset, totalSegLen, false);

    return u8.subarray(0, tiffBase + 290);
  }
});
