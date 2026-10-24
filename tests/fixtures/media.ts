/**
 * Small media files generated in code, following each format's published layout. They carry silence or blank
 * pixels; only their headers, frame headers, and timestamps matter to the importer.
 */
import { strToU8 } from "fflate";

const concat = (...parts: (Uint8Array | number[] | string)[]): Uint8Array<ArrayBuffer> => {
  const arrays = parts.map((part) => typeof part === "string" ? strToU8(part) : part instanceof Uint8Array ? part : Uint8Array.from(part));
  const result = new Uint8Array(arrays.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of arrays) { result.set(part, at); at += part.length; }
  return result;
};
const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64le = (n: number) => [...u32le(n % 2 ** 32), ...u32le(Math.floor(n / 2 ** 32))];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u24be = (n: number) => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u64be = (n: number) => [...u32be(Math.floor(n / 2 ** 32)), ...u32be(n % 2 ** 32)];

// ---------------------------------------------------------------------------------------------
// PDF

/**
 * A PDF whose pages are either text or a scanned image with no text (`null`). `padding` adds an uncompressed
 * stream of that many bytes, used to make a large but valid PDF.
 */
export function scannedPdf(pages: (string | null)[], { padding = 0 }: { padding?: number } = {}): Uint8Array<ArrayBuffer> {
  const objects: (string | Uint8Array)[] = ["<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    // A 2×2 grey image, as a scanner would place on a page without text.
    concat("<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n", [0x20, 0xe0, 0xe0, 0x20], "\nendstream")];
  for (const [i, text] of pages.entries()) {
    const stream = text === null ? "q 612 0 0 792 0 0 cm /Im1 Do Q" : `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  if (padding > 0) {
    const filler = new Uint8Array(padding);
    for (let i = 0; i < padding; i++) filler[i] = i % 64 === 63 ? 0x0a : 0x30 + (i % 10);
    objects.push(concat(`<< /Length ${padding} >>\nstream\n`, filler, "\nendstream"));
  }
  const parts: Uint8Array[] = [strToU8("%PDF-1.4\n")];
  let length = parts[0]!.length;
  const offsets = objects.map((object, i) => {
    const offset = length, bytes = concat(`${i + 1} 0 obj\n`, object, "\nendobj\n");
    parts.push(bytes); length += bytes.length;
    return offset;
  });
  parts.push(strToU8(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return concat(...parts);
}

// ---------------------------------------------------------------------------------------------
// Images

/** The start of an ISO media image: an `ftyp` box with a major brand and compatible brands, then an empty `meta` box. */
export function heif(major = "heic", compatible = ["mif1", "heic"]): Uint8Array<ArrayBuffer> {
  const ftyp = concat(u32be(16 + compatible.length * 4), "ftyp", major, u32be(0), ...compatible);
  return concat(ftyp, u32be(12), "meta", u32be(0));
}
export const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

// ---------------------------------------------------------------------------------------------
// Audio

/** A WAV file of silence. Format 1 is PCM, 6 is A-law, and 7 is mu-law. */
export function wav(seconds: number, { rate = 8000, bits = 16, channels = 1, format = 1 }: { rate?: number; bits?: number; channels?: number; format?: number } = {}): Uint8Array<ArrayBuffer> {
  const blockAlign = channels * bits / 8, data = new Uint8Array(Math.round(seconds * rate) * blockAlign);
  if (format !== 1) data.fill(format === 6 ? 0xd5 : 0xff);
  const fmt = concat("fmt ", u32le(16), u16le(format), u16le(channels), u32le(rate), u32le(rate * blockAlign), u16le(blockAlign), u16le(bits));
  return concat("RIFF", u32le(4 + fmt.length + 8 + data.length), "WAVE", fmt, "data", u32le(data.length), data);
}

/** MPEG-1 Layer III frames at 128 kbit/s and 44.1 kHz: 417 bytes and 1,152 samples each. `xing` adds a frame-count header. */
export function mp3(seconds: number, { id3 = true, xing }: { id3?: boolean; xing?: number } = {}): Uint8Array<ArrayBuffer> {
  const frames = Math.ceil(seconds * 44100 / 1152);
  const frame = (info?: number) => {
    const bytes = new Uint8Array(417);
    bytes.set([0xff, 0xfb, 0x90, 0x64]);
    // Joint stereo MPEG-1 has 32 bytes of side information before the Xing header.
    if (info !== undefined) bytes.set(concat("Xing", u32be(1), u32be(info)), 4 + 32);
    return bytes;
  };
  const tag = id3 ? concat("ID3", [4, 0, 0, 0, 0, 0, 10], new Uint8Array(10)) : new Uint8Array();
  const body = Array.from({ length: frames }, () => frame());
  return concat(tag, ...(xing === undefined ? [] : [frame(xing)]), ...body);
}

/** AAC in ADTS frames at 44.1 kHz, 1,024 samples each. */
export function adts(seconds: number): Uint8Array<ArrayBuffer> {
  const frames = Math.ceil(seconds * 44100 / 1024), length = 7 + 10;
  const header = [0xff, 0xf1, 0x50, 0x80 | ((length >> 11) & 3), (length >> 3) & 0xff, ((length & 7) << 5) | 0x1f, 0xfc];
  return concat(...Array.from({ length: frames }, () => concat(header, new Uint8Array(10))));
}

/** An AIFF file of silence. The sample rate is an 80-bit extended float. */
export function aiff(seconds: number, rate = 8000): Uint8Array<ArrayBuffer> {
  const frames = Math.round(seconds * rate), exponent = Math.floor(Math.log2(rate));
  const mantissa = rate * 2 ** (63 - exponent);
  const extended = [...u16be(16383 + exponent), ...u32be(Math.floor(mantissa / 2 ** 32)), ...u32be(mantissa % 2 ** 32)];
  const comm = concat("COMM", u32be(18), u16be(1), u32be(frames), u16be(16), extended);
  const ssnd = concat("SSND", u32be(8 + frames * 2), u32be(0), u32be(0), new Uint8Array(frames * 2));
  return concat("FORM", u32be(4 + comm.length + ssnd.length), "AIFF", comm, ssnd);
}

/** A FLAC stream header. `samples` 0 means the encoder did not record the length. */
export function flac(seconds: number, { rate = 44100, samples = Math.round(seconds * rate) }: { rate?: number; samples?: number } = {}): Uint8Array<ArrayBuffer> {
  const info = new Uint8Array(34);
  info.set([...u16be(4096), ...u16be(4096), 0, 0, 0, 0, 0, 0]);
  // 20 bits of sample rate, 3 bits of channels − 1, 5 bits of bits per sample − 1, and 36 bits of total samples.
  info[10] = (rate >> 12) & 0xff; info[11] = (rate >> 4) & 0xff;
  info[12] = ((rate & 0xf) << 4) | (0 << 1) | (15 >> 4);
  info[13] = ((15 & 0xf) << 4) | Math.floor(samples / 2 ** 32);
  info.set(u32be(samples % 2 ** 32), 14);
  return concat("fLaC", [0x80, ...u24be(34)], info, new Uint8Array(16));
}

/** Ogg CRC-32: polynomial 0x04C11DB7, not reflected, initial value 0. */
const oggTable = Array.from({ length: 256 }, (_, i) => {
  let r = i << 24;
  for (let bit = 0; bit < 8; bit++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  return r >>> 0;
});
function oggPage(type: number, granule: number, serial: number, sequence: number, packet: Uint8Array): Uint8Array<ArrayBuffer> {
  const lacing: number[] = [];
  let left = packet.length;
  while (left >= 255) { lacing.push(255); left -= 255; }
  lacing.push(left);
  const page = concat("OggS", [0, type], u64le(granule), u32le(serial), u32le(sequence), u32le(0), [lacing.length], lacing, packet);
  let crc = 0;
  for (const byte of page) crc = ((crc << 8) ^ oggTable[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  page.set(u32le(crc), 22);
  return page;
}

/** An Ogg file with one Opus, Vorbis, or Theora stream, ending with a page whose granule gives its length. */
export function ogg(seconds: number, codec: "opus" | "vorbis" | "theora" = "opus"): Uint8Array<ArrayBuffer> {
  const serial = 0x1234;
  if (codec === "theora") {
    const head = concat([0x80], "theora", [3, 2, 1], new Uint8Array(35));
    return concat(oggPage(2, 0, serial, 0, head), oggPage(4, 30, serial, 1, new Uint8Array(4)));
  }
  if (codec === "vorbis") {
    const rate = 44100, head = concat([1], "vorbis", u32le(0), [1], u32le(rate), u32le(0), u32le(64000), u32le(0), [0xb8, 1]);
    const comments = concat([3], "vorbis", u32le(0), u32le(0), [1]);
    return concat(oggPage(2, 0, serial, 0, head), oggPage(0, 0, serial, 1, comments), oggPage(4, Math.round(seconds * rate), serial, 2, new Uint8Array(20)));
  }
  const preSkip = 312, head = concat("OpusHead", [1, 1], u16le(preSkip), u32le(48000), u16le(0), [0]);
  const tags = concat("OpusTags", u32le(4), "test", u32le(0));
  return concat(oggPage(2, 0, serial, 0, head), oggPage(0, 0, serial, 1, tags),
    oggPage(0, preSkip + 48000 * Math.floor(seconds / 2), serial, 2, new Uint8Array(30)),
    oggPage(4, preSkip + Math.round(seconds * 48000), serial, 3, new Uint8Array(30)));
}

// ---------------------------------------------------------------------------------------------
// ISO media: MP4, M4A, MOV, 3GP

const box = (type: string, ...body: (Uint8Array | number[] | string)[]) => {
  const content = concat(...body);
  return concat(u32be(8 + content.length), type, content);
};
const full = (type: string, version: number, ...body: (Uint8Array | number[] | string)[]) => box(type, [version, 0, 0, 0], ...body);

function track(id: number, handler: "vide" | "soun", scale: number, duration: number, movieDuration: number) {
  const matrix = [...u32be(0x10000), ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0x10000), ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0x40000000)];
  const tkhd = full("tkhd", 0, u32be(0), u32be(0), u32be(id), u32be(0), u32be(movieDuration), new Uint8Array(8), u16be(0), u16be(0),
    u16be(handler === "soun" ? 0x100 : 0), u16be(0), matrix, u32be(handler === "vide" ? 320 << 16 : 0), u32be(handler === "vide" ? 240 << 16 : 0));
  const mdhd = full("mdhd", 0, u32be(0), u32be(0), u32be(scale), u32be(duration), u16be(0x55c4), u16be(0));
  const hdlr = full("hdlr", 0, u32be(0), handler, new Uint8Array(12), handler === "vide" ? "VideoHandler\0" : "SoundHandler\0");
  return box("trak", tkhd, box("mdia", mdhd, hdlr));
}

/**
 * A minimal ISO media file: `ftyp`, then `moov` with a movie header and one audio track and, for a video, one
 * video track, then an empty `mdat`. A fragmented file declares no length; its fragments carry the timestamps.
 */
export function mp4({ seconds, video = true, brand = "isom", fragmented = false, quicktime = false }: {
  seconds: number; video?: boolean; brand?: string; fragmented?: boolean; quicktime?: boolean;
}): Uint8Array<ArrayBuffer> {
  const scale = 1000, duration = fragmented ? 0 : Math.round(seconds * scale);
  const mvhd = full("mvhd", 0, u32be(0), u32be(0), u32be(scale), u32be(duration), u32be(0x10000), u16be(0x100), new Uint8Array(10),
    u32be(0x10000), u32be(0), u32be(0), u32be(0), u32be(0x10000), u32be(0), u32be(0), u32be(0), u32be(0x40000000), new Uint8Array(24), u32be(3));
  const tracks = [track(1, "soun", 48000, fragmented ? 0 : Math.round(seconds * 48000), duration),
    ...(video ? [track(2, "vide", 90000, fragmented ? 0 : Math.round(seconds * 90000), duration)] : [])];
  const mvex = fragmented ? [box("mvex", full("trex", 0, u32be(1), u32be(1), u32be(1024), u32be(0), u32be(0)))] : [];
  const ftyp = quicktime ? box("ftyp", "qt  ", u32be(0x200), "qt  ") : box("ftyp", brand, u32be(0x200), brand, "iso2", "mp41");
  const moov = box("moov", mvhd, ...tracks, ...mvex);
  if (!fragmented) return concat(ftyp, moov, box("mdat"));
  // Two fragments for the audio track. The second starts at its decode time and lists per-sample durations.
  const half = Math.round(seconds * 48000 / 2), samples = Math.ceil(half / 1024);
  const first = box("moof", full("mfhd", 0, u32be(1)), box("traf", full("tfhd", 0, u32be(1)), full("tfdt", 1, u64be(0)),
    box("trun", [0, 0, 0, 0], u32be(samples))));
  const durations = Array.from({ length: samples }, (_, i) => i === samples - 1 ? half - 1024 * (samples - 1) : 1024);
  const second = box("moof", full("mfhd", 0, u32be(2)), box("traf", full("tfhd", 0, u32be(1)), full("tfdt", 1, u64be(samples * 1024)),
    box("trun", [0, 0, 0x01, 0], u32be(samples), ...durations.map((value) => u32be(value)))));
  return concat(ftyp, moov, first, box("mdat"), second, box("mdat"));
}

// ---------------------------------------------------------------------------------------------
// WebM (Matroska / EBML)

const ebmlSize = (n: number) => {
  for (let length = 1; length <= 8; length++) {
    if (n < 2 ** (7 * length) - 1) {
      const bytes: number[] = [];
      let value = n;
      for (let i = 0; i < length; i++) { bytes.unshift(value % 256); value = Math.floor(value / 256); }
      bytes[0]! |= 1 << (8 - length);
      return bytes;
    }
  }
  throw new Error("Element too large");
};
const idBytes = (id: number) => { const bytes: number[] = []; for (let value = id; value > 0; value = Math.floor(value / 256)) bytes.unshift(value % 256); return bytes; };
const element = (id: number, ...body: (Uint8Array | number[] | string)[]) => { const content = concat(...body); return concat(idBytes(id), ebmlSize(content.length), content); };
const unknownSize = (id: number, ...body: (Uint8Array | number[] | string)[]) => concat(idBytes(id), [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], ...body);
const uint = (id: number, n: number) => { const bytes: number[] = []; for (let value = n; value > 0 || !bytes.length; value = Math.floor(value / 256)) bytes.unshift(value % 256); return element(id, bytes); };
const float64 = (id: number, n: number) => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, n); return element(id, bytes); };

/**
 * A WebM file the way a browser's MediaRecorder writes it: a segment and clusters of unknown size, and no
 * duration unless `duration` is set. Each cluster holds one second of 20 ms blocks.
 */
export function webm({ seconds, video = false, duration = false }: { seconds: number; video?: boolean; duration?: boolean }): Uint8Array<ArrayBuffer> {
  const header = element(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), element(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2));
  const info = element(0x1549a966, uint(0x2ad7b1, 1_000_000), element(0x4d80, "test"), element(0x5741, "test"), ...(duration ? [float64(0x4489, seconds * 1000)] : []));
  const entries = [element(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 2), element(0x86, "A_OPUS"), element(0xe1, float64(0xb5, 48000), uint(0x9f, 1)))];
  if (video) entries.push(element(0xae, uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 1), element(0x86, "V_VP8"), element(0xe0, uint(0xb0, 320), uint(0xba, 240))));
  const tracks = element(0x1654ae6b, ...entries);
  const clusters: Uint8Array[] = [];
  const total = Math.round(seconds * 1000);
  for (let start = 0; start < total; start += 1000) {
    const blocks: Uint8Array[] = [];
    for (let offset = 0; offset < 1000 && start + offset < total; offset += 20) {
      const time = new Uint8Array(2); new DataView(time.buffer).setInt16(0, offset);
      blocks.push(element(0xa3, [0x81], time, [0x80], new Uint8Array(3)));
    }
    // The last block of the recording ends at `seconds`; a block group carries its duration.
    if (start + 1000 >= total) {
      const last = total - start, time = new Uint8Array(2); new DataView(time.buffer).setInt16(0, last - 20);
      blocks.push(element(0xa0, element(0xa1, [0x81], time, [0x00], new Uint8Array(3)), uint(0x9b, 20)));
    }
    clusters.push(unknownSize(0x1f43b675, uint(0xe7, start), ...blocks));
  }
  return concat(header, unknownSize(0x18538067, info, tracks, ...clusters));
}

// ---------------------------------------------------------------------------------------------
// Other video containers

/** An MPEG-2 program stream: pack headers whose system clock runs from 0 to `seconds`, with padding packets between. */
export function mpegPs(seconds: number): Uint8Array<ArrayBuffer> {
  const pack = (seconds: number) => {
    const scr = Math.round(seconds * 90000), high = Math.floor(scr / 2 ** 30) & 7, low = scr % 2 ** 30;
    return [0, 0, 1, 0xba,
      0x40 | (high << 3) | 0x04 | ((low >>> 28) & 3), (low >>> 20) & 0xff, (((low >>> 15) & 0x1f) << 3) | 0x04 | ((low >>> 13) & 3),
      (low >>> 5) & 0xff, ((low & 0x1f) << 3) | 0x04, 0x01, 0x01, 0x89, 0xc3, 0xf8];
  };
  const padding = concat([0, 0, 1, 0xbe], u16be(16), new Uint8Array(16).fill(0xff));
  const packs: Uint8Array[] = [];
  for (let time = 0; time < seconds; time += 0.5) packs.push(concat(pack(time), padding));
  packs.push(concat(pack(seconds), padding, [0, 0, 1, 0xb9]));
  return concat(...packs);
}

/** An AVI header: the main header's frame time and count, and a video stream header. */
export function avi(seconds: number, fps = 10): Uint8Array<ArrayBuffer> {
  const frames = Math.round(seconds * fps);
  const chunk = (id: string, body: Uint8Array) => concat(id, u32le(body.length), body, body.length & 1 ? [0] : []);
  const list = (type: string, ...body: Uint8Array[]) => { const content = concat(type, ...body); return concat("LIST", u32le(content.length), content); };
  const avih = chunk("avih", concat(u32le(Math.round(1e6 / fps)), u32le(0), u32le(0), u32le(0x10), u32le(frames), u32le(0), u32le(1), u32le(0), u32le(320), u32le(240), new Uint8Array(16)));
  const strh = chunk("strh", concat("vids", "MJPG", u32le(0), u16le(0), u16le(0), u32le(0), u32le(1), u32le(fps), u32le(0), u32le(frames), u32le(0), u32le(0xffffffff), u32le(0), new Uint8Array(8)));
  const strf = chunk("strf", concat(u32le(40), u32le(320), u32le(240), u16le(1), u16le(24), "MJPG", new Uint8Array(20)));
  const body = concat("AVI ", list("hdrl", avih, list("strl", strh, strf)), list("movi"));
  return concat("RIFF", u32le(body.length), body);
}

/** An FLV file with a video tag every 100 ms. */
export function flv(seconds: number): Uint8Array<ArrayBuffer> {
  const tags: Uint8Array[] = [];
  for (let time = 0; time <= seconds * 1000; time += 100) {
    const data = [0x17, 0x01, 0, 0, 0];
    const tag = concat([9], u24be(data.length), u24be(time & 0xffffff), [time >>> 24], u24be(0), data);
    tags.push(concat(tag, u32be(tag.length)));
  }
  return concat("FLV", [1, 0x05], u32be(9), u32be(0), ...tags);
}

const guid = (text: string) => {
  const hex = text.replaceAll("-", ""), bytes = hex.match(/../g)!.map((pair) => parseInt(pair, 16));
  return [bytes[3]!, bytes[2]!, bytes[1]!, bytes[0]!, bytes[5]!, bytes[4]!, bytes[7]!, bytes[6]!, ...bytes.slice(8)];
};
/** An ASF (Windows Media) header with file properties and one stream, video unless `video` is false. */
export function wmv(seconds: number, { video = true }: { video?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const preroll = 3000;
  const fileProps = concat(guid("8CABDCA1-A947-11CF-8EE4-00C00C205365"), u64le(104), new Uint8Array(16), u64le(0), u64le(0), u64le(0),
    u64le(Math.round((seconds + preroll / 1000) * 1e7)), u64le(Math.round(seconds * 1e7)), u64le(preroll), u32le(2), u32le(3200), u32le(3200), u32le(0));
  const type = video ? "BC19EFC0-5B4D-11CF-A8FD-00805F5C442B" : "F8699E40-5B4D-11CF-A8FD-00805F5C442B";
  const streamBody = concat(guid(type), new Uint8Array(16), u64le(0), u32le(0), u32le(0), u16le(1), u32le(0));
  const streamProps = concat(guid("B7DC0791-A9B7-11CF-8EE6-00C00C205365"), u64le(24 + streamBody.length), streamBody);
  const objects = concat(fileProps, streamProps);
  return concat(guid("75B22630-668E-11CF-A6D9-00AA0062CE6C"), u64le(30 + objects.length), u32le(2), [1, 2], objects);
}

export { concat, latin1 };
