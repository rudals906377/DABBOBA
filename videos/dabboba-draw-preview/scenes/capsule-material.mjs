import { CAPSULE_3D_FRAGMENT_SHADER } from './capsule-shader.mjs';

// User-approved preview-only refinement. The material-only export preserves
// native geometry and compositing for like-for-like comparison. The final
// export additionally reduces separation and gives the recessed light depth.
export const CAPSULE_MATERIAL_REVISION = 'neutral-ivory-thin-plastic-upper-v2';
export const CAPSULE_OPEN_OFFSET = 0.32;

const start = CAPSULE_3D_FRAGMENT_SHADER.indexOf('vec3 shadeShell(');
const end = CAPSULE_3D_FRAGMENT_SHADER.indexOf('\nvoid main()', start);
if (start < 0 || end < 0) throw new Error('Native capsule shading boundary changed');

const replacements = [
  ['vec3 upper = mix(vec3(0.878, 0.973, 0.882), vec3(0.988, 0.980, 0.953), uIvory);',
    'vec3 upper = vec3(0.976, 0.973, 0.953);'],
  ['vec3 seam = mix(vec3(0.467, 0.788, 0.475), vec3(0.812, 0.773, 0.698), uIvory);',
    'vec3 seam = side > 0.0 ? vec3(0.800, 0.798, 0.785) : mix(vec3(0.467, 0.788, 0.475), vec3(0.812, 0.773, 0.698), uIvory);'],
  ['base *= vec3(0.43, 0.46, 0.37);',
    'base *= side > 0.0 ? vec3(0.70) : vec3(0.43, 0.46, 0.37);'],
  ['base = mix(seam * 0.9, lower * 0.32, channel * 0.65);',
    'base = mix(seam * 0.9, (side > 0.0 ? upper : lower) * 0.32, channel * 0.65);'],
  ['float cavity = material > 1.5 && material < 2.5 ? 0.58 : 1.0;',
    'float cavity = material > 1.5 && material < 2.5 ? (side > 0.0 ? 0.72 : 0.58) : 1.0;'],
  ['rimLight * vec3(0.13, 0.22, 0.12);',
    'rimLight * (side > 0.0 ? vec3(0.16, 0.16, 0.15) : vec3(0.13, 0.22, 0.12));'],
  ['color += vec3(0.88, 0.97, 0.90) * fillSpec',
    'color += (side > 0.0 ? vec3(0.97, 0.97, 0.95) : vec3(0.88, 0.97, 0.90)) * fillSpec'],
  ['color += vec3(0.68, 0.86, 0.68) * fresnel',
    'color += (side > 0.0 ? vec3(0.80, 0.80, 0.78) : vec3(0.68, 0.86, 0.68)) * fresnel'],
  ['float keySpec = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), 54.0);',
    'float keySpec = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), side > 0.0 ? 30.0 : 54.0);'],
  ['float broadSpec = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), 13.0);',
    'float broadSpec = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), side > 0.0 ? 8.0 : 13.0);'],
  ['float fillSpec = pow(max(dot(normal, normalize(fill + viewDirection)), 0.0), 86.0);',
    'float fillSpec = pow(max(dot(normal, normalize(fill + viewDirection)), 0.0), side > 0.0 ? 38.0 : 86.0);'],
  ['(keySpec * 0.34 + broadSpec * 0.20)',
    '(keySpec * (side > 0.0 ? 0.13 : 0.34) + broadSpec * (side > 0.0 ? 0.27 : 0.20))'],
  ['* fillSpec * 0.08 *', '* fillSpec * (side > 0.0 ? 0.045 : 0.08) *'],
  ['* fresnel * (0.08 + rimLight * 0.24);',
    '* fresnel * (side > 0.0 ? (0.035 + rimLight * 0.095) : (0.08 + rimLight * 0.24));'],
  ['  vec3 toCore = emitterCenter - worldPoint;', `  // A low-energy, broad grazing lift suggests a thin molded wall without
  // glass transparency or a metallic rim. Only the upper exterior receives it.
  if (side > 0.0 && material < 1.5) {
    float edgeView = pow(1.0 - nv, 2.6);
    float backlit = max(dot(-normal, key), 0.0);
    float edgeTransmission = edgeView * (0.055 + 0.070 * backlit)
      * (0.4 + 0.6 * smoothstep(0.03, 0.18, y));
    color += vec3(1.0, 0.998, 0.985) * edgeTransmission;
  }

  vec3 toCore = emitterCenter - worldPoint;`],
];

let shading = CAPSULE_3D_FRAGMENT_SHADER.slice(start, end);
for (const [before, after] of replacements) {
  if (shading.split(before).length !== 2) {
    throw new Error(`Native capsule material anchor changed: ${before}`);
  }
  shading = shading.replace(before, after);
}

export const CAPSULE_MATERIAL_FRAGMENT_SHADER =
  CAPSULE_3D_FRAGMENT_SHADER.slice(0, start) + shading + CAPSULE_3D_FRAGMENT_SHADER.slice(end);

const nativeMouth = `  if (coreVisible) {
    float radial = length((lowerRo + lowerRd * coreHit).xz) / 0.84;
    float feather = 1.0 - smoothstep(0.72, 1.0, radial);
    float emission = feather * smoothstep(0.0, 0.42, energy);
    color = mix(color, vec3(1.0), emission);
    alpha = max(alpha, emission);
  }`;

const recessedMouth = `  if (coreVisible) {
    float radial = length((lowerRo + lowerRd * coreHit).xz) / 0.84;
    float feather = 1.0 - smoothstep(0.72, 1.0, radial);
    // The same recessed face is brightest near its center. The gradual edge
    // attenuation leaves depth against the existing inner wall and front lip.
    float centerHot = exp(-radial * radial * 5.4);
    float edgeDepth = smoothstep(0.45, 1.0, radial);
    float depthAttenuation = mix(1.0, 0.62, edgeDepth);
    float emission = feather * smoothstep(0.0, 0.42, energy) * (0.72 + 0.28 * centerHot);
    vec3 emissionRadiance = vec3(1.0, 0.997, 0.985)
      * (0.28 + energy * (0.90 + centerHot * 1.65)) * depthAttenuation;
    vec3 mouthColor = pow(filmic(emissionRadiance), vec3(1.0 / 2.2));
    color = mix(color, mouthColor, emission);
    alpha = max(alpha, emission);
  }`;

if (CAPSULE_MATERIAL_FRAGMENT_SHADER.split('opening * 0.42').length !== 3) {
  throw new Error('Native capsule separation anchors changed');
}
if (CAPSULE_MATERIAL_FRAGMENT_SHADER.split(nativeMouth).length !== 2) {
  throw new Error('Native capsule recessed-emission anchor changed');
}

export const CAPSULE_PREVIEW_FRAGMENT_SHADER = CAPSULE_MATERIAL_FRAGMENT_SHADER
  .replaceAll('opening * 0.42', `opening * ${CAPSULE_OPEN_OFFSET.toFixed(2)}`)
  .replace(nativeMouth, recessedMouth);
