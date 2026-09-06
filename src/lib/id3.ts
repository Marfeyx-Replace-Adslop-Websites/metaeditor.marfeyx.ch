export type TrackMetadata = {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year: string;
  genre: string;
  track: string;
  disc: string;
  composer: string;
  comment: string;
  explicit: boolean;
  cover?: { data: Uint8Array; mime: string; url: string };
};

export const emptyMetadata = (): TrackMetadata => ({
  title: "",
  artist: "",
  albumArtist: "",
  album: "",
  year: "",
  genre: "",
  track: "",
  disc: "",
  composer: "",
  comment: "",
  explicit: false,
});

const textDecoder = new TextDecoder("latin1");

function syncSafe(bytes: Uint8Array, offset = 0) {
  return (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3];
}

function uint32(bytes: Uint8Array, offset = 0) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function decodeText(data: Uint8Array) {
  if (!data.length) return "";
  const encoding = data[0];
  const content = data.slice(1);
  if (encoding === 3) return new TextDecoder("utf-8").decode(content).replace(/\0+$/, "");
  if (encoding === 1 || encoding === 2) {
    let littleEndian = encoding === 1 && content[0] === 0xff && content[1] === 0xfe;
    let start = encoding === 1 && ((content[0] === 0xff && content[1] === 0xfe) || (content[0] === 0xfe && content[1] === 0xff)) ? 2 : 0;
    if (encoding === 2 || (encoding === 1 && content[0] === 0xfe)) littleEndian = false;
    let result = "";
    for (let i = start; i + 1 < content.length; i += 2) {
      const code = littleEndian ? content[i] | (content[i + 1] << 8) : (content[i] << 8) | content[i + 1];
      if (code) result += String.fromCharCode(code);
    }
    return result;
  }
  return textDecoder.decode(content).replace(/\0+$/, "");
}

function terminatorEnd(data: Uint8Array, start: number, wide: boolean) {
  for (let i = start; i < data.length - (wide ? 1 : 0); i += wide ? 2 : 1) {
    if (data[i] === 0 && (!wide || data[i + 1] === 0)) return i;
  }
  return data.length;
}

export async function readMetadata(file: File): Promise<TrackMetadata> {
  const metadata = emptyMetadata();
  metadata.title = file.name.replace(/\.mp3$/i, "");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 10 || textDecoder.decode(bytes.slice(0, 3)) !== "ID3") return metadata;

  const version = bytes[3];
  const tagEnd = Math.min(bytes.length, 10 + syncSafe(bytes, 6));
  const fieldMap: Record<string, keyof TrackMetadata> = {
    TIT2: "title", TPE1: "artist", TPE2: "albumArtist", TALB: "album", TYER: "year",
    TDRC: "year", TCON: "genre", TRCK: "track", TPOS: "disc", TCOM: "composer",
  };

  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const id = textDecoder.decode(bytes.slice(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? syncSafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    if (!size || offset + 10 + size > bytes.length) break;
    const frame = bytes.slice(offset + 10, offset + 10 + size);
    if (fieldMap[id]) (metadata[fieldMap[id]] as string) = decodeText(frame);
    if (id === "COMM" && frame.length > 4) {
      const wide = frame[0] === 1 || frame[0] === 2;
      const descriptionEnd = terminatorEnd(frame, 4, wide);
      metadata.comment = decodeText(new Uint8Array([frame[0], ...frame.slice(descriptionEnd + (wide ? 2 : 1))]));
    }
    if (id === "TXXX") {
      const wide = frame[0] === 1 || frame[0] === 2;
      const descriptionEnd = terminatorEnd(frame, 1, wide);
      const description = decodeText(frame.slice(0, descriptionEnd));
      const value = decodeText(new Uint8Array([frame[0], ...frame.slice(descriptionEnd + (wide ? 2 : 1))]));
      if (description.toUpperCase().includes("ITUNESADVISORY")) metadata.explicit = value === "1";
    }
    if (id === "APIC" && frame.length > 4) {
      const mimeEnd = terminatorEnd(frame, 1, false);
      const mime = textDecoder.decode(frame.slice(1, mimeEnd)) || "image/jpeg";
      const descriptionStart = mimeEnd + 2;
      const wide = frame[0] === 1 || frame[0] === 2;
      const descriptionEnd = terminatorEnd(frame, descriptionStart, wide);
      const imageStart = descriptionEnd + (wide ? 2 : 1);
      const data = frame.slice(imageStart);
      if (data.length) metadata.cover = { data, mime, url: URL.createObjectURL(new Blob([data], { type: mime })) };
    }
    offset += 10 + size;
  }
  return metadata;
}

function concat(...arrays: Uint8Array[]) {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const array of arrays) { output.set(array, cursor); cursor += array.length; }
  return output;
}

function utf16(value: string) {
  const bytes = new Uint8Array(3 + value.length * 2 + 2);
  bytes[0] = 1; bytes[1] = 0xff; bytes[2] = 0xfe;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    bytes[3 + i * 2] = code & 0xff;
    bytes[4 + i * 2] = code >> 8;
  }
  return bytes;
}

function frame(id: string, content: Uint8Array) {
  const header = new Uint8Array(10);
  header.set(new TextEncoder().encode(id), 0);
  const view = new DataView(header.buffer);
  view.setUint32(4, content.length, false);
  return concat(header, content);
}

function textFrame(id: string, value: string) {
  return value.trim() ? frame(id, utf16(value.trim())) : new Uint8Array();
}

function txxxFrame(description: string, value: string) {
  if (!value) return new Uint8Array();
  return frame("TXXX", concat(new Uint8Array([1]), utf16(description).slice(1), utf16(value).slice(1)));
}

function commentFrame(value: string) {
  if (!value.trim()) return new Uint8Array();
  const content = concat(new Uint8Array([1]), new TextEncoder().encode("eng"), utf16("").slice(1), utf16(value.trim()).slice(1));
  return frame("COMM", content);
}

function coverFrame(cover?: TrackMetadata["cover"]) {
  if (!cover) return new Uint8Array();
  const mime = new TextEncoder().encode(cover.mime);
  const content = concat(new Uint8Array([0]), mime, new Uint8Array([0, 3, 0]), cover.data);
  return frame("APIC", content);
}

function synchsafeBytes(value: number) {
  return new Uint8Array([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
}

export async function writeMetadata(file: File, metadata: TrackMetadata) {
  const source = new Uint8Array(await file.arrayBuffer());
  let audioStart = 0;
  if (source.length >= 10 && textDecoder.decode(source.slice(0, 3)) === "ID3") audioStart = 10 + syncSafe(source, 6);
  const frames = concat(
    textFrame("TIT2", metadata.title), textFrame("TPE1", metadata.artist), textFrame("TPE2", metadata.albumArtist),
    textFrame("TALB", metadata.album), textFrame("TYER", metadata.year), textFrame("TCON", metadata.genre),
    textFrame("TRCK", metadata.track), textFrame("TPOS", metadata.disc), textFrame("TCOM", metadata.composer),
    commentFrame(metadata.comment), txxxFrame("ITUNESADVISORY", metadata.explicit ? "1" : "0"), coverFrame(metadata.cover),
  );
  const padding = new Uint8Array(1024);
  const header = concat(new TextEncoder().encode("ID3"), new Uint8Array([3, 0, 0]), synchsafeBytes(frames.length + padding.length));
  return new Blob([header, frames, padding, source.slice(audioStart)], { type: "audio/mpeg" });
}

export function safeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim().slice(0, 180) || "edited-track";
}
