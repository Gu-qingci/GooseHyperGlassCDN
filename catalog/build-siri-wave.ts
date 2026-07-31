import {
  SIRI_WAVE_FRAGMENT_SHADER,
  SIRI_ORB_FRAGMENT_SHADER,
} from '../shaders'
import type { GooseResult } from './types'

/* ------------------------------------------------------------------ *
 * SIRI-WAVE — Apple Siri 声波 / 流体圆点动画 mode。
 *
 * 与其余 mode 不同，siri-wave 是纯 fragment shader 动画，不走玻璃元素
 * 渲染管线。catalog 层的 `buildSiriWave` 只返回空结果占位；组件层
 * （liquid-glass.ts）检测到 mode 时改用 `SiriWaveRunner` 直接在 canvas
 * 上跑独立动画循环。
 *
 * Shader 来源：aaaa-zhen/siri-glsl（MIT）siri-wave.html
 * ------------------------------------------------------------------ */

export type SiriVariant = 'wave' | 'orb'

/** 占位 builder——组件层不消费此结果，仅保持 gooseBuild switch 完整性。 */
export function buildSiriWave(W: number, H: number): GooseResult {
  return { elements: [], interactions: {}, contentHeight: H }
}

const SIRI_VERTEX_SHADER = 'attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }'

const RENDER_SCALE = 0.75 // 内部分辨率倍率，卡就调小

export class SiriWaveRunner {
  private _canvas: HTMLCanvasElement
  private _gl: WebGLRenderingContext | null = null
  private _prog: WebGLProgram | null = null
  private _buf: WebGLBuffer | null = null
  private _U: Record<string, WebGLUniformLocation | null> = {}
  private _raf = 0
  private _start = 0
  private _variant: SiriVariant = 'wave'
  private _speed = 1
  private _scale = 1
  private _dpr = 1
  private _w = 0
  private _h = 0
  private _killed = false

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas
    try {
      this._gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
      }) as WebGLRenderingContext | null
    } catch {
      this._gl = null
    }
    if (!this._gl) {
      console.warn('[liquid-glass] siri-wave: WebGL not available')
      return
    }
    this._compile()
  }

  get variant(): SiriVariant {
    return this._variant
  }
  set variant(v: SiriVariant) {
    if (v === this._variant) return
    this._variant = v === 'orb' ? 'orb' : 'wave'
    this._compile()
  }

  get speed(): number {
    return this._speed
  }
  set speed(v: number) {
    this._speed = v > 0 ? v : 1
  }

  get scale(): number {
    return this._scale
  }
  set scale(v: number) {
    this._scale = v > 0 ? v : 1
  }

  get dpr(): number {
    return this._dpr
  }
  set dpr(v: number) {
    this._dpr = v > 0 ? v : 1
    this._applySize()
  }

  /** 设置 CSS 尺寸；canvas 像素尺寸 = css * dpr * RENDER_SCALE。 */
  resize(w: number, h: number) {
    this._w = w
    this._h = h
    this._applySize()
  }

  private _applySize() {
    const gl = this._gl
    if (!gl || !this._w || !this._h) return
    const bw = Math.max(1, Math.round(this._w * this._dpr * RENDER_SCALE))
    const bh = Math.max(1, Math.round(this._h * this._dpr * RENDER_SCALE))
    if (this._canvas.width !== bw) this._canvas.width = bw
    if (this._canvas.height !== bh) this._canvas.height = bh
    gl.viewport(0, 0, bw, bh)
  }

  private _compile() {
    const gl = this._gl
    if (!gl) return
    if (this._prog) {
      gl.deleteProgram(this._prog)
      this._prog = null
    }
    const vs = this._shader(gl.VERTEX_SHADER, SIRI_VERTEX_SHADER)
    const fsSrc = this._variant === 'orb' ? SIRI_ORB_FRAGMENT_SHADER : SIRI_WAVE_FRAGMENT_SHADER
    const fs = this._shader(gl.FRAGMENT_SHADER, fsSrc)
    if (!vs || !fs) return
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[liquid-glass] siri-wave: link failed:', gl.getProgramInfoLog(prog))
      gl.deleteProgram(prog)
      return
    }
    this._prog = prog

    if (!this._buf) {
      this._buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    }
    gl.useProgram(prog)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    this._U.iResolution = gl.getUniformLocation(prog, 'iResolution')
    this._U.iTime = gl.getUniformLocation(prog, 'iTime')
    this._U.uSpeed = gl.getUniformLocation(prog, 'uSpeed')
    this._U.uScale = gl.getUniformLocation(prog, 'uScale')
  }

  private _shader(type: number, src: string): WebGLShader | null {
    const gl = this._gl!
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[liquid-glass] siri-wave: compile error:', gl.getShaderInfoLog(s))
      gl.deleteShader(s)
      return null
    }
    return s
  }

  /** 启动动画循环（幂等）。 */
  start() {
    if (this._raf || !this._gl) return
    if (!this._start) this._start = performance.now()
    const frame = () => {
      if (this._killed) return
      const gl = this._gl
      const prog = this._prog
      if (gl && prog) {
        const t = (performance.now() - this._start) / 1000
        gl.useProgram(prog)
        if (this._U.iResolution) gl.uniform2f(this._U.iResolution, this._canvas.width, this._canvas.height)
        if (this._U.iTime) gl.uniform1f(this._U.iTime, t)
        if (this._U.uSpeed) gl.uniform1f(this._U.uSpeed, this._speed)
        if (this._U.uScale) gl.uniform1f(this._U.uScale, this._scale)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      this._raf = requestAnimationFrame(frame)
    }
    this._raf = requestAnimationFrame(frame)
  }

  /** 暂停循环。 */
  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf)
      this._raf = 0
    }
  }

  kill() {
    this._killed = true
    this.stop()
    const gl = this._gl
    if (gl) {
      if (this._prog) {
        gl.deleteProgram(this._prog)
        this._prog = null
      }
      if (this._buf) {
        gl.deleteBuffer(this._buf)
        this._buf = null
      }
    }
  }
}
