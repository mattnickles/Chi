#!/usr/bin/env tsx
/**
 * CSS Custom Properties Generator for Chi Design System
 * =====================================================
 * Parses per-theme _variables.scss files and generates:
 * 1. css-variables.scss (Foundation + Semantic CSS custom properties)
 * 2. dist/tokens/{theme}.json (AI-optimized token metadata)
 *
 * Usage:
 *   tsx scripts/generate-css-custom-properties.ts
 *   tsx scripts/generate-css-custom-properties.ts --theme=lumen
 *   tsx scripts/generate-css-custom-properties.ts --layers=foundation,semantic
 *   tsx scripts/generate-css-custom-properties.ts --json-only
 *   tsx scripts/generate-css-custom-properties.ts --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import * as sass from 'sass';

// =============================================================================
// Configuration
// =============================================================================

const THEMES = ['lumen', 'connect', 'brightspeed', 'centurylink', 'colt', 'portal'] as const;
type Theme = (typeof THEMES)[number];

const LAYERS = ['foundation', 'semantic'] as const;
type Layer = (typeof LAYERS)[number];

const SRC_ROOT = path.resolve(import.meta.dirname, '..', 'src', 'chi');
const THEMES_DIR = path.join(SRC_ROOT, 'themes');
const GLOBAL_VARS_FILE = path.join(SRC_ROOT, '_global-variables.scss');
const DIST_TOKENS_DIR = path.resolve(import.meta.dirname, '..', 'dist', 'tokens');

// CSS custom property prefix
const PREFIX = 'chi';

// =============================================================================
// Token Classification Rules
// =============================================================================

/** Foundation tokens: core scales, palette, shared primitives */
const FOUNDATION_PATTERNS: RegExp[] = [
  // Typography - font family (consumer-facing only; excludes $font-family-icon)
  /^\$font-family-(base|mono)$/,
  // Typography - font size (named scale)
  /^\$font-size-(3xl|2xl|xl|lg|md|sm|xs|2xs|base|h[1-6])$/,
  // Typography - font weight
  /^\$font-weight-(light|normal|medium|semi-bold|bold|extra-bold|black|base|h[1-6])$/,
  // Typography - line height
  /^\$line-height-(base|xl|lg|md|sm|h[1-6])$/,
  // Color palette ramps: $color-{hue}-{number}
  // Covers all hue families including CenturyLink-unique mint, bright-blue, teal-blue
  /^\$color-(grey|red|pink|purple|indigo|violet|navy|blue|bright-blue|cyan|teal|teal-blue|mint|green|yellow|orange)-\d+$/,
  // Color extremes
  /^\$color-(black|white)$/,
  // Base unit (spacing primitive — AI uses calc(var(--chi-base-unit) * N))
  /^\$base-unit$/,
  // Opacity scale
  /^\$opacity-\d+$/,
  // Border radius primitives (--chi-border-radius-base is canonical; bare $border-radius excluded)
  /^\$border-radius-(base|sharp|circle|medium|rounded-pill)$/,
  // Focus color (single value, theme-specific)
  /^\$focus-color$/,
  // Link color primitives
  /^\$link-color$/,
  /^\$link-hover-color$/,
  // Icon sizing (excludes $icon-color which compiles to 'inherit')
  /^\$icon-size-(base|xs|sm|sm2|sm3|md|lg|xl|xxl)$/,
  // Breakpoints
  /^\$(sm|md|lg|xl|xxl)-breakpoint$/,
  // Z-Index scale
  /^\$zindex-/,
];

/** Semantic tokens: purpose-driven color aliases */
const SEMANTIC_PATTERNS: RegExp[] = [
  // Text colors
  /^\$color-text-/,
  // Icon colors
  /^\$color-icon-/,
  // Border colors
  /^\$color-border-/,
  // Background colors (excluding gradients)
  /^\$color-background-(?!gradient)/,
];

// Tokens to explicitly EXCLUDE from CSS custom properties (complex values, maps, internal-only)
const EXCLUDE_PATTERNS: RegExp[] = [
  /^\$state-colors$/,
  /^\$color-semantic$/,
  /^\$screen-sizes$/,
  /^\$shadow$/, // SCSS map — we extract individual shadow values via SYNTHETIC_SHADOW_TOKENS
  /^\$cap-height$/, // Internal SCSS calculation constant, not useful for consumers
  /^\$font-family-icon$/, // Internal webfont name "chi", not a consumer token
  /^\$icon-color$/, // Compiles to 'inherit', useless as a CSS custom property
];

/**
 * Synthetic tokens that don't exist as individual SCSS variables but need
 * to be generated as CSS custom properties. These are extracted from SCSS
 * maps or computed values.
 */
interface SyntheticToken {
  name: string;
  scssExpression: string;
  comment?: string;
  type: string;
  category: string;
}

/** Shadow scale — extracted from $shadow map in _global-variables.scss */
const SYNTHETIC_SHADOW_TOKENS: SyntheticToken[] = [
  { name: 'shadow-0', scssExpression: 'none', comment: 'No shadow', type: 'shadow', category: 'elevation' },
  { name: 'shadow-1', scssExpression: 'map-get($shadow, 1)', comment: 'Elevation 1 — subtle', type: 'shadow', category: 'elevation' },
  { name: 'shadow-2', scssExpression: 'map-get($shadow, 2)', comment: 'Elevation 2 — card', type: 'shadow', category: 'elevation' },
  { name: 'shadow-3', scssExpression: 'map-get($shadow, 3)', comment: 'Elevation 3 — dropdown', type: 'shadow', category: 'elevation' },
  { name: 'shadow-4', scssExpression: 'map-get($shadow, 4)', comment: 'Elevation 4 — modal', type: 'shadow', category: 'elevation' },
  { name: 'shadow-5', scssExpression: 'map-get($shadow, 5)', comment: 'Elevation 5 — max elevation', type: 'shadow', category: 'elevation' },
];

/**
 * Spacing scale — synthesized from Chi's $base-unit (0.5rem = 8px).
 * Scale: 0.25rem increments to 3rem, 0.5rem increments to 4rem, 1rem increments to 24rem.
 * Aligns with Chi's space() utility function (indices 0–10) while extending coverage.
 */
function buildSpacingScale(): SyntheticToken[] {
  const steps: { index: number; rem: number }[] = [];
  let index = 0;

  // 0
  steps.push({ index: index++, rem: 0 });
  // 0.25rem increments up to 3rem
  for (let r = 0.25; r <= 3; r = Math.round((r + 0.25) * 100) / 100) {
    steps.push({ index: index++, rem: r });
  }
  // 0.5rem increments from 3.5 to 4
  for (let r = 3.5; r <= 4; r = Math.round((r + 0.5) * 100) / 100) {
    steps.push({ index: index++, rem: r });
  }
  // 1rem increments from 5 to 24
  for (let r = 5; r <= 24; r++) {
    steps.push({ index: index++, rem: r });
  }

  return steps.map(({ index: i, rem }) => {
    const value = rem === 0 ? '0' : `${rem}rem`;
    const px = rem * 16;
    // Mark Chi space() alignment where applicable
    const chiSpaceIdx = rem % 0.5 === 0 ? rem / 0.5 : null;
    const spaceNote = chiSpaceIdx !== null && chiSpaceIdx >= 0 && chiSpaceIdx <= 10
      ? ` — Chi space(${chiSpaceIdx})`
      : '';
    return {
      name: `spacing-${i}`,
      scssExpression: value,
      comment: `${value}${rem > 0 ? ` (${px}px)` : ''}${spaceNote}`,
      type: 'spacing',
      category: 'spacing',
    };
  });
}

const SYNTHETIC_SPACING_TOKENS: SyntheticToken[] = buildSpacingScale();

/**
 * Border width scale — matches Chi's border utility classes (-b--{0-4}).
 * Values: index / 16 rem = index px.
 */
const SYNTHETIC_BORDER_WIDTH_TOKENS: SyntheticToken[] = [
  { name: 'border-width-0', scssExpression: '0', comment: '0 (0px)', type: 'borderWidth', category: 'border-width' },
  { name: 'border-width-1', scssExpression: '0.0625rem', comment: '0.0625rem (1px) — standard', type: 'borderWidth', category: 'border-width' },
  { name: 'border-width-2', scssExpression: '0.125rem', comment: '0.125rem (2px) — active/emphasis', type: 'borderWidth', category: 'border-width' },
  { name: 'border-width-3', scssExpression: '0.1875rem', comment: '0.1875rem (3px) — heavy (Lumen buttons)', type: 'borderWidth', category: 'border-width' },
  { name: 'border-width-4', scssExpression: '0.25rem', comment: '0.25rem (4px) — max', type: 'borderWidth', category: 'border-width' },
];

/**
 * Transition duration scale — derived from frequency analysis across all Chi components.
 * Names use semantic speed labels rather than indices.
 */
const SYNTHETIC_DURATION_TOKENS: SyntheticToken[] = [
  { name: 'duration-fastest', scssExpression: '0.075s', comment: '0.075s (75ms) — collapse/expand height', type: 'duration', category: 'motion' },
  { name: 'duration-faster', scssExpression: '0.1s', comment: '0.1s (100ms) — hover micro-interactions', type: 'duration', category: 'motion' },
  { name: 'duration-fast', scssExpression: '0.15s', comment: '0.15s (150ms) — input focus, tags', type: 'duration', category: 'motion' },
  { name: 'duration-normal', scssExpression: '0.2s', comment: '0.2s (200ms) — general purpose default', type: 'duration', category: 'motion' },
  { name: 'duration-slow', scssExpression: '0.3s', comment: '0.3s (300ms) — toggle switch, tabs', type: 'duration', category: 'motion' },
  { name: 'duration-slower', scssExpression: '0.4s', comment: '0.4s (400ms) — header search', type: 'duration', category: 'motion' },
  { name: 'duration-slowest', scssExpression: '0.5s', comment: '0.5s (500ms) — modal, drawer, backdrop', type: 'duration', category: 'motion' },
  { name: 'duration-skeleton', scssExpression: '2s', comment: '2s (2000ms) — skeleton loading animation', type: 'duration', category: 'motion' },
];

/**
 * Easing function tokens — the actual easing curves used across Chi components.
 */
const SYNTHETIC_EASING_TOKENS: SyntheticToken[] = [
  { name: 'ease', scssExpression: 'ease', comment: 'Ease — cards, sidenav', type: 'easing', category: 'motion' },
  { name: 'ease-in', scssExpression: 'ease-in', comment: 'Ease-in — buttons, links, carousel', type: 'easing', category: 'motion' },
  { name: 'ease-out', scssExpression: 'ease-out', comment: 'Ease-out — accordion height collapse', type: 'easing', category: 'motion' },
  { name: 'ease-in-out', scssExpression: 'ease-in-out', comment: 'Ease-in-out — general purpose (most common)', type: 'easing', category: 'motion' },
  { name: 'ease-bounce', scssExpression: 'cubic-bezier(1, 0.38, 0, 1.19)', comment: 'Bounce — toggle switch', type: 'easing', category: 'motion' },
];

/** All synthetic token arrays for easy iteration */
const ALL_SYNTHETIC_TOKENS: SyntheticToken[][] = [
  SYNTHETIC_SHADOW_TOKENS,
  SYNTHETIC_SPACING_TOKENS,
  SYNTHETIC_BORDER_WIDTH_TOKENS,
  SYNTHETIC_DURATION_TOKENS,
  SYNTHETIC_EASING_TOKENS,
];

// =============================================================================
// SCSS Parser
// =============================================================================

interface ScssVariable {
  name: string;          // e.g., "font-family-base" (without $)
  rawValue: string;      // e.g., "'Gotham', Arial, Helvetica, Verdana, sans-serif"
  comment?: string;      // inline comment text
  line: number;
  layer: Layer | 'component' | 'excluded';
}

/**
 * Parse simple SCSS variable declarations from a file.
 * Handles single-line `$name: value;` and multi-line values that start with
 * `linear-gradient(` or `(` (maps).
 */
function parseScssVariables(filePath: string): ScssVariable[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const variables: ScssVariable[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Match: $variable-name: value; // optional comment
    const match = line.match(/^\$([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);

    if (match) {
      const name = match[1];
      let rawValuePart = match[2];

      // Check if value continues on next lines (multiline: gradients, maps)
      if (!rawValuePart.includes(';') || (rawValuePart.includes('(') && !rawValuePart.includes(')'))) {
        // Accumulate multiline value
        while (i + 1 < lines.length && !rawValuePart.includes(';')) {
          i++;
          rawValuePart += ' ' + lines[i].trim();
        }
      }

      // Extract value before semicolon
      const semicolonIdx = rawValuePart.lastIndexOf(';');
      let value = semicolonIdx >= 0 ? rawValuePart.slice(0, semicolonIdx).trim() : rawValuePart.trim();

      // Extract inline comment
      let comment: string | undefined;
      const commentMatch = rawValuePart.match(/\/\/\s*(.+?)$/);
      if (commentMatch) {
        comment = commentMatch[1].trim();
        // Remove comment from the raw value ONLY if it's after the semicolon
        // or if the value line includes the comment after the value
        if (value.includes('//')) {
          value = value.split('//')[0].trim();
        }
      }

      // Classify the token
      const layer = classifyToken(`$${name}`, value);

      variables.push({
        name,
        rawValue: value,
        comment,
        line: i + 1,
        layer,
      });
    }
    i++;
  }

  return variables;
}

/**
 * Classify a token into foundation, semantic, component, or excluded.
 */
function classifyToken(fullName: string, value: string): ScssVariable['layer'] {
  // Check exclusions first
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(fullName)) return 'excluded';
  }

  // Skip map values and complex expressions
  if (value.startsWith('(') || value.includes('linear-gradient')) {
    return 'excluded';
  }

  // Check foundation patterns
  for (const pattern of FOUNDATION_PATTERNS) {
    if (pattern.test(fullName)) return 'foundation';
  }

  // Check semantic patterns
  for (const pattern of SEMANTIC_PATTERNS) {
    if (pattern.test(fullName)) return 'semantic';
  }

  // Everything else is component layer (not generated as CSS custom properties)
  return 'component';
}

// =============================================================================
// CSS Custom Property Name Generator
// =============================================================================

/**
 * Convert SCSS variable name to CSS custom property name.
 * $font-family-base → --chi-font-family-base
 * $color-grey-80 → --chi-color-grey-80
 */
function toCssCustomProp(scssName: string): string {
  return `--${PREFIX}-${scssName}`;
}

/**
 * Convert SCSS variable reference to CSS var() if it references another
 * foundation/semantic token, otherwise use #{$var} interpolation.
 */
function toScssInterpolation(scssVarName: string): string {
  return `#{$${scssVarName}}`;
}

// =============================================================================
// SCSS File Generator
// =============================================================================

interface GeneratedOutput {
  scss: string;
  foundationCount: number;
  semanticCount: number;
  totalCount: number;
}

function generateCssVariablesScss(
  themeVars: ScssVariable[],
  globalVars: ScssVariable[],
  theme: Theme,
  layers: readonly Layer[]
): GeneratedOutput {
  const foundationTokens = layers.includes('foundation')
    ? [...globalVars.filter((v) => v.layer === 'foundation'), ...themeVars.filter((v) => v.layer === 'foundation')]
    : [];

  const semanticTokens = layers.includes('semantic') ? themeVars.filter((v) => v.layer === 'semantic') : [];

  // Deduplicate: theme vars override global vars with the same name
  const foundationMap = new Map<string, ScssVariable>();
  for (const v of foundationTokens) {
    foundationMap.set(v.name, v);
  }
  const dedupedFoundation = Array.from(foundationMap.values());

  const syntheticCount = ALL_SYNTHETIC_TOKENS.reduce((sum, arr) => sum + arr.length, 0);
  const foundationCount = dedupedFoundation.length + syntheticCount;
  const semanticCount = semanticTokens.length;
  const totalCount = foundationCount + semanticCount;

  // Build SCSS output
  const lines: string[] = [];

  lines.push(`// =============================================================================`);
  lines.push(`// CSS Custom Properties - ${capitalize(theme)} Theme`);
  lines.push(`// Generated by: scripts/generate-css-custom-properties.ts`);
  lines.push(`// Generated at: ${new Date().toISOString()}`);
  lines.push(`// Total Properties: ${totalCount}`);
  lines.push(`// Foundation: ${foundationCount} | Semantic: ${semanticCount}`);
  lines.push(`// All foundation + semantic tokens at :root (globally accessible)`);
  lines.push(`// Legacy properties under %css-variables / .chi (backward compat)`);
  lines.push(`// =============================================================================`);
  lines.push('');
  lines.push(`@import '_global-variables';`);
  lines.push(`@import '_variables';`);
  lines.push(`@import '_global-mixins';`);
  lines.push(`@import '_mixins';`);
  lines.push('');
  lines.push('// sass-lint:disable-all');
  lines.push('');

  // Foundation Layer - :root scope
  if (dedupedFoundation.length > 0) {
    lines.push(`// =============================================================================`);
    lines.push(`// Foundation Layer - :root scope (universal, not theme-switchable)`);
    lines.push(`// =============================================================================`);
    lines.push(`:root {`);

    // Group foundation tokens by category
    const foundationGroups = groupFoundationTokens(dedupedFoundation);

    for (const [groupName, tokens] of foundationGroups) {
      lines.push(`  // ── ${groupName} ${'─'.repeat(Math.max(0, 60 - groupName.length))}──`);
      for (const token of tokens) {
        const cssName = toCssCustomProp(token.name);
        const scssValue = toScssInterpolation(token.name);
        const comment = token.comment ? ` // ${token.comment}` : '';
        lines.push(`  ${cssName}: ${scssValue};${comment}`);
      }
      lines.push('');
    }

    // ── Synthetic Scales (not from individual SCSS variables) ────────────
    const syntheticScales: { label: string; tokens: SyntheticToken[] }[] = [
      { label: 'Shadow Scale', tokens: SYNTHETIC_SHADOW_TOKENS },
      { label: 'Spacing Scale', tokens: SYNTHETIC_SPACING_TOKENS },
      { label: 'Border Width Scale', tokens: SYNTHETIC_BORDER_WIDTH_TOKENS },
      { label: 'Transition Duration Scale', tokens: SYNTHETIC_DURATION_TOKENS },
      { label: 'Easing Functions', tokens: SYNTHETIC_EASING_TOKENS },
    ];

    for (const scale of syntheticScales) {
      lines.push(`  // ── ${scale.label} ${'─'.repeat(Math.max(0, 60 - scale.label.length))}──`);
      for (const syn of scale.tokens) {
        const cssName = toCssCustomProp(syn.name);
        // Only map-get() and other SCSS functions need interpolation; CSS functions like cubic-bezier don't
        const needsInterpolation = syn.scssExpression.includes('map-get(');
        const value = needsInterpolation ? `#{${syn.scssExpression}}` : syn.scssExpression;
        const comment = syn.comment ? ` // ${syn.comment}` : '';
        lines.push(`  ${cssName}: ${value};${comment}`);
      }
      lines.push('');
    }

    lines.push(`}`);
    lines.push('');
  }

  // Semantic Layer — also at :root (globally accessible)
  if (semanticTokens.length > 0) {
    // If no foundation tokens were emitted, open :root here
    if (dedupedFoundation.length === 0) {
      lines.push(`:root {`);
    } else {
      // Re-open :root — SCSS will merge them into one block at compile time
      lines.push(`// =============================================================================`);
      lines.push(`// Semantic Layer - :root scope (globally accessible, theme-specific values)`);
      lines.push(`// =============================================================================`);
      lines.push(`:root {`);
    }

    // Group semantic tokens by category
    const semanticGroups = groupSemanticTokens(semanticTokens);

    for (const [groupName, tokens] of semanticGroups) {
      lines.push(`  // ── ${groupName} ${'─'.repeat(Math.max(0, 60 - groupName.length))}──`);
      for (const token of tokens) {
        const cssName = toCssCustomProp(token.name);
        const scssValue = toScssInterpolation(token.name);
        const comment = token.comment ? ` // ${token.comment}` : '';
        lines.push(`  ${cssName}: ${scssValue};${comment}`);
      }
      lines.push('');
    }

    lines.push(`}`);
    lines.push('');

    // Legacy custom properties (preserved for backward compatibility under .chi scope)
    lines.push(`// =============================================================================`);
    lines.push(`// Legacy Custom Properties (backward compat — kept under %css-variables / .chi)`);
    lines.push(`// =============================================================================`);
    lines.push(`%css-variables {`);
    lines.push(`  --color-background-primary: #{$color-background-primary};`);
    lines.push(`  --color-background-secondary: #{$color-background-secondary};`);
    lines.push(`  --color-link-cta-icon: #{$link-cta-icon-color};`);
    lines.push(`  --color-marketing-icon-primary: #{$marketing-icon-primary-color};`);
    lines.push(`  --color-marketing-icon-secondary: #{$marketing-icon-secondary-color};`);
    lines.push(`  --color-marketing-icon-tertiary: #{$marketing-icon-tertiary-color};`);
    lines.push(`  --color-marketing-icon-shadow: #{$marketing-icon-shadow-color};`);
    lines.push(`}`);
  }

  lines.push('');

  return {
    scss: lines.join('\n'),
    foundationCount,
    semanticCount,
    totalCount,
  };
}

// =============================================================================
// Token Grouping
// =============================================================================

function groupFoundationTokens(tokens: ScssVariable[]): Map<string, ScssVariable[]> {
  const groups = new Map<string, ScssVariable[]>();
  const order: string[] = [];

  function addToGroup(name: string, token: ScssVariable) {
    if (!groups.has(name)) {
      groups.set(name, []);
      order.push(name);
    }
    groups.get(name)!.push(token);
  }

  for (const token of tokens) {
    const n = token.name;

    if (n.startsWith('font-family-')) addToGroup('Typography - Font Family', token);
    else if (n.match(/^font-size-(3xl|2xl|xl|lg|md|sm|xs|2xs|base)$/)) addToGroup('Typography - Font Size (Text)', token);
    else if (n.match(/^font-size-h\d$/)) addToGroup('Typography - Font Size (Headings)', token);
    else if (n.match(/^font-weight-(light|normal|medium|semi-bold|bold|extra-bold|black|base)$/))
      addToGroup('Typography - Font Weight', token);
    else if (n.match(/^font-weight-h\d$/)) addToGroup('Typography - Font Weight (Headings)', token);
    else if (n.match(/^line-height-(base|xl|lg|md|sm)$/)) addToGroup('Typography - Line Height', token);
    else if (n.match(/^line-height-h\d$/)) addToGroup('Typography - Line Height (Headings)', token);
    else if (n.startsWith('color-grey-')) addToGroup('Colors - Grey Ramp', token);
    else if (n.startsWith('color-red-')) addToGroup('Colors - Red Ramp', token);
    else if (n.startsWith('color-pink-')) addToGroup('Colors - Pink Ramp', token);
    else if (n.startsWith('color-purple-')) addToGroup('Colors - Purple Ramp', token);
    else if (n.startsWith('color-indigo-')) addToGroup('Colors - Indigo Ramp', token);
    else if (n.startsWith('color-navy-')) addToGroup('Colors - Navy Ramp', token);
    else if (n.startsWith('color-bright-blue-')) addToGroup('Colors - Bright Blue Ramp', token);
    else if (n.startsWith('color-blue-')) addToGroup('Colors - Blue Ramp', token);
    else if (n.startsWith('color-cyan-')) addToGroup('Colors - Cyan Ramp', token);
    else if (n.startsWith('color-teal-blue-')) addToGroup('Colors - Teal Blue Ramp', token);
    else if (n.startsWith('color-teal-')) addToGroup('Colors - Teal Ramp', token);
    else if (n.startsWith('color-mint-')) addToGroup('Colors - Mint Ramp', token);
    else if (n.startsWith('color-green-')) addToGroup('Colors - Green Ramp', token);
    else if (n.startsWith('color-yellow-')) addToGroup('Colors - Yellow Ramp', token);
    else if (n.startsWith('color-orange-')) addToGroup('Colors - Orange Ramp', token);
    else if (n === 'color-black' || n === 'color-white') addToGroup('Colors - Black & White', token);
    else if (n === 'base-unit') addToGroup('Base Unit', token);
    else if (n.startsWith('opacity-')) addToGroup('Opacity Scale', token);
    else if (n.startsWith('border-radius')) addToGroup('Border Radius', token);
    else if (n.startsWith('focus-')) addToGroup('Focus', token);
    else if (n.startsWith('link-')) addToGroup('Link', token);
    else if (n.startsWith('icon-size-')) addToGroup('Icon Sizing', token);
    else if (n.match(/-breakpoint$/)) addToGroup('Breakpoints', token);
    else if (n.startsWith('zindex-')) addToGroup('Z-Index Scale', token);
    else addToGroup('Other Foundation', token);
  }

  // Return in defined order (insertion order from SCSS files)
  const result = new Map<string, ScssVariable[]>();
  for (const key of order) {
    result.set(key, groups.get(key)!);
  }
  return result;
}

function groupSemanticTokens(tokens: ScssVariable[]): Map<string, ScssVariable[]> {
  const groups = new Map<string, ScssVariable[]>();
  const order: string[] = [];

  function addToGroup(name: string, token: ScssVariable) {
    if (!groups.has(name)) {
      groups.set(name, []);
      order.push(name);
    }
    groups.get(name)!.push(token);
  }

  for (const token of tokens) {
    const n = token.name;

    if (n.startsWith('color-text-')) addToGroup('Text Colors', token);
    else if (n.startsWith('color-icon-')) addToGroup('Icon Colors', token);
    else if (n.startsWith('color-border-')) addToGroup('Border Colors', token);
    else if (n.startsWith('color-background-')) addToGroup('Background Colors', token);
    else addToGroup('Other Semantic', token);
  }

  const result = new Map<string, ScssVariable[]>();
  for (const key of order) {
    result.set(key, groups.get(key)!);
  }
  return result;
}

// =============================================================================
// JSON Metadata Generator
// =============================================================================

interface TokenMetadata {
  theme: string;
  version: string;
  generatedAt: string;
  tokenCount: {
    foundation: number;
    semantic: number;
    component: number;
    total: number;
    cssCustomProperties: number;
  };
  tokens: {
    foundation: Record<string, TokenEntry>;
    semantic: Record<string, TokenEntry>;
  };
}

interface TokenEntry {
  scssVariable: string;
  cssVariable: string;
  rawValue: string;
  resolvedValue: string;
  type: string;
  category: string;
  comment?: string;
}

// =============================================================================
// SCSS Compiler — resolves CSS custom property values
// =============================================================================

/**
 * Compile the generated SCSS file for a theme and extract all resolved
 * CSS custom property values from the compiled CSS output.
 *
 * All foundation and semantic tokens are emitted under :root, so a simple
 * compile of the generated file is sufficient to resolve all values.
 *
 * Returns a Map of `--chi-*` property name → resolved CSS value.
 */
function resolveTokenValues(theme: Theme): Map<string, string> {
  const resolved = new Map<string, string>();
  const themeDir = path.join(THEMES_DIR, theme);
  const scssPath = path.join(themeDir, 'css-variables.scss');

  try {
    const result = sass.compile(scssPath, {
      loadPaths: [SRC_ROOT, themeDir],
      style: 'expanded',
      silenceDeprecations: ['import' as any, 'global-builtin' as any],
    });

    // Parse CSS output — extract all custom property declarations
    // Matches lines like:  --chi-color-text-base: #000000;
    const CSS_PROP_RE = /^\s*(--chi-[a-z0-9-]+)\s*:\s*(.+?)\s*;/gm;
    let match: RegExpExecArray | null;

    while ((match = CSS_PROP_RE.exec(result.css)) !== null) {
      resolved.set(match[1], match[2]);
    }
  } catch (err) {
    console.warn(`     ⚠ Failed to resolve values for ${theme}:`, (err as Error).message);
  }

  return resolved;
}

/**
 * Merge resolved CSS values into token entries.
 */
function applyResolvedValues(
  entries: Record<string, TokenEntry>,
  resolvedMap: Map<string, string>
): void {
  for (const [, entry] of Object.entries(entries)) {
    const resolved = resolvedMap.get(entry.cssVariable);
    if (resolved) {
      entry.resolvedValue = resolved;
    }
  }
}

// =============================================================================
// JSON Metadata
// =============================================================================

function generateTokenMetadata(
  themeVars: ScssVariable[],
  globalVars: ScssVariable[],
  theme: Theme,
  generatedOutput: GeneratedOutput
): TokenMetadata {
  const allFoundation = [
    ...globalVars.filter((v) => v.layer === 'foundation'),
    ...themeVars.filter((v) => v.layer === 'foundation'),
  ];
  const foundationMap = new Map<string, ScssVariable>();
  for (const v of allFoundation) {
    foundationMap.set(v.name, v);
  }
  const dedupedFoundation = Array.from(foundationMap.values());

  const semanticTokens = themeVars.filter((v) => v.layer === 'semantic');
  const componentCount = themeVars.filter((v) => v.layer === 'component').length;

  const foundationEntries: Record<string, TokenEntry> = {};
  for (const token of dedupedFoundation) {
    foundationEntries[token.name] = {
      scssVariable: `$${token.name}`,
      cssVariable: toCssCustomProp(token.name),
      rawValue: token.rawValue,
      resolvedValue: '',
      type: inferTokenType(token.name, token.rawValue),
      category: inferCategory(token.name),
      ...(token.comment ? { comment: token.comment } : {}),
    };
  }

  // Include ALL synthetic tokens in foundation metadata
  for (const synArr of ALL_SYNTHETIC_TOKENS) {
    for (const syn of synArr) {
      foundationEntries[syn.name] = {
        scssVariable: syn.scssExpression.includes('map-get')
          ? `map-get($shadow, ${syn.name.replace('shadow-', '')})`
          : syn.scssExpression,
        cssVariable: toCssCustomProp(syn.name),
        rawValue: syn.scssExpression,
        resolvedValue: '',
        type: inferTokenType(syn.name, syn.scssExpression),
        category: inferCategory(syn.name),
        ...(syn.comment ? { comment: syn.comment } : {}),
      };
    }
  }

  const semanticEntries: Record<string, TokenEntry> = {};
  for (const token of semanticTokens) {
    semanticEntries[token.name] = {
      scssVariable: `$${token.name}`,
      cssVariable: toCssCustomProp(token.name),
      rawValue: token.rawValue,
      resolvedValue: '',
      type: inferTokenType(token.name, token.rawValue),
      category: inferCategory(token.name),
      ...(token.comment ? { comment: token.comment } : {}),
    };
  }

  return {
    theme,
    version: '7.0.0',
    generatedAt: new Date().toISOString(),
    tokenCount: {
      foundation: generatedOutput.foundationCount,
      semantic: generatedOutput.semanticCount,
      component: componentCount,
      total: generatedOutput.foundationCount + generatedOutput.semanticCount + componentCount,
      cssCustomProperties: generatedOutput.totalCount,
    },
    tokens: {
      foundation: foundationEntries,
      semantic: semanticEntries,
    },
  };
}

function inferTokenType(name: string, value: string): string {
  if (name.startsWith('color-') || name.startsWith('focus-color')) return 'color';
  if (name.startsWith('font-family-')) return 'fontFamily';
  if (name.startsWith('font-size-')) return 'fontSize';
  if (name.startsWith('font-weight-')) return 'fontWeight';
  if (name.startsWith('line-height')) return 'lineHeight';
  if (name.startsWith('opacity-')) return 'opacity';
  if (name.startsWith('border-radius')) return 'borderRadius';
  if (name.startsWith('border-width-')) return 'borderWidth';
  if (name.startsWith('icon-size-')) return 'size';
  if (name === 'base-unit') return 'dimension';
  if (name.startsWith('link-')) return 'color';
  if (name.startsWith('shadow-')) return 'shadow';
  if (name.startsWith('spacing-')) return 'spacing';
  if (name.startsWith('duration-')) return 'duration';
  if (name.startsWith('ease')) return 'easing';
  if (name.match(/-breakpoint$/)) return 'breakpoint';
  if (name.startsWith('zindex-')) return 'zIndex';
  return 'other';
}

function inferCategory(name: string): string {
  if (name.startsWith('font-') || name.startsWith('line-height')) return 'typography';
  if (name.startsWith('color-text-')) return 'text-colors';
  if (name.startsWith('color-icon-')) return 'icon-colors';
  if (name.startsWith('color-border-')) return 'border-colors';
  if (name.startsWith('color-background-')) return 'background-colors';
  if (name.startsWith('color-')) return 'color-palette';
  if (name.startsWith('opacity-')) return 'opacity';
  if (name.startsWith('border-radius')) return 'border-radius';
  if (name.startsWith('border-width-')) return 'border-width';
  if (name.startsWith('icon-size')) return 'icon-sizing';
  if (name.startsWith('focus-') || name.startsWith('link-')) return 'interactive';
  if (name === 'base-unit') return 'spacing';
  if (name.startsWith('spacing-')) return 'spacing';
  if (name.startsWith('shadow-')) return 'elevation';
  if (name.startsWith('duration-') || name.startsWith('ease')) return 'motion';
  if (name.match(/-breakpoint$/)) return 'breakpoints';
  if (name.startsWith('zindex-')) return 'z-index';
  return 'other';
}

// =============================================================================
// Utilities
// =============================================================================

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(): { themes: Theme[]; layers: Layer[]; jsonOnly: boolean; dryRun: boolean } {
  const args = process.argv.slice(2);
  let themes = [...THEMES] as Theme[];
  let layers = [...LAYERS] as Layer[];
  let jsonOnly = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--theme=')) {
      const t = arg.split('=')[1] as Theme;
      if (THEMES.includes(t)) {
        themes = [t];
      } else {
        console.error(`Unknown theme: ${t}. Available: ${THEMES.join(', ')}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--layers=')) {
      const layerArg = arg.split('=')[1].split(',') as Layer[];
      layers = layerArg.filter((l) => LAYERS.includes(l));
    } else if (arg === '--json-only') {
      jsonOnly = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
CSS Custom Properties Generator for Chi Design System
======================================================

Usage:
  tsx scripts/generate-css-custom-properties.ts [options]

Options:
  --theme=<name>           Generate for a single theme (default: all)
  --layers=foundation,semantic  Token layers to include (default: foundation,semantic)
  --json-only             Only generate JSON metadata, skip SCSS
  --dry-run               Print output to stdout instead of writing files
  --help, -h              Show this help message

Themes: ${THEMES.join(', ')}
Layers: ${LAYERS.join(', ')}
`);
      process.exit(0);
    }
  }

  return { themes, layers, jsonOnly, dryRun };
}

async function main() {
  const { themes, layers, jsonOnly, dryRun } = parseArgs();

  console.log(`\n🎨 Chi CSS Custom Properties Generator`);
  console.log(`   Themes: ${themes.join(', ')}`);
  console.log(`   Layers: ${layers.join(', ')}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : jsonOnly ? 'JSON ONLY' : 'FULL'}\n`);

  // Parse global variables (shared across all themes)
  const globalVars = parseScssVariables(GLOBAL_VARS_FILE);
  console.log(`   Global variables parsed: ${globalVars.length}`);
  console.log(`     Foundation: ${globalVars.filter((v) => v.layer === 'foundation').length}`);
  console.log('');

  const summaries: { theme: string; foundation: number; semantic: number; total: number }[] = [];

  for (const theme of themes) {
    const varsFile = path.join(THEMES_DIR, theme, '_variables.scss');

    if (!fs.existsSync(varsFile)) {
      console.warn(`   ⚠ Theme "${theme}" variables file not found: ${varsFile}`);
      continue;
    }

    console.log(`   Processing: ${theme}`);

    // Parse theme variables
    const themeVars = parseScssVariables(varsFile);
    console.log(`     Variables parsed: ${themeVars.length}`);
    console.log(
      `     Foundation: ${themeVars.filter((v) => v.layer === 'foundation').length} | Semantic: ${
        themeVars.filter((v) => v.layer === 'semantic').length
      } | Component: ${themeVars.filter((v) => v.layer === 'component').length}`
    );

    // Generate SCSS
    const output = generateCssVariablesScss(themeVars, globalVars, theme, layers);

    // Generate JSON metadata
    const metadata = generateTokenMetadata(themeVars, globalVars, theme, output);

    summaries.push({
      theme,
      foundation: output.foundationCount,
      semantic: output.semanticCount,
      total: output.totalCount,
    });

    if (dryRun) {
      console.log(`\n--- ${theme}/css-variables.scss (${output.totalCount} properties) ---`);
      console.log(output.scss);
      console.log(`\n--- dist/tokens/${theme}.json ---`);
      console.log(JSON.stringify(metadata, null, 2).slice(0, 500) + '\n...(truncated)');
    } else {
      // Write SCSS file
      if (!jsonOnly) {
        const scssPath = path.join(THEMES_DIR, theme, 'css-variables.scss');
        fs.writeFileSync(scssPath, output.scss, 'utf-8');
        console.log(`     ✅ Written: ${path.relative(process.cwd(), scssPath)}`);
      }

      // Resolve compiled CSS values by compiling the generated SCSS
      const resolvedMap = resolveTokenValues(theme);
      if (resolvedMap.size > 0) {
        applyResolvedValues(metadata.tokens.foundation, resolvedMap);
        applyResolvedValues(metadata.tokens.semantic, resolvedMap);
        console.log(`     🔍 Resolved ${resolvedMap.size} CSS values`);
      }

      // Write JSON metadata
      fs.mkdirSync(DIST_TOKENS_DIR, { recursive: true });
      const jsonPath = path.join(DIST_TOKENS_DIR, `${theme}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
      console.log(`     ✅ Written: ${path.relative(process.cwd(), jsonPath)}`);
    }
    console.log('');
  }

  // Print summary table
  console.log(`\n📊 Summary`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`${'Theme'.padEnd(15)} ${'Foundation'.padEnd(12)} ${'Semantic'.padEnd(12)} ${'Total'.padEnd(8)}`);
  console.log(`${'─'.repeat(60)}`);
  for (const s of summaries) {
    console.log(
      `${s.theme.padEnd(15)} ${String(s.foundation).padEnd(12)} ${String(s.semantic).padEnd(12)} ${String(
        s.total
      ).padEnd(8)}`
    );
  }
  console.log(`${'─'.repeat(60)}`);

  if (!dryRun && themes.length === THEMES.length) {
    // Generate consolidated all-themes.json
    const allThemesPath = path.join(DIST_TOKENS_DIR, 'all-themes.json');
    const allThemes: Record<string, TokenMetadata> = {};
    for (const theme of themes) {
      const jsonPath = path.join(DIST_TOKENS_DIR, `${theme}.json`);
      if (fs.existsSync(jsonPath)) {
        allThemes[theme] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      }
    }
    fs.writeFileSync(allThemesPath, JSON.stringify(allThemes, null, 2), 'utf-8');
    console.log(`\n✅ Consolidated: dist/tokens/all-themes.json`);

    // Auto-sync to documentation repo if it exists as a sibling directory
    const DOCS_REPOS = ['matt-chi-documentation', 'chi-documentation'];
    for (const docsDir of DOCS_REPOS) {
      const docsTokensDir = path.resolve(import.meta.dirname, '..', '..', docsDir, 'public', 'tokens');
      if (fs.existsSync(path.resolve(import.meta.dirname, '..', '..', docsDir))) {
        fs.mkdirSync(docsTokensDir, { recursive: true });
        for (const file of fs.readdirSync(DIST_TOKENS_DIR)) {
          fs.copyFileSync(
            path.join(DIST_TOKENS_DIR, file),
            path.join(docsTokensDir, file)
          );
        }
        console.log(`📋 Synced tokens → ../${docsDir}/public/tokens/`);
      }
    }
  }

  console.log(`\n✨ Done!\n`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
