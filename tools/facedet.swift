import Foundation
import AVFoundation
import Vision
import CoreImage

// usage: facedet <video> <samples>
let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: facedet <video> [samples]"); exit(1) }
let url = URL(fileURLWithPath: args[1])
let samples = args.count > 2 ? Int(args[2]) ?? 15 : 15

let asset = AVURLAsset(url: url)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

let sem = DispatchSemaphore(value: 0)
var durSec: Double = 0
var W: Double = 0, H: Double = 0
Task {
    durSec = try await CMTimeGetSeconds(asset.load(.duration))
    if let t = try await asset.loadTracks(withMediaType: .video).first {
        let sz = try await t.load(.naturalSize)
        W = sz.width; H = sz.height
    }
    sem.signal()
}
sem.wait()

var rows: [String] = []
for i in 0..<samples {
    let t = durSec * Double(i) / Double(max(samples - 1, 1))
    let time = CMTime(seconds: min(t, durSec - 0.001), preferredTimescale: 600)
    guard let cg = try? gen.copyCGImage(at: time, actualTime: nil) else { continue }

    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    let req = VNDetectFaceLandmarksRequest()
    try? handler.perform([req])
    guard let obs = (req.results)?.first else {
        rows.append("{\"t\":\(String(format: "%.3f", t)),\"face\":null}")
        continue
    }
    // Vision bbox: normalized, origin bottom-left
    let b = obs.boundingBox
    let x = b.minX * W
    let w = b.width * W
    let yTop = (1.0 - b.maxY) * H
    let h = b.height * H
    let yBottom = yTop + h

    // lowest landmark point (chin) if available
    var chinY = yBottom
    if let lm = obs.landmarks?.faceContour {
        var maxY = 0.0
        for p in lm.normalizedPoints {
            // landmark points are normalized within the face bounding box
            let py = (1.0 - (b.minY + Double(p.y) * b.height)) * H
            if py > maxY { maxY = py }
        }
        if maxY > 0 { chinY = maxY }
    }
    rows.append("{\"t\":\(String(format: "%.3f", t)),\"x\":\(Int(x)),\"y\":\(Int(yTop)),\"w\":\(Int(w)),\"h\":\(Int(h)),\"cx\":\(Int(x + w/2)),\"bottom\":\(Int(yBottom)),\"chin\":\(Int(chinY))}")
}
print("{\"width\":\(Int(W)),\"height\":\(Int(H)),\"duration\":\(String(format: "%.3f", durSec)),\"frames\":[" + rows.joined(separator: ",\n") + "]}")
