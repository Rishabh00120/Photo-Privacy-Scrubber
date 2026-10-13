/**
 * exif.js - Binary EXIF/TIFF parsing and metadata extraction
 * Supports TIFF Big-Endian (MM) and Little-Endian (II)
 * GPS rational-to-decimal conversion with N/S, E/W references
 * Defensive bounds checking, loop limits, and tag dictionary lookup
 */

class ExifParser {
  constructor(tagDictionary = {}) {
    this.tags = tagDictionary;
  }

  setTags(tagDictionary) {
    this.tags = tagDictionary;
  }

  /**
   * Parse TIFF header and IFDs from an ArrayBuffer / DataView
   * @param {DataView} view 
   * @param {number} tiffOffset - Byte offset where TIFF header starts
   * @returns {Object} Extracted tags, GPS details, and raw IFDs
   */
  parseTiff(view, tiffOffset) {
    const result = {
      isValid: false,
      isLittleEndian: false,
      ifd0: {},
      exifIfd: {},
      gpsIfd: {},
      allTags: [],
      gpsData: null,
      orientation: 1,
      errors: []
    };

    if (view.byteLength < tiffOffset + 8) {
      result.errors.push('TIFF header truncated');
      return result;
    }

    const byteOrderMarker = view.getUint16(tiffOffset, false);
    let littleEndian = false;
    if (byteOrderMarker === 0x4949) { // 'II' = Intel Little Endian
      littleEndian = true;
    } else if (byteOrderMarker === 0x4D4D) { // 'MM' = Motorola Big Endian
      littleEndian = false;
    } else {
      result.errors.push(`Invalid TIFF byte order marker: 0x${byteOrderMarker.toString(16)}`);
      return result;
    }

    result.isLittleEndian = littleEndian;

    const fortyTwo = view.getUint16(tiffOffset + 2, littleEndian);
    if (fortyTwo !== 0x002A) {
      result.errors.push(`Invalid TIFF identification 42 marker: 0x${fortyTwo.toString(16)}`);
      return result;
    }

    const firstIFDOffset = view.getUint32(tiffOffset + 4, littleEndian);
    if (firstIFDOffset < 8 || tiffOffset + firstIFDOffset >= view.byteLength) {
      result.errors.push(`First IFD offset out of bounds: ${firstIFDOffset}`);
      return result;
    }

    result.isValid = true;

    // Parse IFD0
    const ifd0 = this.readIFD(view, tiffOffset, firstIFDOffset, littleEndian, 'IFD0');
    result.ifd0 = ifd0.tags;
    result.allTags.push(...ifd0.tagList);

    if (result.ifd0[0x0112] !== undefined) {
      result.orientation = result.ifd0[0x0112].value;
    }

    // Pointer to Exif SubIFD (0x8769)
    if (result.ifd0[0x8769]) {
      const exifOffset = result.ifd0[0x8769].value;
      if (typeof exifOffset === 'number' && tiffOffset + exifOffset < view.byteLength) {
        const exifIfd = this.readIFD(view, tiffOffset, exifOffset, littleEndian, 'ExifIFD');
        result.exifIfd = exifIfd.tags;
        result.allTags.push(...exifIfd.tagList);
      }
    }

    // Pointer to GPS IFD (0x8825)
    let gpsOffset = null;
    if (result.ifd0[0x8825]) {
      gpsOffset = result.ifd0[0x8825].value;
    } else if (result.exifIfd[0x8825]) {
      gpsOffset = result.exifIfd[0x8825].value;
    }

    if (gpsOffset && typeof gpsOffset === 'number' && tiffOffset + gpsOffset < view.byteLength) {
      const gpsIfd = this.readIFD(view, tiffOffset, gpsOffset, littleEndian, 'GPSInfo', true);
      result.gpsIfd = gpsIfd.tags;
      result.allTags.push(...gpsIfd.tagList);
      result.gpsData = this.decodeGPS(result.gpsIfd);
    }

    return result;
  }

  /**
   * Reads an individual IFD block safely with bounds checking
   */
  readIFD(view, tiffOffset, ifdRelativeOffset, littleEndian, ifdName, isGPS = false) {
    const tags = {};
    const tagList = [];
    const ifdAbsOffset = tiffOffset + ifdRelativeOffset;

    if (ifdAbsOffset + 2 > view.byteLength) {
      return { tags, tagList };
    }

    const numEntries = view.getUint16(ifdAbsOffset, littleEndian);
    // Safety guard against malicious files with huge entry counts
    const maxEntries = Math.min(numEntries, 256);

    for (let i = 0; i < maxEntries; i++) {
      const entryOffset = ifdAbsOffset + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;

      const tagId = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      const valueOffsetOrValue = entryOffset + 8;

      const val = this.readTagValue(view, tiffOffset, valueOffsetOrValue, type, count, littleEndian);
      if (val !== undefined) {
        const tagHex = '0x' + tagId.toString(16).toUpperCase().padStart(4, '0');
        const lookupKey = isGPS ? `${tagHex}_GPS` : tagHex;
        const tagMeta = this.tags[lookupKey] || this.tags[tagHex] || {
          name: `${ifdName}_Tag_${tagHex}`,
          category: isGPS ? 'Location & GPS' : 'Other Metadata',
          risk: isGPS ? 'High' : 'Low',
          description: `Raw tag ${tagHex}`
        };

        const parsedEntry = {
          tagId,
          tagHex,
          name: tagMeta.name,
          category: tagMeta.category,
          risk: tagMeta.risk,
          description: tagMeta.description,
          rawType: type,
          count,
          value: val,
          formattedValue: this.formatTagValue(tagId, val, isGPS),
          ifd: ifdName
        };

        tags[tagId] = parsedEntry;
        tagList.push(parsedEntry);
      }
    }

    return { tags, tagList };
  }

  /**
   * Decodes TIFF tag value based on type and count
   */
  readTagValue(view, tiffOffset, offsetOrValue, type, count, littleEndian) {
    if (count > 65536) return undefined; // Protect against memory exhaustion

    const typeSizes = {
      1: 1, // BYTE (uint8)
      2: 1, // ASCII (string)
      3: 2, // SHORT (uint16)
      4: 4, // LONG (uint32)
      5: 8, // RATIONAL (two LONGs)
      7: 1, // UNDEFINED (uint8)
      9: 4, // SLONG (int32)
      10: 8 // SRATIONAL (two SLONGs)
    };

    const typeSize = typeSizes[type];
    if (!typeSize) return undefined;

    const totalBytes = typeSize * count;
    let dataOffset;

    if (totalBytes <= 4) {
      dataOffset = offsetOrValue;
    } else {
      const relOffset = view.getUint32(offsetOrValue, littleEndian);
      dataOffset = tiffOffset + relOffset;
    }

    if (dataOffset + totalBytes > view.byteLength || dataOffset < 0) {
      return undefined; // Out of bounds
    }

    try {
      if (type === 2) { // ASCII String
        let str = '';
        for (let i = 0; i < count; i++) {
          const charCode = view.getUint8(dataOffset + i);
          if (charCode === 0) break; // null terminator
          str += String.fromCharCode(charCode);
        }
        return str.trim();
      }

      if (type === 5 || type === 10) { // RATIONAL / SRATIONAL
        const rationals = [];
        for (let i = 0; i < count; i++) {
          const numOffset = dataOffset + i * 8;
          const numerator = type === 5 ? view.getUint32(numOffset, littleEndian) : view.getInt32(numOffset, littleEndian);
          const denominator = type === 5 ? view.getUint32(numOffset + 4, littleEndian) : view.getInt32(numOffset + 4, littleEndian);
          rationals.push({ numerator, denominator, value: denominator === 0 ? 0 : numerator / denominator });
        }
        return count === 1 ? rationals[0] : rationals;
      }

      if (type === 3) { // SHORT
        const shorts = [];
        for (let i = 0; i < count; i++) {
          shorts.push(view.getUint16(dataOffset + i * 2, littleEndian));
        }
        return count === 1 ? shorts[0] : shorts;
      }

      if (type === 4) { // LONG
        const longs = [];
        for (let i = 0; i < count; i++) {
          longs.push(view.getUint32(dataOffset + i * 4, littleEndian));
        }
        return count === 1 ? longs[0] : longs;
      }

      if (type === 1 || type === 7) { // BYTE / UNDEFINED
        if (count === 1) return view.getUint8(dataOffset);
        const bytes = [];
        for (let i = 0; i < Math.min(count, 64); i++) {
          bytes.push(view.getUint8(dataOffset + i));
        }
        return bytes;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  /**
   * Formats tag values into human-readable strings
   */
  formatTagValue(tagId, val, isGPS) {
    if (val === null || val === undefined) return '';

    if (isGPS) {
      if (tagId === 0x0001 || tagId === 0x0003) { // Lat/Long Ref
        return String(val);
      }
      if ((tagId === 0x0002 || tagId === 0x0004) && Array.isArray(val)) { // Lat/Long coords
        return val.map(r => typeof r === 'object' ? `${r.numerator}/${r.denominator}` : r).join(', ');
      }
      if (tagId === 0x0006 && typeof val === 'object') { // Altitude
        return `${val.value.toFixed(2)} m (${val.numerator}/${val.denominator})`;
      }
    }

    if (tagId === 0x0112) { // Orientation
      const map = {
        1: 'Top-left (Normal, 0°)',
        2: 'Top-right (Mirrored horizontal)',
        3: 'Bottom-right (Rotated 180°)',
        4: 'Bottom-left (Mirrored vertical)',
        5: 'Left-top (Mirrored horizontal & 90° CCW)',
        6: 'Right-top (Rotated 90° CW)',
        7: 'Right-bottom (Mirrored horizontal & 90° CW)',
        8: 'Left-bottom (Rotated 90° CCW)'
      };
      return map[val] || `Orientation ${val}`;
    }

    if (tagId === 0x829A && typeof val === 'object') { // Exposure Time
      if (val.value < 1 && val.numerator > 0) {
        return `1/${Math.round(val.denominator / val.numerator)} sec (${val.value}s)`;
      }
      return `${val.value} sec`;
    }

    if (tagId === 0x829D && typeof val === 'object') { // FNumber
      return `f/${val.value.toFixed(1)}`;
    }

    if (tagId === 0x920A && typeof val === 'object') { // Focal Length
      return `${val.value.toFixed(1)} mm`;
    }

    if (typeof val === 'object' && val !== null) {
      if ('value' in val && typeof val.value === 'number') {
        return Number.isInteger(val.value) ? val.value.toString() : val.value.toFixed(2);
      }
      if (Array.isArray(val)) {
        return val.map(v => typeof v === 'object' && v !== null && 'value' in v ? v.value : v).join(', ');
      }
    }

    return String(val);
  }

  /**
   * Decodes GPS IFD entries into signed decimal degrees and altitude
   */
  decodeGPS(gpsIfd) {
    if (!gpsIfd) return null;

    const latRefEntry = gpsIfd[0x0001];
    const latEntry = gpsIfd[0x0002];
    const lonRefEntry = gpsIfd[0x0003];
    const lonEntry = gpsIfd[0x0004];

    if (!latEntry || !lonEntry) return null;

    const latVal = latEntry.value;
    const lonVal = lonEntry.value;
    const latRef = (latRefEntry ? String(latRefEntry.value).trim().toUpperCase() : 'N') || 'N';
    const lonRef = (lonRefEntry ? String(lonRefEntry.value).trim().toUpperCase() : 'E') || 'E';

    let latitude = this.convertCoordToDecimal(latVal, latRef);
    let longitude = this.convertCoordToDecimal(lonVal, lonRef);

    if (latitude === null || longitude === null) return null;

    let altitude = null;
    let altitudeRef = 'Above sea level';
    if (gpsIfd[0x0006]) {
      const altVal = gpsIfd[0x0006].value;
      altitude = typeof altVal === 'object' ? altVal.value : Number(altVal);
      if (gpsIfd[0x0005] && gpsIfd[0x0005].value === 1) {
        altitudeRef = 'Below sea level';
        altitude = -Math.abs(altitude);
      }
    }

    let timestamp = null;
    if (gpsIfd[0x0007]) {
      const t = gpsIfd[0x0007].value;
      if (Array.isArray(t) && t.length >= 3) {
        const h = Math.floor(typeof t[0] === 'object' ? t[0].value : t[0]);
        const m = Math.floor(typeof t[1] === 'object' ? t[1].value : t[1]);
        const s = Math.floor(typeof t[2] === 'object' ? t[2].value : t[2]);
        timestamp = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} UTC`;
      }
    }

    let datestamp = gpsIfd[0x001D] ? String(gpsIfd[0x001D].value) : null;

    return {
      latitude,
      longitude,
      latitudeRef: latRef,
      longitudeRef: lonRef,
      altitude,
      altitudeRef,
      timestamp,
      datestamp,
      formattedCoords: `${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`
    };
  }

  /**
   * Helper to convert DMS rational array to signed decimal degree
   */
  convertCoordToDecimal(dmsVal, ref) {
    if (!Array.isArray(dmsVal) || dmsVal.length < 3) return null;

    const d = typeof dmsVal[0] === 'object' ? dmsVal[0].value : Number(dmsVal[0]);
    const m = typeof dmsVal[1] === 'object' ? dmsVal[1].value : Number(dmsVal[1]);
    const s = typeof dmsVal[2] === 'object' ? dmsVal[2].value : Number(dmsVal[2]);

    if (isNaN(d) || isNaN(m) || isNaN(s)) return null;

    let decimal = d + (m / 60) + (s / 3600);
    if (ref === 'S' || ref === 'W') {
      decimal = -decimal;
    }
    return decimal;
  }
}

// Attach globally for browser usage without modules
window.ExifParser = ExifParser;
