'use client'

import * as React from 'react'
import type { LiquidGlassRenderer } from '../renderer'
import {
  GooseDest,
  gooseDefState,
  gooseDP,
  goosePalette,
  type GooseResult,
  type GooseState,
  type GoosePalette,
  gooseTextW,
  gooseGravAngle,
  gooseDragGroups,
} from './types'
import { gooseBtn, gooseThemeBtn } from './helpers'
import { buildButtons } from './build-buttons'
import { buildToggle } from './build-toggle'
import { buildSlider } from './build-slider'
import { buildBottomTabs } from './build-bottom-tabs'
import { buildDialog } from './build-dialog'
import { buildMagnifier } from './build-magnifier'
import { buildScrollContainer } from './build-scroll-container'
import { buildRating } from './build-rating'
import { buildRingProgress } from './build-ring-progress'
import { buildSiriWave } from './build-siri-wave'

// Re-export public API (preserving the original catalog.tsx surface).
export {
  GooseDest,
  gooseDefState,
  type GooseState,
  type GooseResult,
  type GoosePalette,
  gooseGravAngle,
  gooseDragGroups,
}

/* ------------------------------------------------------------------ *
 * Main entry — dispatches to the right builder.
 *
 * `isLightTheme` is forwarded as a `GoosePalette` to each builder so
 * they can pick the correct per-destination colors (faithful to each
 * *Content.kt file's `isLightTheme = !isSystemInDarkTheme()` check).
 *
 * `onToggleTheme` is wired into a canvas-rendered theme toggle button
 * (top-right, 56dp, mirrored from the back button) that is added to
 * EVERY destination's element list. Per user request: "把这个按钮也弄成
 * canvas里面的，和退出按钮等大对称".
 * ------------------------------------------------------------------ */
export function gooseBuild(
  dest: GooseDest,
  W: number,
  H: number,
  state: GooseState,
  setState: (patch: Partial<GooseState> | ((prev: GooseState) => Partial<GooseState>)) => void,
  onNavigate: (d: GooseDest) => void,
  onBack: () => void,
  rendererRef?: React.MutableRefObject<LiquidGlassRenderer | null>,
  isLightTheme: boolean = true,
  onToggleTheme?: () => void,
  onButtonTap?: (id: string) => void,
  tabsConfig?: Array<Array<{ icon: string; label: string; viewport?: number }>>,
  buttonsConfig?: Array<{ id?: string; label?: string; style?: any }>,
  dialogConfig?: { title?: string; body?: string; cancelText?: string; okayText?: string },
  onDialogTap?: (action: 'cancel' | 'okay') => void,
  scrollConfig?: Array<{ title: string; subtitle?: string; link?: { text: string; href?: string } }>,
  onLinkTap?: (itemIndex: number, href?: string) => void
): GooseResult {
  const palette = goosePalette(isLightTheme)
  let result: GooseResult
  switch (dest) {
    case GooseDest.Buttons:
      result = buildButtons(W, H, onBack, palette, onButtonTap, buttonsConfig)
      break
    case GooseDest.Toggle:
      result = buildToggle(W, H, onBack, state, setState, rendererRef, palette)
      break
    case GooseDest.Slider:
      result = buildSlider(W, H, onBack, state, setState, rendererRef, palette)
      break
    case GooseDest.SingleSlider:
      result = buildSlider(W, H, onBack, state, setState, rendererRef, palette, true)
      break
    case GooseDest.SingleToggle:
      result = buildToggle(W, H, onBack, state, setState, rendererRef, palette, true)
      break
    case GooseDest.SingleBottomTabs:
      result = buildBottomTabs(W, H, onBack, state, setState, rendererRef, palette, tabsConfig, true)
      break
    case GooseDest.ToggleCard:
      result = buildToggle(W, H, onBack, state, setState, rendererRef, palette, true, true)
      break
    case GooseDest.SliderCard:
      result = buildSlider(W, H, onBack, state, setState, rendererRef, palette, true, true)
      break
    case GooseDest.BottomTabs2:
      result = buildBottomTabs(W, H, onBack, state, setState, rendererRef, palette, tabsConfig, true, true)
      break
    case GooseDest.BottomTabs:
      result = buildBottomTabs(W, H, onBack, state, setState, rendererRef, palette, tabsConfig)
      break
    case GooseDest.Dialog:
      result = buildDialog(W, H, onBack, state, palette, dialogConfig, onDialogTap)
      break
    case GooseDest.Magnifier:
      result = buildMagnifier(W, H, onBack, state, setState, palette)
      break
    case GooseDest.ScrollContainer:
      result = buildScrollContainer(W, onBack, 20, palette, scrollConfig, onLinkTap)
      break
    case GooseDest.LazyScrollContainer:
      result = buildScrollContainer(W, onBack, 100, palette, scrollConfig, onLinkTap)
      break
    case GooseDest.Rating:
      result = buildRating(W, H, onBack, state, setState, rendererRef, palette)
      break
    case GooseDest.RingProgress:
      result = buildRingProgress(W, H, onBack, state, setState, rendererRef, palette)
      break
    case GooseDest.SiriWave:
      // siri-wave 是纯 shader 动画（组件层独立渲染），此处仅占位。
      result = buildSiriWave(W, H)
      break
    default:
      result = buildButtons(W, H, onBack, palette, onButtonTap)
      break
  }
  // Move the back button to the end of the element list so it's on top of
  // all layers (scrims, overlays, glass elements). It was pushed first by
  // each builder, but scrims/overlays pushed after it would cover it.
  // When hideOverlayButtons is true, the back button + theme toggle are NOT
  // rendered — use the browser back button / Esc instead.
  const hideOverlays = state.hideOverlayButtons
  const backIdx = result.elements.findIndex((e) => e.id === '__back__')
  if (backIdx >= 0) {
    if (hideOverlays) {
      // Remove the back button entirely (hidden by setting).
      result.elements.splice(backIdx, 1)
      delete result.interactions['__back__']
    } else {
      const [backEl] = result.elements.splice(backIdx, 1)
      result.elements.push(backEl)
    }
  }
  // Theme toggle — appended AFTER the destination's elements so it sits on top
  // in z-order (tappable even over other glass elements). The button is
  // non-scrolling (stays at top-right when the page scrolls).
  // Skipped when hideOverlays is true.
  if (onToggleTheme && !hideOverlays) {
    const themeBtn = gooseThemeBtn(onToggleTheme, palette, isLightTheme, W, false)
    // Apply global separable blur to the theme toggle too (it's created
    // AFTER the globalSeparableBlur loop above, so it misses the mark).
    if (state.globalSeparableBlur) {
      themeBtn.element.useSeparableBlur = true
    }
    result.elements.push(themeBtn.element)
    result.interactions[themeBtn.element.id] = themeBtn.interaction
  }
  // Global separable 2-pass blur: when enabled in Settings, apply useSeparableBlur
  // to all glass elements (buttons + glass-shapes). Skip special elements that
  // have their own backdrop semantics (toggle knob, indicator, magnifier, SDF
  // texture) — those keep inline blur for correctness. Glass Playground square
  // always has useSeparableBlur regardless of this setting.
  // Applied AFTER all elements (including back button, theme toggle, pick-image)
  // are created so none are missed.
  if (state.globalSeparableBlur) {
    for (const el of result.elements) {
      if ((el.kind === 'button' || el.kind === 'glass-shape') &&
          !el.isSdfTexture && !el.isToggleKnob &&
          !el.isBottomTabIndicator && !el.isMagnifier) {
        el.useSeparableBlur = true
      }
    }
  }
  return result
}
