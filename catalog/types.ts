import type { GooseInteract } from '../context'
import type { GooseElement, GooseHL } from '../renderer'

/* ------------------------------------------------------------------ *
 * GooseDest — faithful port of GooseDest.kt
 * ------------------------------------------------------------------ */
export enum GooseDest {
  Buttons,
  Toggle,
  SingleToggle,
  Slider,
  SingleSlider,
  BottomTabs,
  SingleBottomTabs,
  ToggleCard,
  SliderCard,
  BottomTabs2,
  Dialog,
  Magnifier,
  ScrollContainer,
  LazyScrollContainer,
  Rating,
  RingProgress,
  SiriWave,
}

/* ------------------------------------------------------------------ *
 * Shared constants — matching the Kotlin dp values (CSS px ≈ Android
 * dp at density 1).
 * ------------------------------------------------------------------ */
export const gooseDP = 1
// Track which toggle groups are being dragged — gooseTglTarget is skipped
// for these (in context.tsx) to avoid drift during liveUpdate.
export const gooseDragGroups = new Set<string>()
/** Linear interpolation. Faithful to androidx.compose.ui.util.gooseLerp. */
export function gooseLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// --- Gravity angle (gyroscope/accelerometer) for highlight direction ---
// Faithful to UISensor.kt: gravityAngle = atan2(y, x) * 180/PI, default 45°.
// On web, approximated via DeviceOrientationEvent (beta/gamma → gravity
// vector → angle). Passed in as a prop from page.tsx (React state) so
// changes trigger a catalog rebuild → real-time highlight rotation.
let gravityAngle = 45
export function gooseGravAngle(a: number) { gravityAngle = a; }
function getGravityAngle() { return gravityAngle; }

export const gooseBtnH = 48 * gooseDP
export const gooseBtnPad = 16 * gooseDP
export const gooseTextSz = 15 * gooseDP

export const gooseFont =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

// Glass params matching LiquidButton.kt's effects block.
export const gooseGlassP = {
  refractionHeight: 12 * gooseDP,
  refractionAmount: -24 * gooseDP,
  depthEffect: false,
  chromaticAberration: false,
  blurRadius: 2 * gooseDP,
  saturation: 1.5,
  brightness: 0,
  contrast: 1,
}

export const gooseHL: GooseHL = {
  mode: 0,
  color: [1, 1, 1],
  angle: 45 * Math.PI / 180,
  falloff: 1.0,
  alpha: 1.0,
  widthDp: 0.5,
}

export const gooseShadow = {
  radius: 24 * gooseDP,
  alpha: 0.1,
  offsetX: 0,
  offsetY: (24 / 6) * gooseDP,
  color: [0, 0, 0] as [number, number, number],
}

/* ------------------------------------------------------------------ *
 * Theme-aware color palettes — faithful to the Kotlin source's
 * `isLightTheme = !isSystemInDarkTheme()` pattern.
 *
 * Each destination's Kotlin file declares its own per-theme colors.
 * We mirror them here as a single palette object so each builder
 * picks the right colors via `palette = goosePalette(isLightTheme)`.
 * ------------------------------------------------------------------ */

export interface GoosePalette {
  // HomeContent.kt
  homeContentColor: [number, number, number, number]
  homeSubtitleColor: [number, number, number, number]
  homeTextHalo: 'light' | 'dark' | 'none'

  // ToggleContent.kt + LiquidToggle.kt
  toggleAccent: [number, number, number]
  toggleTrackOff: [number, number, number, number]
  toggleCardBg: [number, number, number, number]

  // SliderContent.kt + LiquidSlider.kt
  sliderAccent: [number, number, number]
  sliderTrackOff: [number, number, number, number]
  sliderCardBg: [number, number, number, number]

  // BottomTabsContent.kt + LiquidBottomTabs.kt
  tabsContentColor: [number, number, number, number]
  tabsAccent: [number, number, number]
  tabsContainer: [number, number, number, number]
  tabsTextHalo: 'light' | 'dark' | 'none'

  // DialogContent.kt
  dialogContentColor: [number, number, number, number]
  dialogAccent: [number, number, number, number]
  dialogContainer: [number, number, number, number]
  dialogDim: [number, number, number, number]
  dialogBlurRadius: number
  dialogBrightness: number

  // MagnifierContent.kt
  magnifierContentColor: [number, number, number, number]
  magnifierAccent: [number, number, number, number]
  magnifierCardBg: [number, number, number, number]

  // ControlCenterContent.kt
  controlCenterAccent: [number, number, number, number]

  // ProgressiveBlurContent.kt
  progressiveContentColor: [number, number, number, number]
  progressiveTint: [number, number, number, number]
  progressiveTextHalo: 'light' | 'dark' | 'none'

  // AdaptiveLuminanceGlassContent.kt (initial contentColor; the actual
  // behavior is adaptive but we need a starting color)
  adaptiveContentColor: [number, number, number, number]

  // Back button icon color — black on light, white on dark.
  backIconColor: [number, number, number, number]

  // Back/theme button glass surface color — mirrors tabsContainer
  // (white 0.3 in light, dark 0.4 in dark) so the circular buttons
  // match the bottom-tabs container in each theme.
  buttonSurface: [number, number, number, number]
}

export const gooseLight: GoosePalette = {
  homeContentColor: [0, 0, 0, 1],
  homeSubtitleColor: [0x00 / 255, 0x88 / 255, 0xff / 255, 1],
  homeTextHalo: 'dark',

  toggleAccent: [0x34 / 255, 0xc7 / 255, 0x59 / 255],
  toggleTrackOff: [0x78 / 255, 0x78 / 255, 0x78 / 255, 0.2],
  toggleCardBg: [1, 1, 1, 1],

  sliderAccent: [0x00 / 255, 0x88 / 255, 0xff / 255],
  sliderTrackOff: [0x78 / 255, 0x78 / 255, 0x78 / 255, 0.2],
  sliderCardBg: [1, 1, 1, 1],

  tabsContentColor: [0, 0, 0, 1],
  tabsAccent: [0x00 / 255, 0x88 / 255, 0xff / 255],
  tabsContainer: [0xfa / 255, 0xfa / 255, 0xfa / 255, 0.4],
  tabsTextHalo: 'dark',

  dialogContentColor: [0, 0, 0, 1],
  dialogAccent: [0x00 / 255, 0x88 / 255, 0xff / 255, 1],
  dialogContainer: [0xfa / 255, 0xfa / 255, 0xfa / 255, 0.6],
  dialogDim: [0x29 / 255, 0x29 / 255, 0x3a / 255, 0.23],
  dialogBlurRadius: 16 * gooseDP,
  dialogBrightness: 0.2,

  magnifierContentColor: [0, 0, 0, 1],
  magnifierAccent: [0x00 / 255, 0x88 / 255, 0xff / 255, 1],
  magnifierCardBg: [1, 1, 1, 0.9],

  controlCenterAccent: [0x00 / 255, 0x88 / 255, 0xff / 255, 1],

  progressiveContentColor: [0, 0, 0, 1],
  progressiveTint: [1, 1, 1, 1],
  progressiveTextHalo: 'dark',

  adaptiveContentColor: [0, 0, 0, 1],

  backIconColor: [0, 0, 0, 1],
  buttonSurface: [1, 1, 1, 0.3],
}

export const gooseDark: GoosePalette = {
  homeContentColor: [1, 1, 1, 1],
  homeSubtitleColor: [0x00 / 255, 0x88 / 255, 0xff / 255, 1],
  homeTextHalo: 'light',

  toggleAccent: [0x30 / 255, 0xd1 / 255, 0x58 / 255],
  toggleTrackOff: [0x78 / 255, 0x78 / 255, 0x80 / 255, 0.36],
  toggleCardBg: [0x12 / 255, 0x12 / 255, 0x12 / 255, 1],

  sliderAccent: [0x00 / 255, 0x91 / 255, 0xff / 255],
  sliderTrackOff: [0x78 / 255, 0x78 / 255, 0x80 / 255, 0.36],
  sliderCardBg: [0x12 / 255, 0x12 / 255, 0x12 / 255, 1],

  tabsContentColor: [1, 1, 1, 1],
  tabsAccent: [0x00 / 255, 0x91 / 255, 0xff / 255],
  tabsContainer: [0x12 / 255, 0x12 / 255, 0x12 / 255, 0.4],
  tabsTextHalo: 'light',

  dialogContentColor: [1, 1, 1, 1],
  dialogAccent: [0x00 / 255, 0x91 / 255, 0xff / 255, 1],
  dialogContainer: [0x12 / 255, 0x12 / 255, 0x12 / 255, 0.4],
  dialogDim: [0x12 / 255, 0x12 / 255, 0x12 / 255, 0.56],
  dialogBlurRadius: 8 * gooseDP,
  dialogBrightness: 0,

  magnifierContentColor: [1, 1, 1, 1],
  magnifierAccent: [0x00 / 255, 0x91 / 255, 0xff / 255, 1],
  magnifierCardBg: [0x12 / 255, 0x12 / 255, 0x12 / 255, 0.9],

  controlCenterAccent: [0x00 / 255, 0x91 / 255, 0xff / 255, 1],

  progressiveContentColor: [1, 1, 1, 1],
  progressiveTint: [0x80 / 255, 0x80 / 255, 0x80 / 255, 1],
  progressiveTextHalo: 'light',

  adaptiveContentColor: [1, 1, 1, 1],

  backIconColor: [1, 1, 1, 1],
  buttonSurface: [0x12 / 255, 0x12 / 255, 0x12 / 255, 0.4],
}

export function goosePalette(isLightTheme: boolean): GoosePalette {
  return isLightTheme ? gooseLight : gooseDark
}

export const gooseLorem =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'

// Flight icon SVG path (960×960 viewport) — faithful port of FlightIcon.kt.
// Original is a Compose ImageVector with mixed absolute/relative commands.
export const gooseFlight =
  'M400 552 L147 653 q-24 10 -45.5 -4.5 T80 608 v-22 q0 -12 5.5 -23 t15.5 -18 l299 -209 v-176 q0 -33 23.5 -56.5 T480 80 q33 0 56.5 23.5 T560 160 v176 l299 209 q10 7 15.5 18 t5.5 23 v22 q0 26 -21.5 40.5 T813 653 L560 552 v144 l103 72 q8 6 12.5 14.5 T680 801 v24 q0 20 -16.5 32.5 T627 864 l-147 -44 l-147 44 q-20 6 -36.5 -6.5 T280 825 v-24 q0 -10 4.5 -18.5 T297 768 l103 -72 v-144 Z'

/* ------------------------------------------------------------------ *
 * Catalog result type — returned by each destination builder.
 * ------------------------------------------------------------------ */
export interface GooseResult {
  elements: GooseElement[]
  interactions: Record<string, GooseInteract>
  contentHeight: number
  /** Live state hooks — the page calls these to push interactive state
   *  (toggle / slider / tab values) into the elements list each frame.
   *  The builder returns a function that, given the current state,
   *  returns a fresh elements array. */
  stateful?: (state: GooseState) => {
    elements: GooseElement[]
    interactions: Record<string, GooseInteract>
  }
}

export interface GooseState {
  toggleOn: boolean
  sliderValue: number
  selectedTab: number
  selectedTab2: number
  // Magnifier
  magnifierX: number
  magnifierY: number
  // Settings — hide the overlay exit (back) and theme toggle buttons on all
  // pages. Default false (buttons visible). When true, the back button is
  // still reachable via the browser back button / Esc.
  hideOverlayButtons: boolean
  // Rating — number of selected stars (0-5)
  ratingValue: number
  // Ring progress — progress value (0-100)
  ringProgressValue: number
  // Settings — global separable 2-pass blur toggle
  globalSeparableBlur: boolean
  // Settings — corner style: true = continuous (squircle, faithful to original
  // Capsule's ContinuousCurvature), false = circular (standard arc).
  capsuleShape: boolean
}

export const gooseDefState: GooseState = {
  toggleOn: false,
  sliderValue: 50,
  selectedTab: 0,
  selectedTab2: 0,
  magnifierX: 0,
  magnifierY: 0,
  globalSeparableBlur: true,
  capsuleShape: true,
  hideOverlayButtons: false,
  ratingValue: 0,
  ringProgressValue: 50,
}

/* ------------------------------------------------------------------ *
 * Text-measurement helper (hidden 2D canvas).
 * ------------------------------------------------------------------ */
let _measureCtx: CanvasRenderingContext2D | null = null
export function gooseTextW(text: string, fontPx: number, weight = 400): number {
  if (typeof document !== 'undefined') {
    if (!_measureCtx) {
      const c = document.createElement('canvas')
      _measureCtx = c.getContext('2d')
    }
    if (_measureCtx) {
      _measureCtx.font = `${weight} ${fontPx}px ${gooseFont}`
      return _measureCtx.measureText(text).width
    }
  }
  return text.length * fontPx * 0.55
}

/* ------------------------------------------------------------------ *
 * Shared slider dimensions — used by gooseSlider, makeSettingsSlider,
 * and the Slider / GlassPlayground / Settings builder functions.
 * ------------------------------------------------------------------ */
export const gooseTrackH = 6 * gooseDP
export const gooseKnobW = 40 * gooseDP
export const gooseKnobH = 24 * gooseDP
export const gooseHitH = 48 * gooseDP
