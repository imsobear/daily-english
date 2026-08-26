/**
 * iPhone launch screens for the installed app.
 *
 * Without an `apple-touch-startup-image` iOS shows a blank white rectangle
 * between tapping the home screen icon and the first paint, which is the most
 * obviously non-native moment in the whole experience. iOS only accepts an
 * image whose media query matches the device exactly, so every screen size has
 * to be listed and pre-rendered.
 *
 * Sizes are CSS pixels plus device pixel ratio. Kept free of imports so
 * `scripts/icons.mjs` can load this file directly.
 */
export type LaunchScreen = {
  width: number
  height: number
  ratio: number
}

export const LAUNCH_SCREENS: LaunchScreen[] = [
  { width: 320, height: 568, ratio: 2 }, // SE (1st gen)
  { width: 375, height: 667, ratio: 2 }, // SE (2nd/3rd gen), 8
  { width: 414, height: 736, ratio: 3 }, // 8 Plus
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12/13 mini
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 16e
  { width: 428, height: 926, ratio: 3 }, // 12/13 Pro Max, 14 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 16
  { width: 430, height: 932, ratio: 3 }, // 15 Pro Max, 16 Plus
  { width: 402, height: 874, ratio: 3 }, // 16 Pro
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max
]

export type ColorScheme = 'light' | 'dark'

/** Page background at first paint, matched to `--page` in styles.css. */
export const LAUNCH_BACKGROUND: Record<ColorScheme, string> = {
  light: '#fff8f2',
  dark: '#16120f',
}

export function launchScreenFile(screen: LaunchScreen, scheme: ColorScheme) {
  return `/icons/launch-${screen.width}x${screen.height}@${screen.ratio}x-${scheme}.png`
}

export function launchScreenMedia(screen: LaunchScreen, scheme: ColorScheme) {
  return [
    `(device-width: ${screen.width}px)`,
    `(device-height: ${screen.height}px)`,
    `(-webkit-device-pixel-ratio: ${screen.ratio})`,
    `(orientation: portrait)`,
    `(prefers-color-scheme: ${scheme})`,
  ].join(' and ')
}
