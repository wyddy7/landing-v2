#!/usr/bin/env swift

import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

enum EncodeError: LocalizedError {
    case usage
    case message(String)

    var errorDescription: String? {
        switch self {
        case .usage:
            return "Usage: encode-glass-hevc.swift <input-png-directory> <output.mov>"
        case .message(let text):
            return text
        }
    }
}

func loadImage(at url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw EncodeError.message("Could not decode PNG: \(url.path)")
    }
    return image
}

func pngFrames(in directory: URL) throws -> [URL] {
    let files = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    )
    return files.filter { url in
        let name = url.lastPathComponent
        return name.count == 8 && name.hasSuffix(".png") && name.prefix(4).allSatisfy { $0.isNumber }
    }.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
}

func makePixelBuffer(
    image: CGImage,
    width: Int,
    height: Int,
    pool: CVPixelBufferPool
) throws -> CVPixelBuffer {
    var optionalBuffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer) == kCVReturnSuccess,
          let buffer = optionalBuffer else {
        throw EncodeError.message("Could not allocate video pixel buffer")
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else {
        throw EncodeError.message("Could not create bitmap context")
    }
    context.clear(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buffer
}

func verifyAlpha(url: URL) throws {
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
        throw EncodeError.message("Encoded file has no video track")
    }
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
        throw EncodeError.message("Could not add alpha verification reader output")
    }
    reader.add(output)
    guard reader.startReading() else {
        throw EncodeError.message("Could not decode output: \(reader.error?.localizedDescription ?? "unknown error")")
    }

    var frameCount = 0
    var maxCornerAlpha: UInt8 = 0
    var maxAlpha: UInt8 = 0
    while let sample = output.copyNextSampleBuffer() {
        defer { CMSampleBufferInvalidate(sample) }
        guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) else { continue }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
        for (x, y) in corners {
            maxCornerAlpha = max(maxCornerAlpha, base[y * bytesPerRow + x * 4 + 3])
        }
        for y in 0..<height {
            for x in 0..<width {
                maxAlpha = max(maxAlpha, base[y * bytesPerRow + x * 4 + 3])
            }
        }
        frameCount += 1
    }
    guard reader.status == .completed else {
        throw EncodeError.message("Alpha verification decode failed: \(reader.error?.localizedDescription ?? "unknown error")")
    }
    guard maxCornerAlpha <= 8, maxAlpha >= 240 else {
        throw EncodeError.message("Decoded alpha check failed (corner max \(maxCornerAlpha), object max \(maxAlpha))")
    }

    let durationSeconds = CMTimeGetSeconds(asset.duration)
    let byteCount = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
    print(String(format: "Verified HEVC alpha: %d decoded frames; corner alpha max %d (transparent); object alpha max %d (opaque); duration %.3fs; size %.2f MiB", frameCount, maxCornerAlpha, maxAlpha, durationSeconds, (byteCount?.doubleValue ?? 0) / 1_048_576))
}

func run() throws {
    guard CommandLine.arguments.count == 3 else { throw EncodeError.usage }
    let inputDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
    let frames = try pngFrames(in: inputDirectory)
    guard !frames.isEmpty else { throw EncodeError.message("No 0000.png-style frames in \(inputDirectory.path)") }

    let firstImage = try loadImage(at: frames[0])
    let width = firstImage.width
    let height = firstImage.height
    guard width > 0 && height > 0 else { throw EncodeError.message("First frame has invalid dimensions") }
    for frame in frames {
        let image = try loadImage(at: frame)
        guard image.width == width && image.height == height else {
            throw EncodeError.message("Frame dimensions differ: \(frame.lastPathComponent)")
        }
    }

    try? FileManager.default.removeItem(at: outputURL)
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
    writer.metadata = []
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.hevcWithAlpha,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000]
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let pixelBufferAttributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:]
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: pixelBufferAttributes)
    guard writer.canAdd(input) else { throw EncodeError.message("Could not add video writer input") }
    writer.add(input)
    guard writer.startWriting() else {
        throw EncodeError.message("Could not start writer: \(writer.error?.localizedDescription ?? "unknown error")")
    }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else { throw EncodeError.message("Writer did not create a pixel buffer pool") }

    for (index, frameURL) in frames.enumerated() {
        while !input.isReadyForMoreMediaData {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.002))
        }
        let image = try loadImage(at: frameURL)
        let buffer = try makePixelBuffer(image: image, width: width, height: height, pool: pool)
        let timestamp = CMTime(value: CMTimeValue(index), timescale: 60)
        guard adaptor.append(buffer, withPresentationTime: timestamp) else {
            throw EncodeError.message("Could not append \(frameURL.lastPathComponent): \(writer.error?.localizedDescription ?? "unknown error")")
        }
    }

    input.markAsFinished()
    let completed = DispatchSemaphore(value: 0)
    writer.finishWriting { completed.signal() }
    completed.wait()
    guard writer.status == .completed else {
        throw EncodeError.message("Encoding failed: \(writer.error?.localizedDescription ?? "unknown error")")
    }
    print("Encoded \(frames.count) frames at 60 fps (\(width)x\(height)) to \(outputURL.path)")
    try verifyAlpha(url: outputURL)
}

do {
    try run()
} catch {
    fputs("error: \(error.localizedDescription)\\n", stderr)
    exit(1)
}
