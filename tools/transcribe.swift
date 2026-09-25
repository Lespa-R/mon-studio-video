// Transcribe an audio file to timed words, on this Mac only.
//
//   Transcribe.app/Contents/MacOS/transcribe <audio> <locale> <out.json>
//   transcribe --status                     → prints the authorisation status
//
// Apple's speech recogniser with requiresOnDeviceRecognition: the audio never
// leaves the machine and no account or API key is involved.
//
// It is built as a tiny app bundle (see build.sh) and launched with `open`,
// not spawned: macOS asks for speech-recognition permission per app, and a
// bundle of its own is what makes the prompt name it — "Mon Studio –
// Transcription" — rather than whatever terminal started the studio.
//
// `open` does not return the exit code, so the result, or the error, is
// always written to <out.json>:
//   { "words": [{ "w": "Bonjour,", "s": 0.52, "e": 0.91 }, …] }
//   { "error": "not-authorized" | "unavailable" | "no-on-device" | "failed", "detail": "…" }

import Foundation
import Speech

let args = CommandLine.arguments

if args.count > 1 && args[1] == "--status" {
  // 0 not asked yet · 1 denied · 2 restricted · 3 authorised
  print(SFSpeechRecognizer.authorizationStatus().rawValue)
  exit(0)
}

guard args.count >= 4 else {
  FileHandle.standardError.write("usage: transcribe <audio> <locale> <out.json>\n".data(using: .utf8)!)
  exit(64)
}

let audio = URL(fileURLWithPath: args[1])
let locale = Locale(identifier: args[2])
let outURL = URL(fileURLWithPath: args[3])

func write(_ object: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
  try? data.write(to: outURL, options: .atomic)
}

func fail(_ code: String, _ detail: String = "") -> Never {
  write(["error": code, "detail": detail])
  exit(1)
}

// Permission: asked once; macOS remembers the answer for this app.
var status = SFSpeechRecognizer.authorizationStatus()
if status == .notDetermined {
  let asked = DispatchSemaphore(value: 0)
  SFSpeechRecognizer.requestAuthorization { answer in
    status = answer
    asked.signal()
  }
  _ = asked.wait(timeout: .now() + 300)
}
guard status == .authorized else { fail("not-authorized", String(status.rawValue)) }

guard let recognizer = SFSpeechRecognizer(locale: locale) else { fail("unavailable", args[2]) }
guard recognizer.isAvailable else { fail("unavailable", args[2]) }
guard recognizer.supportsOnDeviceRecognition else { fail("no-on-device", args[2]) }
// Results arrive on this queue; the main thread is blocked waiting for them.
recognizer.queue = OperationQueue()

let request = SFSpeechURLRecognitionRequest(url: audio)
request.requiresOnDeviceRecognition = true
request.shouldReportPartialResults = false
request.taskHint = .dictation
if #available(macOS 13, *) { request.addsPunctuation = true }

let done = DispatchSemaphore(value: 0)
var final: SFSpeechRecognitionResult?
var failure: Error?

let task = recognizer.recognitionTask(with: request) { result, error in
  if let result = result, result.isFinal {
    final = result
    done.signal()
  } else if let error = error {
    failure = error
    done.signal()
  }
}

if done.wait(timeout: .now() + 900) == .timedOut {
  task.cancel()
  fail("failed", "timeout")
}

guard let result = final else {
  // No speech at all is reported as an error too; an empty list is the answer.
  let ns = failure as NSError?
  if ns?.domain == "kAFAssistantErrorDomain" && (ns?.code == 1110 || ns?.code == 1101) {
    write(["words": []])
    exit(0)
  }
  fail("failed", failure.map { "\($0)" } ?? "no result")
}

// Each segment is one word. Its text is taken from the formatted string up to
// the next segment, so the punctuation the recogniser added stays attached.
let text = result.bestTranscription.formattedString as NSString
let segments = result.bestTranscription.segments
var words: [[String: Any]] = []
for (i, seg) in segments.enumerated() {
  let from = seg.substringRange.location
  let to = i + 1 < segments.count ? segments[i + 1].substringRange.location : text.length
  let raw = text.substring(with: NSRange(location: from, length: max(0, to - from)))
  let word = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if word.isEmpty { continue }
  words.append([
    "w": word,
    "s": (seg.timestamp * 1000).rounded() / 1000,
    "e": ((seg.timestamp + seg.duration) * 1000).rounded() / 1000,
  ])
}
write(["words": words])
exit(0)
