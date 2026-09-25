// personmatte — cuts the person out of every frame of a video using the macOS
// Vision person-segmentation model and streams straight (non-premultiplied)
// RGBA frames to stdout.
//
//   personmatte <video> [--quality accurate|balanced|fast] [--blur 1.5] [--smooth 0.0]
//
// Frames are emitted in decode order, one after another, so the caller can pipe
// them into ffmpeg:
//
//   personmatte in.mp4 | ffmpeg -f rawvideo -pix_fmt rgba -s 1280x720 -r 30 -i - ... out.webm
//
// The input is expected to be upright already (the CLI normalises rotation with
// ffmpeg first), so no preferredTransform handling happens here.

import Foundation
import AVFoundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(("personmatte: " + msg + "\n").data(using: .utf8)!)
    exit(1)
}

func argValue(_ argv: [String], _ idx: Int) -> String? {
    idx < argv.count ? argv[idx] : nil
}

// ---------- args ----------
var path: String?
var quality: VNGeneratePersonSegmentationRequest.QualityLevel = .accurate
var blurRadius: Double = 1.5
var smooth: Double = 0.0

let argv = CommandLine.arguments
var i = 1
while i < argv.count {
    switch argv[i] {
    case "--quality":
        i += 1
        switch argValue(argv, i) ?? "" {
        case "fast": quality = .fast
        case "balanced": quality = .balanced
        default: quality = .accurate
        }
    case "--blur":
        i += 1; blurRadius = Double(argValue(argv, i) ?? "") ?? 1.5
    case "--smooth":
        i += 1; smooth = Double(argValue(argv, i) ?? "") ?? 0
    default:
        if path == nil { path = argv[i] }
    }
    i += 1
}
guard let videoPath = path else {
    fail("usage: personmatte <video> [--quality accurate|balanced|fast] [--blur r] [--smooth f]")
}

// ---------- asset ----------
let asset = AVURLAsset(url: URL(fileURLWithPath: videoPath))
var track: AVAssetTrack?
var natural = CGSize.zero
let sem = DispatchSemaphore(value: 0)
Task {
    track = try? await asset.loadTracks(withMediaType: .video).first
    if let t = track { natural = (try? await t.load(.naturalSize)) ?? .zero }
    sem.signal()
}
sem.wait()

guard let vtrack = track else { fail("no video track in \(videoPath)") }
let outW = Int(natural.width.rounded())
let outH = Int(natural.height.rounded())
guard outW > 0, outH > 0 else { fail("could not determine frame size") }

guard let reader = try? AVAssetReader(asset: asset) else { fail("cannot open reader") }
let output = AVAssetReaderTrackOutput(
    track: vtrack,
    outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
)
output.alwaysCopiesSampleData = false
reader.add(output)
guard reader.startReading() else {
    fail("reader failed: \(reader.error?.localizedDescription ?? "unknown error")")
}

// ---------- pipeline ----------
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let ciContext = CIContext(options: [
    .workingColorSpace: srgb,
    .outputColorSpace: srgb,
    .cacheIntermediates: false,
])

let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = quality
request.outputPixelFormat = kCVPixelFormatType_OneComponent8

let extent = CGRect(x: 0, y: 0, width: CGFloat(outW), height: CGFloat(outH))
let transparent = CIImage(color: .clear).cropped(to: extent)
let rowBytes = outW * 4
var bitmap = [UInt8](repeating: 0, count: rowBytes * outH)
var previousMask: CIImage?
let out = FileHandle.standardOutput
var frameCount = 0
var missingPerson = 0

while let sample = output.copyNextSampleBuffer() {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { continue }
    let frame = CIImage(cvPixelBuffer: pixelBuffer).cropped(to: extent)

    try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:]).perform([request])

    var mask: CIImage
    if let obs = request.results?.first {
        var m = CIImage(cvPixelBuffer: obs.pixelBuffer)
        m = m.transformed(by: CGAffineTransform(
            scaleX: extent.width / m.extent.width,
            y: extent.height / m.extent.height))

        if blurRadius > 0 {
            let b = CIFilter.gaussianBlur()
            b.inputImage = m.clampedToExtent()
            b.radius = Float(blurRadius)
            m = (b.outputImage ?? m).cropped(to: extent)
        }

        // Optional temporal easing: ease each mask towards the previous one to
        // calm the edge flicker frame-by-frame segmentation produces.
        if smooth > 0, let prev = previousMask,
           let mix = CIFilter(name: "CIMix", parameters: [
               kCIInputImageKey: m,
               kCIInputBackgroundImageKey: prev,
               "inputAmount": 1.0 - smooth,
           ])?.outputImage {
            m = mix.cropped(to: extent)
        }

        previousMask = m
        mask = m
    } else {
        // No person detected — emit a fully transparent frame so the background
        // shows through rather than punching a hard hole in the overlay.
        missingPerson += 1
        mask = CIImage(color: .black).cropped(to: extent)
        previousMask = mask
    }

    let blend = CIFilter.blendWithMask()
    blend.inputImage = frame
    blend.backgroundImage = transparent
    blend.maskImage = mask
    // CoreImage renders premultiplied; ffmpeg's rgba expects straight alpha.
    let composed = (blend.outputImage ?? frame).unpremultiplyingAlpha().cropped(to: extent)

    bitmap.withUnsafeMutableBytes { raw in
        ciContext.render(composed,
                         toBitmap: raw.baseAddress!,
                         rowBytes: rowBytes,
                         bounds: extent,
                         format: .RGBA8,
                         colorSpace: srgb)
    }
    out.write(Data(bitmap))
    frameCount += 1
}

FileHandle.standardError.write(
    "personmatte: \(frameCount) frames \(outW)x\(outH), \(missingPerson) without a person\n"
        .data(using: .utf8)!)
