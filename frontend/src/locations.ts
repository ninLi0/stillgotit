/**
 * Source locations, as design/material-data.md defines them. A location starts with a 16-character file key and
 * then names one place in that file: `key/page/N`, `key/time/START-END`, `key/image`, `key/slide/N`,
 * `key/lines/A-B`, `key/cell/N`, `key/document`, or `key/sheet/NAME/rows/1-LAST`. The location `content` means
 * the material's whole text.
 */

/** The part of a location after its file key, or null for `content` and other locations without a key. */
function placeOf(location: string): string | null {
  const slash = location.indexOf("/");
  return location === "content" || slash < 0 ? null : location.slice(slash + 1);
}

/**
 * The place a location names, as the page shows it: "Page 3", "12:30–12:45", "Image", "Slide 4", "Lines 1–100",
 * "Cell 2", "Document", "Sheet Grades", or "Material text" for `content`. Every citation and every block in the
 * material viewer uses this label.
 */
export function placeLabel(location: string): string {
  const place = placeOf(location);
  if (place === null) return "Material text";
  let match: RegExpExecArray | null;
  if ((match = /^page\/(\d+)$/.exec(place))) return `Page ${match[1]}`;
  if ((match = /^time\/([\d:]+)-([\d:]+)$/.exec(place))) return `${match[1]}–${match[2]}`;
  if (place === "image") return "Image";
  if ((match = /^slide\/(\d+)$/.exec(place))) return `Slide ${match[1]}`;
  if ((match = /^lines\/(\d+)-(\d+)$/.exec(place))) return `Lines ${match[1]}–${match[2]}`;
  if ((match = /^cell\/(\d+)$/.exec(place))) return `Cell ${match[1]}`;
  if (place === "document") return "Document";
  if ((match = /^sheet\/(.+)\/rows\/(\d+)-(\d+)$/.exec(place))) {
    // Sheets are saved whole, from row 1. A location saved with a smaller range keeps its rows in the label.
    return match[2] === "1" ? `Sheet ${match[1]}` : `Sheet ${match[1]}, rows ${match[2]}–${match[3]}`;
  }
  // A kind of location this page does not know yet: show its words.
  const words = place.replaceAll("/", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The page number of a `key/page/N` location, or null. */
export function pageOf(location: string): number | null {
  const match = /^page\/(\d+)$/.exec(placeOf(location) ?? "");
  return match ? Number(match[1]) : null;
}

/** A time written `MM:SS` or `H:MM:SS`, in whole seconds, or null when it is not one. */
function seconds(time: string): number | null {
  const parts = time.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** The start and end, in seconds, of a `key/time/START-END` location, or null. */
export function timeRangeOf(location: string): { start: number; end: number } | null {
  const match = /^time\/([\d:]+)-([\d:]+)$/.exec(placeOf(location) ?? "");
  if (!match) return null;
  const start = seconds(match[1]!), end = seconds(match[2]!);
  return start === null || end === null ? null : { start, end };
}
