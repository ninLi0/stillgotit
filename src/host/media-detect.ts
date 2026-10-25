/**
 * Reads a file's type from its bytes and, for a recording or video, its length from the container.
 * Only headers, frame headers, and timestamps are read. Nothing is decoded, rendered, or played.
 * See the detection table in design/material-data.md.
 */
import type { ImageMediaType } from "../media.ts";

export interface RecordingInfo {
  /** The media type saved for the original and sent to Gemini. */
  mediaType: string;
  video: boolean;
  /** Length in seconds. Always finite and positive. */
  seconds: number;
}

/** Container families for the accepted recording and video names. */
export type RecordingFamily = "wav" | "mp3" | "aiff" | "aac" | "ogg" | "flac" | "iso" | "webm" | "mpeg" | "avi" | "flv" | "wmv";

export const recordingFamilies: Readonly<Record<string, RecordingFamily>> = {
  ".wav": "wav", ".mp3": "mp3", ".mpga": "mp3", ".aif": "aiff", ".aiff": "aiff", ".aac": "aac",
  ".ogg": "ogg", ".oga": "ogg", ".opus": "ogg", ".flac": "flac",
  ".m4a": "iso", ".mp4": "iso", ".m4v": "iso", ".mov": "iso", ".3gp": "iso", ".3gpp": "iso",
  ".webm": "webm", ".mpeg": "mpeg", ".mpg": "mpeg", ".avi": "avi", ".flv": "flv", ".wmv": "wmv",
};

/** Thrown when the bytes hold an Ogg video, which is refused like `.ogv`. */
export class OggVideo extends Error {}
/** Thrown when a `.wmv` file holds only Windows Media audio, which is refused like `.wma`. */
export class WindowsAudio extends Error {}

const ascii = (b: Uint8Array, at: number, length: number) =>
  at < 0 || at + length > b.length ? "" : String.fromCharCode(...b.subarray(at, at + length));
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const u32le = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const u64be = (b: Uint8Array, at: number) => u32be(b, at) * 2 ** 32 + u32be(b, at + 4);
const u64le = (b: Uint8Array, at: number) => u32le(b, at + 4) * 2 ** 32 + u32le(b, at);
const fits = (b: Uint8Array, at: number, length: number) => at >= 0 && at + length <= b.length;

/** `%PDF-` near the start. Some writers put a few bytes before the header. */
export function isPdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) if (bytes[i] === 0x25 && ascii(bytes, i, 5) === "%PDF-") return true;
  return false;
}

const heicBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]), heifBrands = new Set(["mif1", "msf1"]);

/** The PNG, JPEG, WebP, HEIC, or HEIF signature, whatever the file is named. */
export function imageType(bytes: Uint8Array): ImageMediaType | null {
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp" && fits(bytes, 0, 16)) {
    const size = Math.min(u32be(bytes, 0), bytes.length), brands = [ascii(bytes, 8, 4)];
    // AVIF also lists the HEIF brands; it is refused like `.avif`.
    if (["avif", "avis"].includes(brands[0]!)) return null;
    for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(bytes, at, 4));
    if (brands.some((brand) => heicBrands.has(brand))) return "image/heic";
    if (brands.some((brand) => heifBrands.has(brand))) return "image/heif";
  }
  return null;
}

/** Returns the recording's type and length, or null when either can't be read. */
export function readRecording(family: RecordingFamily, extension: string, bytes: Uint8Array): RecordingInfo | null {
  let found: { seconds: number; video: boolean; mediaType: string } | null;
  try {
    found = family === "wav" ? wav(bytes) : family === "mp3" ? mp3(bytes) : family === "aiff" ? aiff(bytes)
      : family === "aac" ? aac(bytes) : family === "ogg" ? ogg(bytes) : family === "flac" ? flac(bytes)
      : family === "iso" ? iso(bytes, extension) : family === "webm" ? webm(bytes) : family === "mpeg" ? mpegProgram(bytes)
      : family === "avi" ? avi(bytes) : family === "flv" ? flv(bytes) : asf(bytes);
  } catch (error) {
    if (error instanceof OggVideo || error instanceof WindowsAudio) throw error;
    // Malformed headers that run past the end of the file are unreadable recordings.
    return null;
  }
  return found && Number.isFinite(found.seconds) && found.seconds > 0 ? found : null;
}

// ---------------------------------------------------------------------------------------------
// Audio streams that carry their own frame headers: MP3 and ADTS.

/** ID3v2 tags may precede MPEG audio, ADTS, and FLAC data. */
function skipId3(b: Uint8Array): number {
  let at = 0;
  while (fits(b, at, 10) && ascii(b, at, 3) === "ID3") {
    const size = ((b[at + 6]! & 0x7f) << 21) | ((b[at + 7]! & 0x7f) << 14) | ((b[at + 8]! & 0x7f) << 7) | (b[at + 9]! & 0x7f);
    at += 10 + size + (b[at + 5]! & 0x10 ? 10 : 0);
  }
  return at;
}

interface Frame { length: number; samples: number; rate: number }

const mpeg1Rates = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
];
const mpeg2Rates = [[0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]];
const mpegSampleRates: (number[] | null)[] = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]];

function mpegFrame(b: Uint8Array, at: number): (Frame & { mpeg1: boolean; mono: boolean }) | null {
  if (!fits(b, at, 4) || b[at] !== 0xff || (b[at + 1]! & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1]! >> 3) & 3, layerBits = (b[at + 1]! >> 1) & 3;
  const bitrateIndex = b[at + 2]! >> 4, rateIndex = (b[at + 2]! >> 2) & 3, padding = (b[at + 2]! >> 1) & 1;
  if (version === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3, layer = 4 - layerBits;
  const bitrate = (mpeg1 ? mpeg1Rates[layer - 1]! : mpeg2Rates[layer === 1 ? 0 : 1]!)[bitrateIndex]! * 1000;
  const rate = mpegSampleRates[version]![rateIndex]!;
  const samples = layer === 1 ? 384 : layer === 2 || mpeg1 ? 1152 : 576;
  const length = layer === 1 ? (Math.floor(12 * bitrate / rate) + padding) * 4 : Math.floor(samples / 8 * bitrate / rate) + padding;
  return { length, samples, rate, mpeg1, mono: b[at + 3]! >> 6 === 3 };
}

function adtsFrame(b: Uint8Array, at: number): Frame | null {
  if (!fits(b, at, 7) || b[at] !== 0xff || (b[at + 1]! & 0xf6) !== 0xf0) return null;
  const rate = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350][(b[at + 2]! >> 2) & 0xf];
  const length = ((b[at + 3]! & 3) << 11) | (b[at + 4]! << 3) | (b[at + 5]! >> 5);
  return rate && length >= 7 ? { length, samples: ((b[at + 6]! & 3) + 1) * 1024, rate } : null;
}

/** A frame counts as a start only when the next frame follows it or the file ends. */
function confirmed(b: Uint8Array, at: number, read: (b: Uint8Array, at: number) => Frame | null): boolean {
  const frame = read(b, at);
  if (!frame) return false;
  const next = at + frame.length;
  return next >= b.length || read(b, next) !== null;
}

/** Counts frames from the first confirmed frame. Unreadable runs are skipped by searching briefly for the next frame. */
function countFrames(b: Uint8Array, start: number, read: (b: Uint8Array, at: number) => Frame | null): number | null {
  let at = start;
  const search = (from: number, span: number) => {
    for (let i = from; i < Math.min(b.length, from + span); i++) if (confirmed(b, i, read)) return i;
    return -1;
  };
  at = search(at, 64 * 1024);
  if (at < 0) return null;
  let seconds = 0;
  while (at < b.length) {
    const frame = read(b, at);
    if (!frame) {
      // Trailing ID3v1, APE, and Lyrics tags end the audio.
      if (["TAG", "APE", "LYR"].includes(ascii(b, at, 3))) break;
      at = search(at + 1, 4096);
      if (at < 0) break;
      continue;
    }
    seconds += frame.samples / frame.rate;
    at += frame.length;
  }
  return seconds;
}

function mp3(b: Uint8Array) {
  const start = skipId3(b);
  let first = -1;
  for (let i = start; i < Math.min(b.length, start + 64 * 1024); i++) if (confirmed(b, i, mpegFrame)) { first = i; break; }
  if (first < 0) return null;
  const frame = mpegFrame(b, first)!;
  // A Xing, Info, or VBRI header in the first frame gives the frame count.
  const xing = first + 4 + (frame.mpeg1 ? (frame.mono ? 17 : 32) : (frame.mono ? 9 : 17));
  if (["Xing", "Info"].includes(ascii(b, xing, 4)) && fits(b, xing, 12) && u32be(b, xing + 4) & 1) {
    const frames = u32be(b, xing + 8);
    if (frames > 0) return { seconds: frames * frame.samples / frame.rate, video: false, mediaType: "audio/mp3" };
  }
  const vbri = first + 36;
  if (ascii(b, vbri, 4) === "VBRI" && fits(b, vbri, 18)) {
    const frames = u32be(b, vbri + 14);
    if (frames > 0) return { seconds: frames * frame.samples / frame.rate, video: false, mediaType: "audio/mp3" };
  }
  const seconds = countFrames(b, first, mpegFrame);
  return seconds === null ? null : { seconds, video: false, mediaType: "audio/mp3" };
}

function aac(b: Uint8Array) {
  const seconds = countFrames(b, skipId3(b), adtsFrame);
  return seconds === null ? null : { seconds, video: false, mediaType: "audio/aac" };
}

// ---------------------------------------------------------------------------------------------
// Chunked containers with a length in their header: WAV, AIFF, FLAC, AVI, and ASF.

function wav(b: Uint8Array) {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
  let at = 12, byteRate = 0;
  while (fits(b, at, 8)) {
    const id = ascii(b, at, 4), size = u32le(b, at + 4);
    if (id === "fmt " && fits(b, at + 8, 16)) {
      // Average bytes per second covers PCM, A-law, mu-law, and other WAV encodings.
      byteRate = u32le(b, at + 16) || u32le(b, at + 12) * u16le(b, at + 20);
    }
    if (id === "data") {
      const start = at + 8, available = b.length - start;
      // Streamed WAV files may leave the size as 0 or all ones; a cut file is shorter than declared.
      const data = size === 0 || size === 0xffffffff || size > available ? available : size;
      return byteRate ? { seconds: data / byteRate, video: false, mediaType: "audio/wav" } : null;
    }
    at += 8 + size + (size & 1);
  }
  return null;
}

/** The 80-bit extended float that AIFF uses for its sample rate. */
function extended(b: Uint8Array, at: number): number {
  const exponent = ((b[at]! & 0x7f) << 8) | b[at + 1]!, mantissa = u64be(b, at + 2);
  if (!exponent && !mantissa) return 0;
  const value = mantissa * 2 ** (exponent - 16383 - 63);
  return b[at]! & 0x80 ? -value : value;
}

function aiff(b: Uint8Array) {
  if (ascii(b, 0, 4) !== "FORM" || !["AIFF", "AIFC"].includes(ascii(b, 8, 4))) return null;
  for (let at = 12; fits(b, at, 8);) {
    const size = u32be(b, at + 4);
    if (ascii(b, at, 4) === "COMM" && fits(b, at + 8, 18)) {
      const frames = u32be(b, at + 10), rate = extended(b, at + 16);
      return rate > 0 ? { seconds: frames / rate, video: false, mediaType: "audio/aiff" } : null;
    }
    at += 8 + size + (size & 1);
  }
  return null;
}

function flac(b: Uint8Array) {
  let at = skipId3(b);
  if (ascii(b, at, 4) !== "fLaC") return null;
  for (at += 4; fits(b, at, 4);) {
    const header = b[at]!, length = (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
    if ((header & 0x7f) === 0 && length >= 34 && fits(b, at + 4, 34)) {
      const info = at + 4, rate = (b[info + 10]! << 12) | (b[info + 11]! << 4) | (b[info + 12]! >> 4);
      const samples = (b[info + 13]! & 0x0f) * 2 ** 32 + u32be(b, info + 14);
      // A stream that does not declare its sample count has no readable length.
      return rate && samples ? { seconds: samples / rate, video: false, mediaType: "audio/flac" } : null;
    }
    if (header & 0x80) break;
    at += 4 + length;
  }
  return null;
}

function avi(b: Uint8Array) {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "AVI ") return null;
  const found: { header?: { perFrame: number; frames: number }; stream?: { scale: number; rate: number; length: number } } = {};
  const walk = (start: number, end: number) => {
    for (let at = start; at + 8 <= end;) {
      const id = ascii(b, at, 4), size = u32le(b, at + 4), body = at + 8;
      if (id === "LIST" && ascii(b, body, 4) === "movi") break;
      if (id === "LIST" && ["hdrl", "strl"].includes(ascii(b, body, 4))) walk(body + 4, Math.min(body + size, end));
      else if (id === "avih" && fits(b, body, 20)) found.header = { perFrame: u32le(b, body), frames: u32le(b, body + 16) };
      else if (id === "strh" && ascii(b, body, 4) === "vids" && fits(b, body, 36) && !found.stream) {
        found.stream = { scale: u32le(b, body + 20), rate: u32le(b, body + 24), length: u32le(b, body + 32) };
      }
      at = body + size + (size & 1);
    }
  };
  walk(12, b.length);
  const { header, stream } = found;
  let seconds = header ? header.perFrame * header.frames / 1e6 : 0;
  if (!(seconds > 0) && stream?.rate) seconds = stream.length * stream.scale / stream.rate;
  return header || stream ? { seconds, video: true, mediaType: "video/avi" } : null;
}

const guid = (text: string) => {
  const hex = text.replaceAll("-", ""), bytes = Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  // The first three fields are stored little-endian.
  return Uint8Array.from([bytes[3]!, bytes[2]!, bytes[1]!, bytes[0]!, bytes[5]!, bytes[4]!, bytes[7]!, bytes[6]!, ...bytes.subarray(8)]);
};
const ASF_HEADER = guid("75B22630-668E-11CF-A6D9-00AA0062CE6C"), ASF_FILE = guid("8CABDCA1-A947-11CF-8EE4-00C00C205365");
const ASF_STREAM = guid("B7DC0791-A9B7-11CF-8EE6-00C00C205365"), ASF_VIDEO = guid("BC19EFC0-5B4D-11CF-A8FD-00805F5C442B");
const ASF_AUDIO = guid("F8699E40-5B4D-11CF-A8FD-00805F5C442B");
const guidAt = (b: Uint8Array, at: number, expected: Uint8Array) => fits(b, at, 16) && expected.every((value, i) => b[at + i] === value);

function asf(b: Uint8Array) {
  if (!guidAt(b, 0, ASF_HEADER) || !fits(b, 0, 30)) return null;
  let seconds = 0, video = false, audio = false;
  for (let at = 30, count = u32le(b, 24); count > 0 && fits(b, at, 24); count--) {
    const size = u64le(b, at + 16);
    if (guidAt(b, at, ASF_FILE) && fits(b, at + 24, 64)) seconds = u64le(b, at + 64) / 1e7 - u64le(b, at + 80) / 1000;
    if (guidAt(b, at, ASF_STREAM) && guidAt(b, at + 24, ASF_VIDEO)) video = true;
    if (guidAt(b, at, ASF_STREAM) && guidAt(b, at + 24, ASF_AUDIO)) audio = true;
    if (size < 24) break;
    at += size;
  }
  // Only a Windows Media file with a video stream is accepted; Windows Media audio is refused like `.wma`.
  if (!video && audio) throw new WindowsAudio();
  return video ? { seconds, video: true, mediaType: "video/wmv" } : null;
}

// ---------------------------------------------------------------------------------------------
// Streams whose length comes from their last timestamp: Ogg, MPEG program streams, and FLV.

function ogg(b: Uint8Array) {
  if (ascii(b, 0, 4) !== "OggS") return null;
  const streams = new Map<number, { rate: number; skip: number }>();
  let video = false;
  // Each logical stream starts with a beginning-of-stream page that names its codec.
  for (let at = 0; fits(b, at, 27) && ascii(b, at, 4) === "OggS" && b[at + 5]! & 0x02;) {
    const segments = b[at + 26]!, body = at + 27 + segments;
    if (!fits(b, at + 27, segments)) break;
    let length = 0;
    for (let i = 0; i < segments; i++) length += b[at + 27 + i]!;
    const serial = u32le(b, at + 14);
    if (b[body] === 1 && ascii(b, body + 1, 6) === "vorbis" && fits(b, body, 16)) streams.set(serial, { rate: u32le(b, body + 12), skip: 0 });
    else if (ascii(b, body, 8) === "OpusHead" && fits(b, body, 12)) streams.set(serial, { rate: 48000, skip: u16le(b, body + 10) });
    // Theora, Dirac, and VP8 streams are video.
    else if (ascii(b, body + 1, 6) === "theora" || ascii(b, body, 4) === "BBCD" || ascii(b, body, 5) === "OVP80") video = true;
    at = body + length;
  }
  if (video) throw new OggVideo();
  if (!streams.size) return null;
  // The last page of an audio stream carries the stream's final sample position.
  for (let at = b.length - 27; at >= 0; at--) {
    if (b[at] !== 0x4f || ascii(b, at, 4) !== "OggS" || b[at + 4] !== 0) continue;
    const stream = streams.get(u32le(b, at + 14));
    if (!stream || (u32le(b, at + 6) === 0xffffffff && u32le(b, at + 10) === 0xffffffff)) continue;
    return stream.rate ? { seconds: Math.max(0, u64le(b, at + 6) - stream.skip) / stream.rate, video: false, mediaType: "audio/ogg" } : null;
  }
  return null;
}

/** The system clock reference of an MPEG-1 or MPEG-2 pack header, in 90 kHz ticks. */
function packClock(b: Uint8Array, at: number): number | null {
  if (!fits(b, at, 14) || b[at] !== 0 || b[at + 1] !== 0 || b[at + 2] !== 1 || b[at + 3] !== 0xba) return null;
  const [c4, c5, c6, c7, c8] = [b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!, b[at + 8]!];
  if ((c4 & 0xc4) === 0x44) return ((c4 >> 3) & 7) * 2 ** 30 + (((c4 & 3) << 28) | (c5 << 20) | ((c6 >> 3) << 15) | ((c6 & 3) << 13) | (c7 << 5) | (c8 >> 3));
  if ((c4 & 0xf1) === 0x21) return ((c4 >> 1) & 7) * 2 ** 30 + ((c5 << 22) | ((c6 >> 1) << 15) | (c7 << 7) | (c8 >> 1));
  return null;
}

function mpegProgram(b: Uint8Array) {
  const first = packClock(b, 0);
  if (first === null) return null;
  for (let at = b.length - 14; at > 0; at--) {
    const last = b[at + 3] === 0xba ? packClock(b, at) : null;
    if (last !== null) return { seconds: (last - first) / 90000, video: true, mediaType: "video/mpeg" };
  }
  return null;
}

function flv(b: Uint8Array) {
  if (ascii(b, 0, 3) !== "FLV" || !fits(b, 0, 9)) return null;
  let last = -1;
  for (let at = u32be(b, 5) + 4; fits(b, at, 11);) {
    const type = b[at]! & 0x1f, size = (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
    if (type !== 8 && type !== 9 && type !== 18) break;
    const time = ((b[at + 4]! << 16) | (b[at + 5]! << 8) | b[at + 6]!) + b[at + 7]! * 2 ** 24;
    if (type !== 18) last = Math.max(last, time);
    at += 11 + size + 4;
  }
  return last > 0 ? { seconds: last / 1000, video: true, mediaType: "video/x-flv" } : null;
}

// ---------------------------------------------------------------------------------------------
// ISO media (MP4, M4A, MOV, 3GP): boxes with a movie header, track headers, or fragments.

interface Box { type: string; start: number; end: number }

function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  for (let at = start; at + 8 <= end;) {
    let size = u32be(b, at), header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = u64be(b, at + 8); header = 16;
    } else if (size === 0) size = end - at;
    if (size < header) return;
    yield { type: ascii(b, at + 4, 4), start: at + header, end: Math.min(at + size, end) };
    at += size;
  }
}
const child = (b: Uint8Array, box: Box, type: string) => {
  for (const item of boxes(b, box.start, box.end)) if (item.type === type) return item;
  return undefined;
};

const firstBoxes = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot", "uuid", "styp"]);

function iso(b: Uint8Array, extension: string) {
  const top = [...boxes(b, 0, b.length)];
  if (!top.length || !firstBoxes.has(top[0]!.type)) return null;
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return null;
  let movieScale = 0, movieDuration = 0, fragmentDuration = 0, trackSeconds = 0, video = false, sound = false;
  const scales = new Map<number, number>(), defaults = new Map<number, number>();
  for (const box of boxes(b, moov.start, moov.end)) {
    const version = b[box.start];
    if (box.type === "mvhd") {
      movieScale = u32be(b, box.start + (version === 1 ? 20 : 12));
      movieDuration = version === 1 ? u64be(b, box.start + 24) : u32be(b, box.start + 16);
      if (version !== 1 && movieDuration === 0xffffffff) movieDuration = 0;
    } else if (box.type === "trak") {
      const tkhd = child(b, box, "tkhd"), mdia = child(b, box, "mdia");
      const id = tkhd ? u32be(b, tkhd.start + (b[tkhd.start] === 1 ? 20 : 12)) : 0;
      const mdhd = mdia && child(b, mdia, "mdhd"), hdlr = mdia && child(b, mdia, "hdlr");
      const handler = hdlr ? ascii(b, hdlr.start + 8, 4) : "";
      if (handler === "vide") video = true;
      if (handler === "soun") sound = true;
      if (mdhd) {
        const long = b[mdhd.start] === 1, scale = u32be(b, mdhd.start + (long ? 20 : 12));
        const duration = long ? u64be(b, mdhd.start + 24) : u32be(b, mdhd.start + 16);
        scales.set(id, scale);
        if (scale && duration && duration !== 0xffffffff) trackSeconds = Math.max(trackSeconds, duration / scale);
      }
    } else if (box.type === "mvex") {
      for (const item of boxes(b, box.start, box.end)) {
        if (item.type === "mehd") fragmentDuration = b[item.start] === 1 ? u64be(b, item.start + 4) : u32be(b, item.start + 4);
        if (item.type === "trex") defaults.set(u32be(b, item.start + 4), u32be(b, item.start + 12));
      }
    }
  }
  if (!video && !sound) return null;
  let seconds = movieScale && movieDuration ? movieDuration / movieScale : movieScale && fragmentDuration ? fragmentDuration / movieScale : trackSeconds;
  // Fragmented files from browsers declare no length. Read the end of the last fragment of each track.
  if (!(seconds > 0)) seconds = fragmentsEnd(b, top, scales, defaults);
  const type = extension === ".mov" ? "video/mov" : extension === ".3gp" || extension === ".3gpp" ? "video/3gpp" : "video/mp4";
  return { seconds, video, mediaType: video ? type : "audio/mp4" };
}

function fragmentsEnd(b: Uint8Array, top: Box[], scales: Map<number, number>, defaults: Map<number, number>): number {
  const ends = new Map<number, number>();
  for (const moof of top.filter((box) => box.type === "moof")) {
    for (const traf of boxes(b, moof.start, moof.end)) {
      if (traf.type !== "traf") continue;
      const tfhd = child(b, traf, "tfhd"), tfdt = child(b, traf, "tfdt");
      if (!tfhd) continue;
      const flags = u32be(b, tfhd.start) & 0xffffff, id = u32be(b, tfhd.start + 4);
      let at = tfhd.start + 8 + (flags & 0x01 ? 8 : 0) + (flags & 0x02 ? 4 : 0);
      const fallback = flags & 0x08 ? u32be(b, at) : defaults.get(id) ?? 0;
      let time = tfdt ? (b[tfdt.start] === 1 ? u64be(b, tfdt.start + 4) : u32be(b, tfdt.start + 4)) : ends.get(id) ?? 0;
      for (const trun of boxes(b, traf.start, traf.end)) {
        if (trun.type !== "trun") continue;
        const runFlags = u32be(b, trun.start) & 0xffffff, count = u32be(b, trun.start + 4);
        at = trun.start + 8 + (runFlags & 0x01 ? 4 : 0) + (runFlags & 0x04 ? 4 : 0);
        const stride = [0x100, 0x200, 0x400, 0x800].filter((flag) => runFlags & flag).length * 4;
        // Without per-sample durations every sample has the default duration, so no loop over the count is needed.
        if (!(runFlags & 0x100)) time += count * fallback;
        else for (let i = 0; i < count && at + 4 <= trun.end; i++, at += stride) time += u32be(b, at);
      }
      ends.set(id, Math.max(ends.get(id) ?? 0, time));
    }
  }
  let seconds = 0;
  for (const [id, end] of ends) { const scale = scales.get(id); if (scale) seconds = Math.max(seconds, end / scale); }
  return seconds;
}

// ---------------------------------------------------------------------------------------------
// WebM (Matroska): EBML elements. Browser recordings leave the duration and cluster sizes unknown.

const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, INFO = 0x1549a966, TRACKS = 0x1654ae6b, CLUSTER = 0x1f43b675;
const segmentChildren = new Set([0x114d9b74, INFO, TRACKS, CLUSTER, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367, EBML, SEGMENT]);

interface Element { id: number; start: number; size: number; unknown: boolean }

function element(b: Uint8Array, at: number): Element | null {
  const id = vint(b, at, 4, true), size = id && vint(b, at + id.length, 8, false);
  if (!id || !size) return null;
  return { id: id.value, start: at + id.length + size.length, size: size.value, unknown: size.unknown };
}

function vint(b: Uint8Array, at: number, max: number, marker: boolean): { value: number; length: number; unknown: boolean } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let length = 1, mask = 0x80;
  while (!(first & mask)) { mask >>= 1; length++; }
  if (length > max || !fits(b, at, length)) return null;
  let value = marker ? first : first & (mask - 1), ones = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) { value = value * 256 + b[at + i]!; if (b[at + i] !== 0xff) ones = false; }
  return { value, length, unknown: !marker && ones };
}

const unsigned = (b: Uint8Array, e: Element) => { let value = 0; for (let i = 0; i < e.size && i < 8; i++) value = value * 256 + b[e.start + i]!; return value; };
const float = (b: Uint8Array, e: Element) => {
  const view = new DataView(b.buffer, b.byteOffset + e.start, e.size);
  return e.size === 4 ? view.getFloat32(0) : e.size === 8 ? view.getFloat64(0) : 0;
};
const children = function* (b: Uint8Array, e: Element, end: number): Generator<Element> {
  for (let at = e.start; at < Math.min(e.start + e.size, end);) {
    const item = element(b, at);
    if (!item || item.unknown) return;
    yield item;
    at = item.start + item.size;
  }
};

function webm(b: Uint8Array) {
  const header = element(b, 0);
  if (!header || header.id !== EBML || header.unknown) return null;
  const segment = element(b, header.start + header.size);
  if (!segment || segment.id !== SEGMENT) return null;
  const end = segment.unknown ? b.length : Math.min(segment.start + segment.size, b.length);
  let scale = 1_000_000, duration = 0, last = -1, video = false, sound = false;
  // A block starts with its track number and a signed 16-bit time relative to its cluster.
  const block = (at: number, cluster: number, length = 0) => {
    const track = vint(b, at, 8, false);
    if (!track || !fits(b, at + track.length, 2)) return;
    const relative = new DataView(b.buffer, b.byteOffset + at + track.length, 2).getInt16(0);
    last = Math.max(last, cluster + relative + length);
  };
  for (let at = segment.start; at < end;) {
    const item = element(b, at);
    if (!item) break;
    if (item.id === INFO) {
      for (const field of children(b, item, end)) {
        if (field.id === 0x2ad7b1) scale = unsigned(b, field) || scale;
        if (field.id === 0x4489) duration = float(b, field);
      }
    } else if (item.id === TRACKS) {
      for (const entry of children(b, item, end)) {
        if (entry.id !== 0xae) continue;
        for (const field of children(b, entry, end)) {
          if (field.id === 0x83 && unsigned(b, field) === 1) video = true;
          if (field.id === 0x83 && unsigned(b, field) === 2) sound = true;
        }
      }
    } else if (item.id === CLUSTER) {
      const clusterEnd = item.unknown ? end : Math.min(item.start + item.size, end);
      let time = 0, inner = item.start;
      while (inner < clusterEnd) {
        const part = element(b, inner);
        // A cluster of unknown size ends where the next top-level element begins.
        if (!part || (item.unknown && segmentChildren.has(part.id))) break;
        if (part.id === 0xe7) time = unsigned(b, part);
        else if (part.id === 0xa3) block(part.start, time);
        else if (part.id === 0xa0) {
          let start = -1, length = 0;
          for (const field of children(b, part, clusterEnd)) {
            if (field.id === 0xa1) start = field.start;
            if (field.id === 0x9b) length = unsigned(b, field);
          }
          if (start >= 0) block(start, time, length);
        }
        if (part.unknown) break;
        inner = part.start + part.size;
      }
      at = inner;
      continue;
    } else if (item.unknown) break;
    at = item.start + item.size;
  }
  if (!video && !sound) return null;
  const ticks = duration > 0 ? duration : last;
  return { seconds: ticks * scale / 1e9, video, mediaType: video ? "video/webm" : "audio/webm" };
}

/** Used by tests and the transcription worker: the length rounded up to whole seconds. */
export const wholeSeconds = (info: RecordingInfo) => Math.max(1, Math.ceil(info.seconds));

