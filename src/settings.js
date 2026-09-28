/**
 * Persisted player settings. Everything read back from localStorage or the
 * URL is untrusted (older versions, hand edits, shared links), so each field
 * is checked against what the UI can produce and falls back to its default.
 */
export const QUALITIES = ['low', 'medium', 'high'];

const inList = (list) => (v) => list.includes(v);
const numberIn = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * @param saved parsed storage object (anything)
 * @param defaults complete default settings
 * @param opts {cameraModes, driveModes, colors}
 */
export function sanitizeSettings(saved, defaults, { cameraModes, driveModes, colors }) {
  const raw = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
  // v0.1.0 stored a single on/off "assists" flag.
  if (raw.driveMode === undefined && raw.assists !== undefined) raw.driveMode = raw.assists ? 'normal' : 'real';
  const valid = {
    camera: inList(cameraModes),
    motionBlur: numberIn(0, 1.5),
    lensDistortion: (v) => typeof v === 'boolean',
    driveMode: inList(driveModes),
    volume: numberIn(0, 1),
    quality: inList(QUALITIES),
    name: (v) => typeof v === 'string' && v.length <= 14,
    color: (v) => colors.includes(v),
    number: (v) => Number.isInteger(v) && v >= 1 && v <= 99,
  };
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (key in raw && valid[key]?.(raw[key])) out[key] = raw[key];
  }
  return out;
}
