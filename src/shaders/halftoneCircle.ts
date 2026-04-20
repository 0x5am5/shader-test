/**
 * Halftone Circle Shader
 *
 * Creates a halftone effect where an image is rendered as a grid of circles.
 * Circle sizes can vary based on luminance or use a fixed radius.
 *
 * @source Adapted from Cables.gl patch (https://d2my2wpsc41l6t.cloudfront.net/zoku/patch.gz.js)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Uniforms
// ─────────────────────────────────────────────────────────────────────────────

export interface HalftoneCircleUniforms {
  /** Source texture to sample colors from */
  tex: WebGLTexture | null;
  /** Optional symbols texture (unused in current implementation) */
  symbols: WebGLTexture | null;
  /** Number of halftone cells across X axis */
  numSquares: number;
  /** Number of discrete circle sizes (depth levels) */
  depth: number;
  /** Canvas aspect ratio (width / height) */
  aspectRatio: number;
  /** If true, circle size varies by luma; if false, use fixed radius */
  sizeByLuma: boolean;
  /** Fixed radius for all circles when sizeByLuma is false (0.0–0.5) */
  fixedRadius: number;
}

export const defaultHalftoneCircleUniforms: HalftoneCircleUniforms = {
  tex: null,
  symbols: null,
  numSquares: 60,
  depth: 10,
  aspectRatio: 1.0,
  sizeByLuma: false,
  fixedRadius: 0.47,
};

// ─────────────────────────────────────────────────────────────────────────────
// Fragment Shader
// ─────────────────────────────────────────────────────────────────────────────

export const halftoneCircleFragmentShader = /* glsl */ `
precision highp float;

// Varyings
in vec2 texCoord;

// Uniforms
uniform sampler2D tex;
uniform sampler2D symbols;
uniform float numSquares;
uniform int Depth;
uniform float aspectRatio;
uniform bool sizeByLuma;
uniform float fixedRadius;

// Output
out vec4 outColor;

/**
 * Compute brightness (luma) of a color using standard luminance weights.
 * Uses Rec. 709 coefficients for perceptual luminance.
 */
float getLuma(vec3 color) {
  const vec3 LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);
  return dot(color, LUMA_WEIGHTS);
}

void main() {
  // 1. Sample source color at this fragment
  vec4 pixelColor = texture(tex, texCoord);

  // 2. Compute grid dimensions for square cells
  //    Rows are scaled by aspect ratio to maintain square cells
  float rows = numSquares * aspectRatio;
  vec2 gridCount = vec2(numSquares, rows);

  // Scale UV to grid space
  vec2 scaledUV = texCoord * gridCount;

  // Get cell position (which cell we're in) and local UV within cell
  vec2 cellPos = floor(scaledUV);
  vec2 localUV = fract(scaledUV);

  // 3. Compute circle radius
  float radius;

  if (sizeByLuma) {
    // Size varies based on luminance
    float luma = getLuma(pixelColor.rgb);

    // Quantize luma to depth levels
    int idx = int(clamp(luma, 0.0, 0.999) * float(max(Depth, 1)));

    // Map index to radius (0 to 0.5 range)
    if (Depth > 1) {
      radius = float(idx) / float(Depth - 1) * 0.5;
    } else {
      radius = 0.0;
    }
  } else {
    // Use fixed radius for all circles
    radius = clamp(fixedRadius, 0.0, 0.5);
  }

  // 4. Distance field for centered circle
  //    Center of cell is at (0.5, 0.5) in local UV space
  vec2 centered = localUV - 0.5;
  float dist = length(centered);

  // 5. Anti-aliased mask using signed distance field
  //    d < 0: inside circle, d > 0: outside circle
  float d = dist - radius;

  // Compute anti-aliasing width based on derivatives
  float aa = fwidth(d) * 0.5;

  // Smooth transition at circle edge
  float mask = 1.0 - smoothstep(-aa, aa, d);

  // Discard fully transparent fragments for performance
  if (mask < 0.01) {
    discard;
  }

  // 6. Sample color at cell center for consistent fill
  //    This ensures each circle has a uniform color
  vec2 sampleUV = (cellPos + 0.5) / gridCount;
  vec4 sampledColor = texture(tex, sampleUV);

  // Apply mask to alpha channel
  float outAlpha = sampledColor.a * mask;

  // Output final color
  outColor = vec4(sampledColor.rgb, outAlpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Vertex Shader
// ─────────────────────────────────────────────────────────────────────────────

export const halftoneCircleVertexShader = /* glsl */ `
precision highp float;

// Attributes
in vec3 vPosition;
in vec2 attrTexCoord;
in vec3 attrVertNormal;
in vec3 attrTangent;
in vec3 attrBiTangent;
in float attrVertIndex;

// Uniforms
uniform mat4 projMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;

// Varyings
out vec2 texCoord;
out vec3 norm;

void main() {
  // Pass through texture coordinates
  texCoord = attrTexCoord;

  // Pass through normal (for potential lighting)
  norm = attrVertNormal;

  // Transform vertex position
  vec4 pos = vec4(vPosition, 1.0);

  // Unused but available for module extensions
  vec3 tangent = attrTangent;
  vec3 bitangent = attrBiTangent;

  // Model matrix (can be modified by modules)
  mat4 mMatrix = modelMatrix;

  // Final position: projection * view * model * position
  gl_Position = projMatrix * (viewMatrix * mMatrix) * pos;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// WebGL 1 Compatibility (ES 100)
// ─────────────────────────────────────────────────────────────────────────────

export const halftoneCircleFragmentShaderWebGL1 = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;

// Varyings
varying vec2 texCoord;

// Uniforms
uniform sampler2D tex;
uniform sampler2D symbols;
uniform float numSquares;
uniform int Depth;
uniform float aspectRatio;
uniform bool sizeByLuma;
uniform float fixedRadius;

/**
 * Compute brightness (luma) of a color using standard luminance weights.
 */
float getLuma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  // Sample source color
  vec4 pixelColor = texture2D(tex, texCoord);

  // Grid dimensions
  float rows = numSquares * aspectRatio;
  vec2 gridCount = vec2(numSquares, rows);
  vec2 scaledUV = texCoord * gridCount;
  vec2 cellPos = floor(scaledUV);
  vec2 localUV = fract(scaledUV);

  // Compute radius
  float radius;
  if (sizeByLuma) {
    float luma = getLuma(pixelColor.rgb);
    int idx = int(clamp(luma, 0.0, 0.999) * float(max(Depth, 1)));
    if (Depth > 1) {
      radius = float(idx) / float(Depth - 1) * 0.5;
    } else {
      radius = 0.0;
    }
  } else {
    radius = clamp(fixedRadius, 0.0, 0.5);
  }

  // SDF circle
  vec2 centered = localUV - 0.5;
  float dist = length(centered);
  float d = dist - radius;
  float aa = fwidth(d) * 0.5;
  float mask = 1.0 - smoothstep(-aa, aa, d);

  if (mask < 0.01) {
    discard;
  }

  // Sample at cell center
  vec2 sampleUV = (cellPos + 0.5) / gridCount;
  vec4 sampledColor = texture2D(tex, sampleUV);
  float outAlpha = sampledColor.a * mask;

  gl_FragColor = vec4(sampledColor.rgb, outAlpha);
}
`;

export const halftoneCircleVertexShaderWebGL1 = /* glsl */ `
precision highp float;

// Attributes
attribute vec3 vPosition;
attribute vec2 attrTexCoord;
attribute vec3 attrVertNormal;

// Uniforms
uniform mat4 projMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;

// Varyings
varying vec2 texCoord;
varying vec3 norm;

void main() {
  texCoord = attrTexCoord;
  norm = attrVertNormal;

  vec4 pos = vec4(vPosition, 1.0);
  mat4 mMatrix = modelMatrix;

  gl_Position = projMatrix * (viewMatrix * mMatrix) * pos;
}
`;
