export const ALLOWED_ELEMENTS: Set<string>;
export const ALLOWED_ATTRS: Set<string>;
export const MAX_BYTES: number;
/** Returns the cleaned SVG, or throws an Error saying why the file cannot be used. */
export function sanitizeSvg(input: string): { svg: string };
