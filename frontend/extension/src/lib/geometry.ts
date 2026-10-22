// Where the fallback popup window goes: top center.

export const POPUP_WIDTH = 560;
export const POPUP_HEIGHT = 220;
export const TOP_OFFSET = 44;

export interface Rect {
  left: number;
  top: number;
  width: number;
}

/** Top-center inside `area` (a browser window's bounds, or a display's work area). */
export function topCenter(area: Partial<Rect>, width = POPUP_WIDTH, topOffset = TOP_OFFSET) {
  const areaLeft = area.left ?? 0;
  const areaWidth = area.width ?? width;
  return {
    left: Math.round(areaLeft + Math.max(0, (areaWidth - width) / 2)),
    top: Math.round((area.top ?? 0) + topOffset),
  };
}
