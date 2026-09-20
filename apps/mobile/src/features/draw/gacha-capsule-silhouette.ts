/** One light spherical capsule profile shared from the chamber through reveal. */
export function getGachaCapsuleSilhouette(diameter: number, _heroDetail = false) {
  const radius = diameter * 0.5;
  return {
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    borderBottomLeftRadius: radius,
    borderBottomRightRadius: radius,
  };
}
