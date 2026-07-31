'use client'

import * as React from 'react'
import { LiquidGlassRenderer, type GooseElement } from './renderer'
import { gooseDragGroups } from './catalog'

/* ------------------------------------------------------------------ *
 * GooseCanvas
 *
 * A self-contained WebGL canvas that renders a wallpaper + a list of
 * liquid-glass elements. No DOM children — the canvas owns the entire
 * visual surface (wallpaper, glass, labels, chevrons, press glow).
 *
 * Elements may be of several kinds (button / glass-shape / plain-rect /
 * progressive-blur / text). Pointer events are hit-tested against each
 * element rect:
 *   - 'button' kind → triggers InteractiveHighlight press + drag
 *   - any kind with onTap → fires the callback on pointerup if the
 *     pointer is still inside the element
 *   - any kind with onDrag → fires live during pointermove
 *   - empty space OR vertical-drag-takeover → starts a scroll drag
 *
 * Scroll behavior (matches user feedback):
 *   - During drag, scrollY follows the finger directly (no spring).
 *   - On release, the drag velocity becomes inertia, which exponentially
 *     decays. No rebound at edges — scrolling just stops at the boundary.
 *   - If the press starts on an element but the user drags mostly
 *     vertically, the gesture is converted to a scroll (so list items
 *     and buttons don't trap the scroll).
 *
 * Wheel events scroll the canvas directly (no inertia).
 * ------------------------------------------------------------------ */

export interface GooseInteract {
  onTap?: (pos: { x: number; y: number }) => void
  /** Fires on first pointermove after press. */
  onDragStart?: (pos: { x: number; y: number }) => void
  /** Fires on each pointermove while pressed. */
  onDrag?: (pos: { x: number; y: number }, delta: { x: number; y: number }) => void
  /** Fires on pointerup. `velocity` is the release velocity in px/s
   *  (positive y = downward), computed from recent pointer samples.
   *  Faithful to Compose's `draggable.onDragStopped(velocity)`. */
  onDragEnd?: (pos: { x: number; y: number }, velocity: { x: number; y: number }) => void
  /** Fires during a multi-pointer transform gesture (pinch zoom + rotate).
   *  `gestureZoom` is the multiplicative zoom factor (1.0 = no change),
   *  `gestureRotate` is the additive rotation delta in radians,
   *  `pan` is the centroid movement delta (already rotation-aware).
   *  Faithful to Compose's detectTransformGestures. Only fires when 2+ pointers
   *  are active on the element. */
  onTransform?: (pan: { x: number; y: number }, gestureZoom: number, gestureRotate: number) => void
}

/** Internal gesture mode — set on pointerdown, may transition during move. */
type GestureMode =
  | 'pending' // pointer down, no movement yet — could become tap, drag, or scroll
  | 'drag' // committed to an element drag (horizontal or onDrag element)
  | 'scroll' // committed to a scroll drag
  | 'transform' // 2-pointer pinch zoom + rotate (onTransform element)
  | 'none' // no active gesture

/** Per-pointer gesture state. Stored in a Map<pointerId, GestureState> so
 *  multiple pointers can interact with different elements simultaneously
 *  (multi-touch). When 2 pointers land on the same element with onTransform,
 *  they form a transform pair (pinch zoom + rotate) — both entries have
 *  mode='transform' and point at each other via transformPartner. */
interface GestureState {
  /** Hit element id (or null for scroll/empty space). */
  pressedId: string | null
  /** Canvas-local CSS px at press. */
  startX: number
  startY: number
  /** Client-Y at press (for scroll delta computation). */
  startClientY: number
  /** ScrollY at press (for scroll delta computation). */
  startScrollY: number
  /** Whether onDragStart has fired for this gesture. */
  dragStarted: boolean
  /** Current gesture mode. */
  mode: GestureMode
  /** Whether the hit element had an onDrag handler (so we know
   *  whether to commit to drag or scroll on horizontal/vertical move). */
  hasDrag: boolean
  /** Recent (timestamp, clientX, clientY) samples for inertia + release
   *  velocity. Both axes are tracked — faithful to Compose's VelocityTracker
   *  which returns an Offset(x, y). */
  velocitySamples: { t: number; x: number; y: number }[]
  /** Current canvas-local CSS px. */
  x: number
  y: number
  /** pointerId of the other pointer in a transform pair (else null). */
  transformPartner: number | null
}
