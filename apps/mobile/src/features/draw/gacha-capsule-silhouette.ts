/** Simple native silhouette: a rounded dome and a gently flattened cup base. */
export function getGachaCapsuleSilhouette(diameter: number, heroDetail = false) {
  const upperRadius = diameter * 0.5;
  const lowerRadius = diameter * (heroDetail ? 0.5 : 0.32);
  return {
    borderTopLeftRadius: upperRadius,
    borderTopRightRadius: upperRadius,
    borderBottomLeftRadius: lowerRadius,
    borderBottomRightRadius: lowerRadius,
  };
}
