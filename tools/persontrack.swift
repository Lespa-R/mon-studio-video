// persontrack — where the people are, frame after frame.
//
//   persontrack <video> [fps]
//
// Decodes the clip once, samples it `fps` times a second (default 8), and for
// each sample runs Vision's human-rectangle detector (whole bodies, several
// people) and face detector. Prints one JSON object:
//
//   { "width": 1280, "height": 720, "duration": 3.06,
//     "samples": [ { "t": 0.0, "p": [[x, y, w, h, conf], …], "f": [[x, y, w, h], …] }, … ] }
//
// Boxes are in pixels with a top-left origin. Progress goes to stderr as
// "progress 0.42". Linking detections into tracks is done in Node
// (lib/tracking.mjs), where it can be tested.

import Foundation
import AVFoundation
import Vision

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write(("persontrack: " + msg + "\n").data(using: .utf8)!)
  exit(1)
}

let argv = CommandLine.arguments
guard argv.count >= 2 else { fail("usage: persontrack <video> [fps]") }
let fps = argv.count > 2 ? max(1, min(30, Double(argv[2]) ?? 8)) : 8

let asset = AVURLAsset(url: URL(fileURLWithPath: argv[1]))
var track: AVAssetTrack?
var duration = 0.0
var size = CGSize.zero
let loaded = DispatchSemaphore(value: 0)
Task {
  duration = (try? await CMTimeGetSeconds(asset.load(.duration))) ?? 0
  track = try? await asset.loadTracks(withMediaType: .video).first
  if let t = track { size = (try? await t.load(.naturalSize)) ?? .zero }
  loaded.signal()
}
loaded.wait()
guard let videoTrack = track else { fail("no video track") }

let reader: AVAssetReader
do { reader = try AVAssetReader(asset: asset) } catch { fail("cannot read: \(error)") }
let output = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
])
output.alwaysCopiesSampleData = false
reader.add(output)
guard reader.startReading() else { fail("cannot start reading") }

let W = Double(size.width)
let H = Double(size.height)
// Vision boxes are normalised with a bottom-left origin.
func box(_ r: CGRect) -> [Double] {
  [(r.minX * W).rounded(), ((1 - r.maxY) * H).rounded(), (r.width * W).rounded(), (r.height * H).rounded()]
}

var rows: [String] = []
var next = 0.0
let step = 1.0 / fps
var lastReport = -1.0

while let buffer = output.copyNextSampleBuffer() {
  let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer))
  guard t + 0.0005 >= next, let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
  next += step
  while next <= t { next += step }

  // Two passes: upper bodies (seated, framed at the waist, seen from behind)
  // and whole bodies (standing, far away). Overlapping boxes are merged below.
  let upper = VNDetectHumanRectanglesRequest()
  upper.upperBodyOnly = true
  let whole = VNDetectHumanRectanglesRequest()
  whole.upperBodyOnly = false
  let faces = VNDetectFaceRectanglesRequest()
  let handler = VNImageRequestHandler(cvPixelBuffer: pixels, options: [:])
  try? handler.perform([upper, whole, faces])

  // A whole body wins over the upper body it contains: it reaches the feet.
  var found: [VNHumanObservation] = whole.results ?? []
  for u in upper.results ?? [] {
    let covered = found.contains { f in
      let i = f.boundingBox.intersection(u.boundingBox)
      return !i.isNull && i.width * i.height > 0.6 * u.boundingBox.width * u.boundingBox.height
    }
    if !covered { found.append(u) }
  }

  let people = found.map { obs -> String in
    let b = box(obs.boundingBox)
    return "[\(Int(b[0])),\(Int(b[1])),\(Int(b[2])),\(Int(b[3])),\(String(format: "%.2f", obs.confidence))]"
  }
  let heads = (faces.results ?? []).map { obs -> String in
    let b = box(obs.boundingBox)
    return "[\(Int(b[0])),\(Int(b[1])),\(Int(b[2])),\(Int(b[3]))]"
  }
  rows.append("{\"t\":\(String(format: "%.3f", t)),\"p\":[\(people.joined(separator: ","))],\"f\":[\(heads.joined(separator: ","))]}")

  if duration > 0 && t - lastReport > 0.5 {
    lastReport = t
    FileHandle.standardError.write("progress \(String(format: "%.3f", min(1, t / duration)))\n".data(using: .utf8)!)
  }
}
if reader.status == .failed { fail("decode failed: \(reader.error.map { "\($0)" } ?? "?")") }

print("{\"width\":\(Int(W)),\"height\":\(Int(H)),\"duration\":\(String(format: "%.3f", duration)),\"samples\":[\n" + rows.joined(separator: ",\n") + "\n]}")
