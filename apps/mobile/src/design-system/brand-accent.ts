import { colors } from "@/theme";

/**
 * Fixed DABBOBA accent balance for ordinary customer screens.
 *
 * This is a visual-area target, not a layout calculation. Neutral surfaces
 * carry the product, the weak tint groups one secondary state, and the solid
 * color is reserved for the primary action or a compact selected indicator.
 * The immersive draw stage is the intentional exception.
 */
export const brandAccentPolicy = {
  visualBalance: {
    neutralPercent: 90,
    weakPercent: 8,
    solidPercent: 2,
  },
  color: {
    solid: colors.brand,
    solidPressed: "#79D778",
    weak: "#F0F8EF",
    weakPressed: "#E4F3E2",
    focusStroke: colors.brand,
  },
  solidRoles: ["primary-action", "selected-control", "compact-badge", "active-indicator"],
  weakRoles: ["secondary-status", "selected-row", "single-guidance-surface"],
} as const;
