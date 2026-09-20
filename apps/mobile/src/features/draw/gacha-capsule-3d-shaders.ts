/**
 * A smooth spherical capsule with two independently transformed hollow halves.
 * Thin cut faces, restrained reflections and a depth-tested internal luminous
 * surface are supersampled offline into the bounded native frame atlas.
 */
export const CAPSULE_3D_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const CAPSULE_3D_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
// Shared scene camera projection: normalized center X/Y and physical diameter.
uniform vec3 uProjection;
uniform float uViewWidth;
uniform float uProgress;
uniform float uIvory;
uniform sampler2D uWordmark;
// Shared timeline: seal release, shell opening and monotonic internal light.
uniform vec3 uReveal;
uniform float uRattle;
uniform float uOpacity;
uniform vec4 uClip;

const float PI = 3.14159265359;
const float FAR = 1000.0;
// Thin molded plastic: the seam radius and full height remain unchanged.
const float INNER_RADIUS = 0.98;
const float COLLAR_RADIUS = 1.006;
const float COLLAR_HEIGHT = 0.016;

mat3 rotateX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}
mat3 rotateY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}
mat3 rotateZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}
mat3 inverseRotation(mat3 m) {
  return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]);
}
vec2 sphereRoots(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float h = b * b - dot(ro, ro) + radius * radius;
  if (h < 0.0) return vec2(FAR);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Hit.y: 1 exterior, 2 interior, 3 annular thickness, 4 raised collar.
void acceptShell(float t, float material, float side, vec3 ro, vec3 rd, inout vec2 hit) {
  if (t > 0.001 && t < hit.x && (ro.y + rd.y * t) * side >= 0.0) hit = vec2(t, material);
}
vec2 intersectShell(vec3 ro, vec3 rd, float side) {
  vec2 hit = vec2(FAR, 0.0);
  vec2 outer = sphereRoots(ro, rd, 1.0);
  acceptShell(outer.x, 1.0, side, ro, rd, hit);
  acceptShell(outer.y, 1.0, side, ro, rd, hit);
  vec2 inner = sphereRoots(ro, rd, INNER_RADIUS);
  acceptShell(inner.x, 2.0, side, ro, rd, hit);
  acceptShell(inner.y, 2.0, side, ro, rd, hit);

  if (abs(rd.y) > 0.00001) {
    float t = -ro.y / rd.y;
    vec3 atCut = ro + t * rd;
    float radius = length(atCut.xz);
    if (t > 0.001 && t < hit.x && radius >= INNER_RADIUS && radius <= COLLAR_RADIUS) hit = vec2(t, 3.0);
  }

  // Injection-moulded coupling lip has its own radial surface and end face.
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - COLLAR_RADIUS * COLLAR_RADIUS;
  float determinant = b * b - a * c;
  if (a > 0.00001 && determinant >= 0.0) {
    float h = sqrt(determinant);
    float t1 = (-b - h) / a;
    float y1 = (ro.y + rd.y * t1) * side;
    if (t1 > 0.001 && t1 < hit.x && y1 >= 0.0 && y1 <= COLLAR_HEIGHT) hit = vec2(t1, 4.0);
    float t2 = (-b + h) / a;
    float y2 = (ro.y + rd.y * t2) * side;
    if (t2 > 0.001 && t2 < hit.x && y2 >= 0.0 && y2 <= COLLAR_HEIGHT) hit = vec2(t2, 4.0);
  }
  if (abs(rd.y) > 0.00001) {
    float t = (COLLAR_HEIGHT * side - ro.y) / rd.y;
    float radius = length((ro + rd * t).xz);
    if (t > 0.001 && t < hit.x && radius >= 0.997 && radius <= COLLAR_RADIUS) hit = vec2(t, 3.0);
  }
  return hit;
}

vec3 localNormal(vec3 position, float material, float side) {
  if (material < 1.5) return normalize(position);
  if (material < 2.5) return -normalize(position);
  if (material < 3.5) return vec3(0.0, position.y * side > COLLAR_HEIGHT * 0.5 ? side : -side, 0.0);
  return normalize(vec3(position.x, 0.0, position.z));
}

vec3 filmic(vec3 value) {
  return clamp((value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14), 0.0, 1.0);
}
// Emission is a soft face recessed inside the lower shell, never a glowing orb.
float intersectMouthLight(vec3 ro, vec3 rd) {
  if (abs(rd.y) < 0.00001) return FAR;
  float t = (-0.08 - ro.y) / rd.y;
  if (t <= 0.001 || length((ro + t * rd).xz) > 0.84) return FAR;
  return t;
}

vec3 shadeShell(vec3 localPoint, vec3 worldPoint, vec3 normal, vec3 viewDirection, float material, float side, float opening, float energy, vec3 emitterCenter) {
  // Shared light capsule palette: translucent-looking dome, satin bowl, fine seam.
  vec3 upper = mix(vec3(0.878, 0.973, 0.882), vec3(0.988, 0.980, 0.953), uIvory);
  vec3 lower = mix(vec3(0.569, 0.914, 0.557), vec3(0.957, 0.941, 0.902), uIvory);
  vec3 seam = mix(vec3(0.467, 0.788, 0.475), vec3(0.812, 0.773, 0.698), uIvory);
  vec3 base = side > 0.0 ? upper : lower;
  float y = abs(localPoint.y);
  float lip = 1.0 - smoothstep(COLLAR_HEIGHT, COLLAR_HEIGHT * 1.85, y);
  base = mix(base, seam, lip * 0.48);
  if (material > 1.5 && material < 2.5) base *= vec3(0.43, 0.46, 0.37);
  if (material > 2.5 && material < 3.5) base = seam * 0.83;
  if (material > 3.5) {
    float channel = smoothstep(COLLAR_HEIGHT * 0.24, COLLAR_HEIGHT * 0.35, y)
      * (1.0 - smoothstep(COLLAR_HEIGHT * 0.59, COLLAR_HEIGHT * 0.70, y));
    base = mix(seam * 0.9, lower * 0.32, channel * 0.65);
  }
  // The actual brand PNG is printed on the lower hemisphere. Longitude and
  // latitude wrap it around the real shell and keep it attached as it opens.
  float ink = 0.0;
  if (side < 0.0 && material < 1.5 && localPoint.z > 0.48) {
    float longitude = atan(localPoint.x, localPoint.z);
    float latitude = asin(clamp(localPoint.y, -1.0, 1.0));
    // 1170:172 canonical artwork, about 60% of the projected sphere diameter.
    vec2 markUv = vec2(longitude / 1.36 + 0.5, 0.5 - (latitude + 0.36) / (1.36 * 172.0 / 1170.0));
    if (markUv.x >= 0.0 && markUv.x <= 1.0 && markUv.y >= 0.0 && markUv.y <= 1.0) {
      vec4 mark = texture2D(uWordmark, markUv);
      ink = mark.a;
      base = mix(base, mark.rgb, ink);
    }
  }

  vec3 key = normalize(vec3(-0.68, 0.94, 1.40));
  vec3 fill = normalize(vec3(0.95, 0.18, 0.65));
  vec3 rim = normalize(vec3(0.72, 0.66, -0.75));
  float diffuse = max(dot(normal, key), 0.0);
  float fillLight = max(dot(normal, fill), 0.0);
  float rimLight = max(dot(normal, rim), 0.0);
  float nv = max(dot(normal, viewDirection), 0.0);
  float fresnel = pow(1.0 - nv, 4.0);
  float cavity = material > 1.5 && material < 2.5 ? 0.58 : 1.0;
  float seamOcclusion = mix(0.62 + smoothstep(0.02, 0.20, y) * 0.38, 1.0, opening);
  vec3 color = pow(base, vec3(2.2)) * (0.17 + 0.92 * diffuse + 0.24 * fillLight) * cavity * seamOcclusion;
  color += pow(base, vec3(2.2)) * rimLight * vec3(0.13, 0.22, 0.12);

  // Broad softboxes and restrained Fresnel preserve smooth plastic reflections.
  float keySpec = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), 54.0);
  float broadSpec = pow(max(dot(normal, normalize(key + viewDirection)), 0.0), 13.0);
  float fillSpec = pow(max(dot(normal, normalize(fill + viewDirection)), 0.0), 86.0);
  color += vec3(1.0, 0.99, 0.95) * (keySpec * 0.34 + broadSpec * 0.20) * cavity * (1.0 - ink * 0.68);
  color += vec3(0.88, 0.97, 0.90) * fillSpec * 0.08 * (1.0 - ink * 0.68);
  color += vec3(0.68, 0.86, 0.68) * fresnel * (0.08 + rimLight * 0.24);

  vec3 toCore = emitterCenter - worldPoint;
  float coreFacing = max(dot(normal, normalize(toCore + vec3(0.0, 0.0, 0.10))), 0.0);
  float core = energy * (0.14 + coreFacing * 0.8) / (0.35 + dot(toCore, toCore));
  color += vec3(1.0) * core * (material > 1.5 ? 1.75 : 0.20);
  color = pow(filmic(color), vec3(1.0 / 2.2));
  return clamp(color, 0.0, 1.0);
}

void main() {
  if (uOpacity <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 pixelUv = (floor(vUv * uResolution) + 0.5) / uResolution;
  vec2 screenUv = vec2(vUv.x, 1.0 - vUv.y);
  if (screenUv.x < uClip.x || screenUv.y < uClip.y || screenUv.x > uClip.z || screenUv.y > uClip.w) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float p = clamp(uProgress, 0.0, 1.0);
  float crack = uReveal.x;
  float opening = uReveal.y;
  float energy = uReveal.z;
  float aspect = uResolution.y / uResolution.x;
  vec2 uv = (pixelUv - 0.5) * vec2(2.0, 2.0 * aspect);
  vec2 center = vec2((uProjection.x - 0.5) * 2.0, (0.5 - uProjection.y) * 2.0 * aspect);
  uv -= center;

  // The sphere stays fixed in its pickup compartment. Its camera distance and
  // framing match the machine's shared scene projection exactly, so both grow
  // together during the push-in instead of a separate flying-capsule track.
  float targetRadius = max(uProjection.z / max(uViewWidth, 1.0), 0.001);
  float distance = sqrt(pow(2.7 / targetRadius, 2.0) + 1.0);
  vec3 ro = vec3(0.0, 0.0, distance);
  vec3 rd = normalize(vec3(uv, -2.7));
  mat3 bodyRotation = rotateZ(-0.075 + uRattle) * rotateY(-0.10) * rotateX(-0.065);
  mat3 upperRotation = bodyRotation * rotateX(-opening * 0.18);
  mat3 lowerRotation = bodyRotation * rotateX(opening * 0.18);
  vec3 upperCenter = vec3(0.0, crack * 0.035 + opening * 0.42, 0.0);
  vec3 lowerCenter = vec3(0.0, -crack * 0.035 - opening * 0.42, 0.0);
  // The emitting material stays inside the lower bowl as it separates. It
  // must never hang at the old screen-center seam after the bowl moves down.
  vec3 emitterCenter = lowerCenter + lowerRotation * vec3(0.0, -0.08, 0.0);

  mat3 upperInverse = inverseRotation(upperRotation);
  mat3 lowerInverse = inverseRotation(lowerRotation);
  vec3 upperRo = upperInverse * (ro - upperCenter);
  vec3 upperRd = upperInverse * rd;
  vec3 lowerRo = lowerInverse * (ro - lowerCenter);
  vec3 lowerRd = lowerInverse * rd;
  vec2 upperHit = intersectShell(upperRo, upperRd, 1.0);
  vec2 lowerHit = intersectShell(lowerRo, lowerRd, -1.0);
  bool isUpper = upperHit.x < lowerHit.x;
  vec2 hit = isUpper ? upperHit : lowerHit;

  // Light is born inside the seal. The opaque hemispheres occlude the core;
  // only the growing physical gap exposes it before its bloom spreads out.
  vec2 emitterUv = emitterCenter.xy * 2.7 / (distance - emitterCenter.z);
  vec2 capsuleUv = (uv - emitterUv) / targetRadius;
  float bloomWidth = mix(0.025, 0.30, opening);
  float halo = exp(-capsuleUv.x * capsuleUv.x * 3.4
    - capsuleUv.y * capsuleUv.y / max(0.002, bloomWidth * bloomWidth)) * energy;
  float alpha = min(0.3, halo * 0.24);
  vec3 color = vec3(1.0);
  float coreHit = intersectMouthLight(lowerRo, lowerRd);
  bool coreVisible = energy > 0.0 && coreHit < hit.x;
  // The actual shell is shaded first. A recessed luminous face is blended over
  // the farther cavity only when neither opaque half/front rim blocks the ray.

  // No infinite floor is baked into the reveal: the native pickup owns its
  // contact surface, and the closeup stays clear of a clipped rectangular glow.
  // A nearer emissive face must remain visible over the far inner wall, while
  // the front lip and opaque exterior still occlude it through the depth test.
  if (hit.x < FAR - 1.0) {
    float side = isUpper ? 1.0 : -1.0;
    vec3 localPoint = isUpper ? upperRo + hit.x * upperRd : lowerRo + hit.x * lowerRd;
    vec3 localN = localNormal(localPoint, hit.y, side);
    vec3 normal = normalize(isUpper ? upperRotation * localN : lowerRotation * localN);
    vec3 worldPoint = ro + rd * hit.x;
    color = shadeShell(localPoint, worldPoint, normal, -rd, hit.y, side, opening, energy, emitterCenter);
    alpha = 1.0;
  }
  if (coreVisible) {
    float radial = length((lowerRo + lowerRd * coreHit).xz) / 0.84;
    float feather = 1.0 - smoothstep(0.72, 1.0, radial);
    float emission = feather * smoothstep(0.0, 0.42, energy);
    color = mix(color, vec3(1.0), emission);
    alpha = max(alpha, emission);
  }
  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;
