/**
 * jpeg.js - JPEG Marker traversal, APP segment inspection, and byte-level metadata removal
 * Validates SOI (0xFFD8) and EOI (0xFFD9)
 * Identifies APP1 (EXIF/XMP), APP2 (ICC/FlashPix), APP13 (IPTC/Photoshop), COM (Comments)
 * Strips metadata segments losslessly without touching SOS or compressed scan entropy
 * Supports selective orientation retention by generating a minimal clean EXIF APP1
 */

class JpegProcessor {
  constructor(exifParser) {
    this.exifParser = exifParser || new window.ExifParser();
  }

  /**
   * Validate whether an ArrayBuffer contains a valid JPEG image
   */
  isValidJpeg(buffer) {
    if (!buffer || buffer.byteLength < 4) return false;
    const view = new DataView(buffer);
    return view.getUint16(0, false) === 0xFFD8; // SOI marker
  }

  /**
   * Parse segments and markers in a JPEG buffer
   * Stops when SOS (0xFFDA) is reached, because after SOS comes compressed scan data
   */
  parseSegments(buffer) {
    const view = new DataView(buffer);
    const length = buffer.byteLength;
    const segments = [];
    const errors = [];

    if (!this.isValidJpeg(buffer)) {
      return { isValid: false, segments: [], errors: ['Not a valid JPEG image (missing SOI 0xFFD8)'] };
    }

    let offset = 2; // skip SOI
    let foundSOS = false;

    while (offset < length - 1) {
      if (view.getUint8(offset) !== 0xFF) {
        // Handle potential padding or corruption
        offset++;
        continue;
      }

      let marker = view.getUint8(offset + 1);
      // Skip fill bytes 0xFF
      while (marker === 0xFF && offset + 1 < length - 1) {
        offset++;
        marker = view.getUint8(offset + 1);
      }

      const markerOffset = offset;
      offset += 2;

      // Standalone markers without length: RST0-RST7, SOI, EOI, TEM
      if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8 || marker === 0xD9 || marker === 0x01) {
        segments.push({
          marker,
          markerHex: '0xFF' + marker.toString(16).toUpperCase().padStart(2, '0'),
          name: this.getMarkerName(marker),
          offset: markerOffset,
          length: 2,
          isStandalone: true
        });
        if (marker === 0xD9) break; // EOI
        continue;
      }

      // SOS (Start of Scan) - after this is entropy-coded image data
      if (marker === 0xDA) {
        if (offset + 2 > length) {
          errors.push('Truncated SOS marker header');
          break;
        }
        const segLength = view.getUint16(offset, false);
        segments.push({
          marker,
          markerHex: '0xFFDA',
          name: 'SOS (Start of Scan)',
          offset: markerOffset,
          length: segLength + 2,
          headerLength: segLength + 2,
          isSOS: true
        });
        foundSOS = true;
        break; // Stop parsing headers, the rest until EOI is scan data
      }

      if (offset + 2 > length) {
        errors.push(`Truncated segment header for marker 0xFF${marker.toString(16).toUpperCase()}`);
        break;
      }

      const segLength = view.getUint16(offset, false);
      if (segLength < 2 || offset + segLength > length) {
        errors.push(`Invalid segment length ${segLength} at offset ${offset}`);
        break;
      }

      const segDataOffset = offset + 2;
      const segPayloadLength = segLength - 2;

      const segInfo = {
        marker,
        markerHex: '0xFF' + marker.toString(16).toUpperCase().padStart(2, '0'),
        name: this.getMarkerName(marker),
        offset: markerOffset,
        length: segLength + 2,
        dataOffset: segDataOffset,
        dataLength: segPayloadLength,
        type: 'structural'
      };

      // Identify Metadata APP segments
      if (marker === 0xE1) { // APP1: EXIF or XMP
        const headerStr = this.readString(buffer, segDataOffset, Math.min(segPayloadLength, 10));
        if (headerStr.startsWith('Exif\0\0')) {
          segInfo.type = 'APP1_EXIF';
          segInfo.description = 'EXIF Metadata (Camera, GPS, Timestamps)';
          segInfo.exifOffset = segDataOffset + 6; // start of TIFF header
        } else if (headerStr.startsWith('http://ns.adobe.com/xap/1.0/')) {
          segInfo.type = 'APP1_XMP';
          segInfo.description = 'Adobe XMP Metadata (History, UUIDs, Software)';
        } else {
          segInfo.type = 'APP1_OTHER';
          segInfo.description = 'APP1 Segment';
        }
      } else if (marker === 0xE2) { // APP2: ICC profile or FlashPix
        const headerStr = this.readString(buffer, segDataOffset, 12);
        if (headerStr.startsWith('ICC_PROFILE\0')) {
          segInfo.type = 'APP2_ICC';
          segInfo.description = 'ICC Color Profile';
        } else {
          segInfo.type = 'APP2';
          segInfo.description = 'APP2 Segment';
        }
      } else if (marker === 0xED) { // APP13: Photoshop / IPTC
        segInfo.type = 'APP13_IPTC';
        segInfo.description = 'IPTC / Photoshop Resource Block (Captions, Author)';
      } else if (marker === 0xFE) { // COM: Comment
        segInfo.type = 'COM';
        segInfo.description = 'JPEG Text Comment';
      } else if (marker >= 0xE0 && marker <= 0xEF) {
        segInfo.type = `APP${marker - 0xE0}`;
        segInfo.description = `Application Segment APP${marker - 0xE0}`;
      }

      segments.push(segInfo);
      offset += segLength;
    }

    return {
      isValid: true,
      hasSOS: foundSOS,
      segments,
      errors
    };
  }

  /**
   * Extract EXIF information from JPEG if present
   */
  extractExif(buffer) {
    const parseRes = this.parseSegments(buffer);
    if (!parseRes.isValid) {
      return { success: false, error: parseRes.errors.join(', ') };
    }

    const exifSeg = parseRes.segments.find(s => s.type === 'APP1_EXIF');
    if (!exifSeg) {
      return {
        success: true,
        hasExif: false,
        exifData: null,
        metadataSegments: parseRes.segments.filter(s => this.isMetadataSegment(s))
      };
    }

    const view = new DataView(buffer);
    const parsedExif = this.exifParser.parseTiff(view, exifSeg.exifOffset);

    return {
      success: true,
      hasExif: true,
      exifData: parsedExif,
      metadataSegments: parseRes.segments.filter(s => this.isMetadataSegment(s)),
      allSegments: parseRes.segments
    };
  }

  isMetadataSegment(seg) {
    // Segments that leak metadata or can be safely stripped without breaking pixel rendering
    // APP1 (Exif, XMP), APP13 (IPTC), COM (Comments), APP2 (except ICC if user chooses to keep color), APP12, APP3-11
    if (seg.marker === 0xE1) return true; // EXIF / XMP
    if (seg.marker === 0xED) return true; // IPTC / Photoshop
    if (seg.marker === 0xFE) return true; // Comment
    if (seg.marker >= 0xE2 && seg.marker <= 0xEF) {
      if (seg.type === 'APP2_ICC') return false; // keep ICC by default in lossless, or strip if specified
      return true;
    }
    return false;
  }

  /**
   * Mode A: Lossless metadata stripping
   * Reconstructs the JPEG by copying SOI, APP0 (JFIF), tables (DQT, DHT), frame headers (SOF0/SOF2),
   * and the entire SOS + compressed scan data through EOI, omitting metadata APP segments.
   * If preserveOrientation is requested and orientation > 1, inserts a minimal clean APP1
   * containing ONLY the Orientation tag in IFD0.
   * 
   * @param {ArrayBuffer} buffer
   * @param {Object} options { preserveOrientation: boolean, keepColorProfile: boolean }
   * @returns {Blob} Cleaned JPEG Blob
   */
  stripMetadataLossless(buffer, options = {}) {
    const { preserveOrientation = false, keepColorProfile = true } = options;
    const parseRes = this.parseSegments(buffer);

    if (!parseRes.isValid) {
      throw new Error(`Cannot strip metadata: ${parseRes.errors.join('; ')}`);
    }

    const u8 = new Uint8Array(buffer);
    const keptChunks = [];
    let strippedSegments = [];

    // Always include SOI (0xFFD8)
    keptChunks.push(u8.subarray(0, 2));

    let detectedOrientation = 1;

    // Scan segments before SOS
    let sosSegment = null;

    for (const seg of parseRes.segments) {
      if (seg.isSOS) {
        sosSegment = seg;
        break;
      }

      // Check if this segment should be removed
      let shouldStrip = false;

      if (seg.type === 'APP1_EXIF') {
        shouldStrip = true;
        // Check orientation if requested
        if (preserveOrientation && seg.exifOffset) {
          try {
            const view = new DataView(buffer);
            const exifData = this.exifParser.parseTiff(view, seg.exifOffset);
            if (exifData.orientation) {
              detectedOrientation = exifData.orientation;
            }
          } catch (e) {
            console.warn('Failed to parse orientation before stripping', e);
          }
        }
      } else if (seg.type === 'APP1_XMP' || seg.type === 'APP13_IPTC' || seg.type === 'COM' || seg.type === 'APP1_OTHER') {
        shouldStrip = true;
      } else if (seg.marker >= 0xE2 && seg.marker <= 0xEF) {
        if (seg.type === 'APP2_ICC') {
          shouldStrip = !keepColorProfile;
        } else {
          shouldStrip = true;
        }
      }

      if (shouldStrip) {
        strippedSegments.push({
          markerHex: seg.markerHex,
          name: seg.name,
          type: seg.type,
          bytes: seg.length
        });
      } else {
        // Keep segment intact
        keptChunks.push(u8.subarray(seg.offset, seg.offset + seg.length));
      }
    }

    // If preserveOrientation is requested and orientation != 1, construct minimal EXIF APP1
    if (preserveOrientation && detectedOrientation > 1) {
      const minimalApp1 = this.createMinimalOrientationApp1(detectedOrientation);
      // Insert right after SOI/APP0
      keptChunks.splice(1, 0, minimalApp1);
    }

    // Now copy from SOS offset all the way to end of file (including all scan data and EOI)
    if (sosSegment) {
      keptChunks.push(u8.subarray(sosSegment.offset));
    } else {
      throw new Error('Corrupt JPEG: missing SOS (Start of Scan) segment');
    }

    // Calculate total length and combine
    const totalLength = keptChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const outputBuffer = new Uint8Array(totalLength);
    let writeOffset = 0;
    for (const chunk of keptChunks) {
      outputBuffer.set(chunk, writeOffset);
      writeOffset += chunk.byteLength;
    }

    return {
      cleanedBuffer: outputBuffer.buffer,
      blob: new Blob([outputBuffer], { type: 'image/jpeg' }),
      strippedSegments,
      preservedOrientation: preserveOrientation ? detectedOrientation : null
    };
  }

  /**
   * Constructs a minimal, clean EXIF APP1 segment containing only orientation
   * TIFF Header (8 bytes) + IFD0 (2 bytes count + 1 entry * 12 bytes + 4 bytes next offset = 18 bytes)
   * Total EXIF payload = 6 (Exif\0\0) + 8 + 18 = 32 bytes
   * Total segment = 2 (marker) + 2 (len) + 32 = 36 bytes
   */
  createMinimalOrientationApp1(orientation) {
    const segLength = 2 + 6 + 8 + 18; // 34 bytes payload + 2 length
    const buf = new ArrayBuffer(segLength + 2);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);

    // Marker 0xFFE1
    view.setUint16(0, 0xFFE1, false);
    // Segment Length
    view.setUint16(2, segLength, false);

    // 'Exif\0\0'
    u8.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);

    // TIFF Header: 'II' (Little Endian)
    const tiffOffset = 10;
    view.setUint16(tiffOffset, 0x4949, false); // 'II'
    view.setUint16(tiffOffset + 2, 0x002A, true); // 42
    view.setUint32(tiffOffset + 4, 8, true); // First IFD offset is 8

    // IFD0
    const ifd0Offset = tiffOffset + 8;
    view.setUint16(ifd0Offset, 1, true); // 1 directory entry

    // Entry: Tag 0x0112 (Orientation), Type 3 (SHORT), Count 1, Value
    const entryOffset = ifd0Offset + 2;
    view.setUint16(entryOffset, 0x0112, true); // Tag ID
    view.setUint16(entryOffset + 2, 3, true);      // Type: SHORT
    view.setUint32(entryOffset + 4, 1, true);      // Count: 1
    view.setUint16(entryOffset + 8, orientation, true); // Value (in offset field since <= 4 bytes)
    view.setUint16(entryOffset + 10, 0, true);

    // Next IFD offset = 0
    view.setUint32(entryOffset + 12, 0, true);

    return u8;
  }

  readString(buffer, offset, length) {
    const u8 = new Uint8Array(buffer, offset, Math.min(length, buffer.byteLength - offset));
    let str = '';
    for (let i = 0; i < u8.length; i++) {
      str += String.fromCharCode(u8[i]);
    }
    return str;
  }

  getMarkerName(marker) {
    const names = {
      0xD8: 'SOI (Start of Image)',
      0xD9: 'EOI (End of Image)',
      0xDA: 'SOS (Start of Scan)',
      0xC0: 'SOF0 (Baseline DCT)',
      0xC2: 'SOF2 (Progressive DCT)',
      0xC4: 'DHT (Define Huffman Table)',
      0xDB: 'DQT (Define Quantization Table)',
      0xDD: 'DRI (Define Restart Interval)',
      0xE0: 'APP0 (JFIF)',
      0xE1: 'APP1 (EXIF/XMP)',
      0xE2: 'APP2 (ICC/FlashPix)',
      0xED: 'APP13 (Photoshop/IPTC)',
      0xEE: 'APP14 (Adobe)',
      0xFE: 'COM (Comment)'
    };
    return names[marker] || `APP${marker - 0xE0}`;
  }
}

// Attach globally
window.JpegProcessor = JpegProcessor;
