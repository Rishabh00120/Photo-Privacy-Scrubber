/**
 * gallery.js - Image management, Drag & Drop, Thumbnails, Object URLs, and Selection
 * Manages item list, lifecycle of Object URLs and Bitmaps, and file additions
 */

class ImageGallery {
  constructor(options = {}) {
    this.items = []; // Array of gallery items
    this.selectedItemId = null;
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.onItemsChange = options.onItemsChange || (() => {});
    this.idCounter = 1;
  }

  /**
   * Add a file to gallery, create preview URL and compute basic properties
   */
  async addFile(file) {
    // Check for obvious duplicate by filename + size + lastModified
    const isDuplicate = this.items.some(
      item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified
    );
    if (isDuplicate) {
      return { skipped: true, reason: 'Duplicate file already in gallery', name: file.name };
    }

    const id = `img_${this.idCounter++}_${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);
    const buffer = await file.arrayBuffer();

    // Read dimensions
    const dimensions = await this.readDimensions(file, objectUrl);

    const item = {
      id,
      file,
      name: file.name,
      size: file.size,
      formattedSize: this.formatBytes(file.size),
      type: file.type || 'image/jpeg',
      objectUrl,
      buffer, // Preserved original bytes
      width: dimensions.width,
      height: dimensions.height,
      status: 'pending', // 'pending' | 'inspecting' | 'ready' | 'scrubbing' | 'cleaned' | 'error'
      errorMessage: null,
      inspection: null,
      cleanedData: null // { blob, buffer, url, verification, method }
    };

    this.items.push(item);
    if (!this.selectedItemId) {
      this.selectedItemId = id;
    }

    this.onItemsChange(this.items);
    return { success: true, item };
  }

  readDimensions(file, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
      };
      img.src = url;
    });
  }

  getSelectedItem() {
    return this.items.find(item => item.id === this.selectedItemId) || this.items[0] || null;
  }

  selectItem(id) {
    if (this.selectedItemId !== id) {
      this.selectedItemId = id;
      this.onSelectionChange(this.getSelectedItem());
    }
  }

  removeItem(id) {
    const idx = this.items.findIndex(item => item.id === id);
    if (idx !== -1) {
      const item = this.items[idx];
      this.cleanupItemResources(item);
      this.items.splice(idx, 1);

      if (this.selectedItemId === id) {
        this.selectedItemId = this.items.length > 0 ? this.items[Math.max(0, idx - 1)].id : null;
        this.onSelectionChange(this.getSelectedItem());
      }
      this.onItemsChange(this.items);
    }
  }

  clearAll() {
    for (const item of this.items) {
      this.cleanupItemResources(item);
    }
    this.items = [];
    this.selectedItemId = null;
    this.onSelectionChange(null);
    this.onItemsChange(this.items);
  }

  cleanupItemResources(item) {
    if (item.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
      item.objectUrl = null;
    }
    if (item.cleanedData && item.cleanedData.url) {
      URL.revokeObjectURL(item.cleanedData.url);
      item.cleanedData.url = null;
    }
    // Dereference buffer
    item.buffer = null;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Attach globally
window.ImageGallery = ImageGallery;
