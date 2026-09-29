/**
 * Implementation versions recorded next to delivered charts (ADR-0008 decision 9).
 * Independent of the ChartSpec contract `version` and of package.json.
 */

/** Bump when the option compiled from the same spec and dataset changes. */
export const CHART_COMPILER_VERSION = 2;

/** Bump when palette, fonts or spacing change, including the static font stack and background in the runtime renderer. */
export const CHART_THEME_VERSION = 1;

export interface ChartRendererVersions {
  readonly compiler: number;
  readonly theme: number;
}

export const CHART_RENDERER_VERSIONS: ChartRendererVersions = { compiler: CHART_COMPILER_VERSION, theme: CHART_THEME_VERSION };
