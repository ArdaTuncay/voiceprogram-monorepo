export interface CircularPoint {
  x: number;
  y: number;
}

export interface CircularLayoutOptions {
  /** How many points to place around the circle. */
  count: number;
  /** Distance from the center to each point, in pixels. */
  radius: number;
  /** Angle (radians) of the first point. Default: straight up (-90°), so a
   * 12-o'clock start like a clock face. */
  startAngle?: number;
}

/** Places `count` points evenly around a circle (angle step 2π/count),
 * relative to a (0, 0) center — callers add their own container's center
 * offset to each point. Shared by VoiceOrbit (voice-channel participants)
 * and RadialServerSwitcher (server quick-switcher) so the trigonometry
 * lives in exactly one place.
 *
 * Returns [] for count <= 1: a "circle" of zero or one point has no
 * meaningful geometry, so callers handle that case separately (e.g. a
 * single centered item, or nothing). */
export function circularLayout({ count, radius, startAngle = -Math.PI / 2 }: CircularLayoutOptions): CircularPoint[] {
  if (count <= 1) return [];
  const angleStep = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => {
    const angle = startAngle + i * angleStep;
    return {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    };
  });
}
