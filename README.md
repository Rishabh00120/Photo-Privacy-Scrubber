# Photo Privacy Scrubber

A production-grade, zero-dependency, browser-only web application that inspects hidden photo metadata (GPS coordinates, camera serial numbers, capture timestamps, software tags) and removes it before sharing — executed entirely within the browser's local memory.

Built strictly according to the specifications in **"20 New Frontend Projects Using Only HTML, CSS & JavaScript, Volume 2 — Project 3: Photo Privacy Scrubber"**.

---

## 1. Key Features & Capabilities

- **100% Client-Side Privacy**: Zero servers, zero telemetry, and zero tracking. All binary parsing and image processing happens in local browser memory via `ArrayBuffer`, `DataView`, and `Uint8Array`.
- **Deep Binary EXIF & TIFF Parser**: Custom decoder for Little-Endian (`II`) and Big-Endian (`MM`) TIFF structures, Image File Directories (IFD0, Exif SubIFD, GPS IFD), and signed GPS rational coordinate decoding.
- **Offline SVG Location Precision Radar**: Visualizes detected GPS coordinates (latitude, longitude, altitude) with a vector radar graphic without loading external maps, tiles, or sending geolocation requests.
- **Mode A: Lossless Metadata Stripping**:
  - **JPEG**: Removes metadata segments (`APP1` EXIF/XMP, `APP13` IPTC, `COM`) without touching `SOS` or compressed scan entropy data. Original pixels and compression quality are 100% preserved.
  - **PNG**: Strips ancillary chunks (`tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`) while retaining image bitstream chunks (`IHDR`, `PLTE`, `IDAT`, `IEND`).
  - **WebP**: Strips `EXIF` and `XMP` chunks from the RIFF container and automatically recalculates file header boundaries.
- **Mode B: Canvas Re-encoding**: Re-renders images to fresh canvases with orientation handled automatically, guaranteeing full elimination of obscure or malformed metadata.
- **Selective Orientation Retention**: Generates a clean, minimal `APP1` segment containing only the orientation tag (`0x0112`) when requested, ensuring photos display correctly without leaking privacy metadata.
- **Manual Redaction & Blur Tool**: Interactive canvas editor allowing users to click and drag to blur faces, license plates, or house numbers before exporting.
- **True Before / After Comparison**: Side-by-side inspection showing original vs. scrubbed previews, file sizes, and binary re-verification confirming total metadata removal.
- **Batch Processing & ZIP Downloads**: Multi-image processing with real-time progress indicators and a zero-dependency, pure JavaScript PKZIP 2.0 Store archive generator.
- **Accessible & Educational**: Semantic HTML5 elements (`<dialog>`, `<table>`, `<dl>`, `<figure>`, `<figcaption>`), high-contrast risk badges, and screen-reader `aria-live` announcements.

---

## 2. Project Structure

```
photo-privacy-scrubber/
├── index.html              # Semantic HTML5 layout, accessible controls & dialogs
├── css/
│   └── style.css           # Responsive design (mobile drawer, tablet 2-col, desktop)
├── js/
│   ├── exif.js             # Binary TIFF/EXIF parser, GPS rational conversion
│   ├── jpeg.js             # JPEG marker traversal and lossless segment stripper
│   ├── scrub.js            # Multi-format scrubber (JPEG, PNG, WebP), ZIP builder
│   ├── gallery.js          # File queue, thumbnails, and Object URL lifecycle
│   ├── ui.js               # Semantic tables, offline SVG radar, notifications
│   └── main.js             # Orchestration, blur/crop tool, test fixture
├── data/
│   └── exif-tags.json      # Dictionary of EXIF tags, categories, and risk ratings
└── assets/
    └── icons/
        └── shield.svg      # Vector icon assets
```

---

## 3. How to Run Locally

Because this project uses vanilla HTML, CSS, and JavaScript with static JSON data, no build step, Node.js, or package manager is required.

To test locally with `fetch('data/exif-tags.json')` support:
1. Serve the directory with any local static HTTP server, for example:
   ```bash
   npx serve photo-privacy-scrubber
   # or
   python -m http.server 8000 --directory photo-privacy-scrubber
   ```
2. Open `http://localhost:8000` in your web browser.

---

## 4. Verification & Testing Checklist

The application includes an integrated **"Load Test Fixture (GPS EXIF)"** button that synthesizes a binary JPEG containing:
- Camera: `Canon EOS 5D`
- GPS Latitude: `37° 46' 29.8" N`
- GPS Longitude: `122° 25' 9.9" W`
- High privacy risk badge
- Offline SVG radar display

### Test Scenarios Covered:
1. **JPEG with EXIF & GPS**: Successfully extracted and displayed in semantic tables; classified as HIGH risk; stripped losslessly in Mode A.
2. **JPEG with Non-Default Orientation**: Minimal clean APP1 synthesized when "Preserve orientation display" is enabled.
3. **PNG with Text Annotations**: Scanned and stripped of `tEXt` and `eXIf` chunks.
4. **WebP Containers**: RIFF chunks parsed, `EXIF` chunks stripped, and file size updated.
5. **Batch Processing**: Multiple files processed sequentially with responsive progress updates and exported via zero-dependency ZIP archive.
6. **Redaction Tool**: Manual rectangular blur applied to sensitive image areas with live canvas preview.
7. **Resource Management**: Object URLs revoked on deletion, replacement, and gallery clearing to prevent browser memory leaks.
