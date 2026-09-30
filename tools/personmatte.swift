// personmatte — cuts the person out of every frame of a video using the macOS
// Vision person-segmentation model and streams straight (non-premultiplied)
// RGBA frames to stdout.
//
//   personmatte <video> [--quality accurate|balanced|fast] [--blur 1.5] [--smooth 0.0] [--window 2]
//                        [--model person|subject]
//
// --window n averages each mask with n frames before and after (default 2):
// see « temporal stabiliser » below.
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
var model = "person"    // person: Vision person segmentation; subject: foreground
                        // instances (the person AND what they hold), macOS 14+
var window = 2          // frames averaged on each side (0 = off)
var edgeLow = 0.2       // contrast curve applied to the averaged mask
var edgeHigh = 0.8

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
    case "--model":
        i += 1; model = argValue(argv, i) == "subject" ? "subject" : "person"
    case "--window":
        i += 1; window = max(0, min(6, Int(argValue(argv, i) ?? "") ?? 2))
    default:
        if path == nil { path = argv[i] }
    }
    i += 1
}
guard let videoPath = path else {
    fail("usage: personmatte <video> [--quality accurate|balanced|fast] [--blur r] [--smooth f] [--window n] [--model person|subject]")
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

// ---------- temporal stabiliser ----------
// Vision segments every frame on its own, so the edge (and sometimes whole
// patches of hair, hands or clothes) flips in and out from one frame to the
// next: text behind the person then flickers. Each mask is therefore averaged
// with its neighbours, `window` frames before AND after (triangular weights),
// which calms the flicker without the lag a one-sided average would add. A
// short contrast curve keeps the averaged edge crisp, a small closing fills
// the pin-holes, and a dropped detection holds the last mask for a moment
// instead of letting the text flash over the person.

struct Mask { let w: Int; let h: Int; var v: [Float] }

// Copies a one-channel mask (8-bit from the person model, 32-bit float from
// the subject model): Vision may reuse its buffer on the next request.
func readMask(_ pb: CVPixelBuffer) -> Mask {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    let bpr = CVPixelBufferGetBytesPerRow(pb)
    let raw = CVPixelBufferGetBaseAddress(pb)!
    let isFloat = CVPixelBufferGetPixelFormatType(pb) == kCVPixelFormatType_OneComponent32Float
    var v = [Float](repeating: 0, count: w * h)
    for y in 0..<h {
        if isFloat {
            let row = (raw + y * bpr).assumingMemoryBound(to: Float.self)
            for x in 0..<w { v[y * w + x] = min(1, max(0, row[x])) }
        } else {
            let row = (raw + y * bpr).assumingMemoryBound(to: UInt8.self)
            for x in 0..<w { v[y * w + x] = Float(row[x]) / 255 }
        }
    }
    return Mask(w: w, h: h, v: v)
}

let subjectRequest = VNGenerateForegroundInstanceMaskRequest()

// The mask of the current frame, or nil when nobody (nothing) is found.
func detect(_ pixelBuffer: CVPixelBuffer) -> Mask? {
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
    if model == "subject" {
        try? handler.perform([subjectRequest])
        guard let obs = subjectRequest.results?.first, !obs.allInstances.isEmpty,
              let pb = try? obs.generateMask(forInstances: obs.allInstances) else { return nil }
        return readMask(pb)
    }
    try? handler.perform([request])
    guard let obs = request.results?.first else { return nil }
    return readMask(obs.pixelBuffer)
}

struct Entry { let sample: CMSampleBuffer; let mask: Mask? }
var entries: [Entry] = []
var centre = 0
var lastMask: Mask?
var heldFor = 0
let holdFrames = 8
let closeRadius = max(2.0, Double(outH) * 0.006)

func stabilised(at c: Int) -> Mask? {
    guard let own = entries[c].mask else { return nil }
    var acc = [Float](repeating: 0, count: own.v.count)
    var total: Float = 0
    for i in max(0, c - window)...min(entries.count - 1, c + window) {
        guard let m = entries[i].mask, m.w == own.w, m.h == own.h else { continue }
        let wgt = Float(window + 1 - abs(i - c))
        m.v.withUnsafeBufferPointer { src in
            for k in 0..<acc.count { acc[k] += src[k] * wgt }
        }
        total += wgt
    }
    let lo = Float(edgeLow), span = Float(edgeHigh - edgeLow)
    for k in 0..<acc.count {
        let t = min(1, max(0, (acc[k] / total - lo) / span))
        acc[k] = t * t * (3 - 2 * t)
    }
    return Mask(w: own.w, h: own.h, v: acc)
}

func ciMask(_ m: Mask) -> CIImage {
    var bytes = [UInt8](repeating: 0, count: m.v.count)
    for k in 0..<bytes.count { bytes[k] = UInt8(min(255, max(0, m.v[k] * 255 + 0.5))) }
    var img = CIImage(bitmapData: Data(bytes), bytesPerRow: m.w,
                      size: CGSize(width: m.w, height: m.h), format: .L8, colorSpace: nil)
    img = img.transformed(by: CGAffineTransform(
        scaleX: extent.width / CGFloat(m.w), y: extent.height / CGFloat(m.h)))
    // Closing (dilate then erode): fills pin-holes inside the person.
    let dilate = CIFilter.morphologyMaximum()
    dilate.inputImage = img.clampedToExtent()
    dilate.radius = Float(closeRadius)
    let erode = CIFilter.morphologyMinimum()
    erode.inputImage = dilate.outputImage
    erode.radius = Float(closeRadius)
    img = (erode.outputImage ?? img).cropped(to: extent)
    if blurRadius > 0 {
        let b = CIFilter.gaussianBlur()
        b.inputImage = img.clampedToExtent()
        b.radius = Float(blurRadius)
        img = (b.outputImage ?? img).cropped(to: extent)
    }
    return img
}

func emit(_ c: Int) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(entries[c].sample) else { return }
    let frame = CIImage(cvPixelBuffer: pixelBuffer).cropped(to: extent)

    var mask: CIImage
    if let m = stabilised(at: c) {
        mask = ciMask(m)
        // Optional extra easing towards the previous frame (--smooth).
        if smooth > 0, let prev = previousMask,
           let mix = CIFilter(name: "CIMix", parameters: [
               kCIInputImageKey: mask,
               kCIInputBackgroundImageKey: prev,
               "inputAmount": 1.0 - smooth,
           ])?.outputImage {
            mask = mix.cropped(to: extent)
        }
    } else {
        // No person for too long — a fully transparent frame, so the background
        // shows through rather than punching a hard hole in the overlay.
        mask = CIImage(color: .black).cropped(to: extent)
    }
    previousMask = mask

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

func advance() {
    emit(centre)
    centre += 1
    // Keep `window` frames of history behind the next frame to emit.
    if centre > window { entries.removeFirst(); centre -= 1 }
}

while let sample = output.copyNextSampleBuffer() {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { continue }
    var mask = detect(pixelBuffer)
    if mask != nil {
        lastMask = mask
        heldFor = 0
    } else {
        missingPerson += 1
        heldFor += 1
        if heldFor <= holdFrames { mask = lastMask }
    }
    entries.append(Entry(sample: sample, mask: mask))
    while entries.count - 1 - centre >= window { advance() }
}
while centre < entries.count { advance() }

FileHandle.standardError.write(
    "personmatte: \(frameCount) frames \(outW)x\(outH), \(missingPerson) without a person\n"
        .data(using: .utf8)!)
