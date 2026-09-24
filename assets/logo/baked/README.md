# Baked glass entrance assets

📄 These transparent RGBA image sequences were rendered from the accepted `entrance.js` and `optical-shader.js` sources at base `1eaba9e`. Each theme contains 157 frames at 720 × 720 pixels and 60 fps (2.617 seconds).

- `glass-dark.webm` and `glass-dark.mov` contain the dark-theme glass material; `glass-light.webm` and `glass-light.mov` contain the light-theme material.
- `glass-dark.png` and `glass-light.png` are lossless PNGs of the final frame, for the settled state and non-video fallback.
- The WebM files use `libvpx-vp9` with alpha and CRF 30. The MOV files use macOS AVFoundation HEVC with alpha. 📄

The footage is the glass mark only, with a transparent background; it is not a screenshot or recording of the page. Its placement, scale, opacity, and timing follow the same DOM entrance score as the live scene. The renderer's authored motion is already in the frames: consumers must not add an arbitrary rotation. 📄

Fetch only the selected theme and one compatible video codec. Keep the matching PNG available for the final settled state or a video fallback. These files make no claim of Safari or physical-phone runtime testing. 📄

## Re-encoding

On macOS, encode a directory of consecutively numbered `0000.png` frames with AVFoundation:

```sh
cd landing
swift scripts/encode-glass-hevc.swift /path/to/frames /path/to/output.mov
```

The encoder streams BGRA pixel buffers, writes `AVVideoCodecType.hevcWithAlpha`, clears container metadata, and decodes the result to verify transparent corners and opaque mark pixels. It replaces an existing output file at the supplied path.

To create the VP9-alpha counterpart with FFmpeg:

```sh
ffmpeg -framerate 60 -i /path/to/frames/%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 /path/to/output.webm
```
