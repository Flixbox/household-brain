/** Rows of a six-wide contact sheet holding one tile per frame at `fps` for `seconds`. */
export const sheetRows = (seconds: number, fps: number): number => Math.ceil((Math.floor(seconds * fps) + 1) / 6)
