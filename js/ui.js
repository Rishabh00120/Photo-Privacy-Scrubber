/**
 * ui.js - User Interface Rendering, Notifications, Dialogs, Bottom Sheet, and Offline SVG Visualizer
 * Implements accessible live-regions, risk badges, comparison previews, metadata tables, and educational modal
 */

class UIManager {
  constructor() {
    this.liveRegion = document.getElementById('aria-live-announcer');
    this.eduDialog = document.getElementById('educational-dialog');
    this.editDialog = document.getElementById('edit-tool-dialog');
  }

  announce(message) {
    if (this.liveRegion) {
      this.liveRegion.textContent = '';
      setTimeout(() => {
        this.liveRegion.textContent = message;
      }, 50);
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <span class="toast-icon">${this.getToastIcon(type)}</span>
      <span class="toast-text">${this.escapeHtml(message)}</span>
      <button type="button" class="toast-close" aria-label="Close notification">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
      }
    }, 4500);
  }

  getToastIcon(type) {
    if (type === 'success') {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === 'error') {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (type === 'warning') {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    }
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  renderRiskBadge(riskLevel) {
    const level = (riskLevel || 'LOW').toUpperCase();
    let badgeClass = 'risk-low';
    let iconSvg = '';
    let label = 'Low Privacy Risk';

    if (level === 'HIGH') {
      badgeClass = 'risk-high';
      iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      label = 'High Privacy Risk';
    } else if (level === 'MEDIUM') {
      badgeClass = 'risk-medium';
      iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      label = 'Medium Privacy Risk';
    } else {
      iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`;
    }

    return `
      <div class="risk-badge ${badgeClass}" role="status" aria-label="${label}">
        ${iconSvg}
        <span class="risk-badge-text">${label}</span>
      </div>
    `;
  }

  /**
   * Generates a completely self-contained, offline SVG location-precision radar illustration
   * No map tiles, external images, or online network calls.
   */
  generateOfflineLocationSvg(gps) {
    if (!gps) return '';

    const latStr = `${gps.latitude.toFixed(6)}° ${gps.latitudeRef}`;
    const lonStr = `${gps.longitude.toFixed(6)}° ${gps.longitudeRef}`;
    const altStr = gps.altitude !== null ? `${gps.altitude.toFixed(1)} m (${gps.altitudeRef})` : 'Not recorded';

    return `
      <div class="offline-location-card">
        <div class="location-graphic" aria-hidden="true">
          <svg viewBox="0 0 240 180" class="location-svg" role="img" aria-label="Offline radar illustration of detected GPS coordinates">
            <defs>
              <radialGradient id="radarPulse" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#ef4444" stop-opacity="0.35" />
                <stop offset="60%" stop-color="#ef4444" stop-opacity="0.12" />
                <stop offset="100%" stop-color="#ef4444" stop-opacity="0" />
              </radialGradient>
              <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--svg-radar-grid)" stroke-width="1"/>
              </pattern>
            </defs>
            <rect width="240" height="180" fill="var(--svg-radar-bg)" rx="8" />
            <rect width="240" height="180" fill="url(#gridPattern)" rx="8" />
            <!-- Concentric rings indicating GPS accuracy -->
            <circle cx="120" cy="90" r="70" fill="none" stroke="var(--svg-radar-ring)" stroke-width="1.5" stroke-dasharray="3,3" />
            <circle cx="120" cy="90" r="45" fill="none" stroke="var(--svg-radar-axis)" stroke-width="1.5" />
            <circle cx="120" cy="90" r="22" fill="url(#radarPulse)" />
            <circle cx="120" cy="90" r="22" fill="none" stroke="#ef4444" stroke-width="2" />
            <!-- Crosshairs -->
            <line x1="30" y1="90" x2="210" y2="90" stroke="var(--svg-radar-axis)" stroke-width="1" stroke-dasharray="4,4" />
            <line x1="120" y1="20" x2="120" y2="160" stroke="var(--svg-radar-axis)" stroke-width="1" stroke-dasharray="4,4" />
            <!-- Target pin center -->
            <circle cx="120" cy="90" r="5" fill="#dc2626" />
            <circle cx="120" cy="90" r="2" fill="#ffffff" />
            <!-- Compass directions -->
            <text x="120" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="var(--text-muted)">N</text>
            <text x="120" y="174" text-anchor="middle" font-size="9" font-weight="700" fill="var(--text-muted)">S</text>
            <text x="12" y="93" text-anchor="start" font-size="9" font-weight="700" fill="var(--text-muted)">W</text>
            <text x="228" y="93" text-anchor="end" font-size="9" font-weight="700" fill="var(--text-muted)">E</text>
          </svg>
        </div>
        <div class="location-details">
          <dl class="meta-dl">
            <div class="dl-row">
              <dt>Latitude</dt>
              <dd><code class="coord-val">${this.escapeHtml(latStr)}</code></dd>
            </div>
            <div class="dl-row">
              <dt>Longitude</dt>
              <dd><code class="coord-val">${this.escapeHtml(lonStr)}</code></dd>
            </div>
            <div class="dl-row">
              <dt>Altitude</dt>
              <dd>${this.escapeHtml(altStr)}</dd>
            </div>
            ${gps.timestamp ? `
            <div class="dl-row">
              <dt>Atomic Satellite Time</dt>
              <dd>${this.escapeHtml(gps.timestamp)}</dd>
            </div>` : ''}
          </dl>
          <p class="location-offline-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Rendered offline without external map requests. Exposes exact geographic location down to building/street precision.
          </p>
        </div>
      </div>
    `;
  }

  renderMetadataTable(metadataList) {
    if (!metadataList || metadataList.length === 0) {
      return `<p class="empty-notice">No metadata fields were found in this image.</p>`;
    }

    // Group tags by category
    const categories = {};
    for (const tag of metadataList) {
      const cat = tag.category || 'Other Metadata';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(tag);
    }

    let html = '';
    for (const [catName, tags] of Object.entries(categories)) {
      html += `
        <div class="meta-category-block">
          <h4 class="meta-category-title">${this.escapeHtml(catName)} <span class="tag-count">(${tags.length})</span></h4>
          <div class="table-container">
            <table class="meta-table">
              <thead>
                <tr>
                  <th scope="col" style="width: 25%">Tag / Field</th>
                  <th scope="col" style="width: 45%">Decoded Value</th>
                  <th scope="col" style="width: 15%">Tag ID</th>
                  <th scope="col" style="width: 15%">Privacy Impact</th>
                </tr>
              </thead>
              <tbody>
                ${tags.map(tag => `
                  <tr class="meta-row-${(tag.risk || 'low').toLowerCase()}">
                    <td>
                      <strong>${this.escapeHtml(tag.name || 'Unknown')}</strong>
                      ${tag.description ? `<span class="tag-desc">${this.escapeHtml(tag.description)}</span>` : ''}
                    </td>
                    <td>
                      <span class="tag-val">${this.escapeHtml(String(tag.formattedValue || tag.value || ''))}</span>
                    </td>
                    <td><code>${this.escapeHtml(tag.tagHex || '')}</code></td>
                    <td>
                      <span class="impact-pill impact-${(tag.risk || 'low').toLowerCase()}">
                        ${this.escapeHtml(tag.risk || 'Low')}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    return html;
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Attach globally
window.UIManager = UIManager;
