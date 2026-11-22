const RANGE_PERCENT_MIN = 0;
const RANGE_PERCENT_MAX = 100;

/** 将原生 range 的数值映射为 CSS 轨道填充百分比。 */
export function getRangeProgressPercent(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum <= minimum
  ) {
    return RANGE_PERCENT_MIN;
  }
  const ratio = (value - minimum) / (maximum - minimum);
  return Math.min(
    RANGE_PERCENT_MAX,
    Math.max(RANGE_PERCENT_MIN, ratio * RANGE_PERCENT_MAX),
  );
}
