// LiquidGlassSearch — 独立 WebGL2 组件：iPadOS 拖拽唤醒搜索框复刻。
//
// 来源：aaaa-zhen/siri-glsl（MIT）metaball-search.html
//   （QuartzCore default.metallib 反汇编：梯度感知 sdf_union + SDF 玻璃折射 +
//    CPU 弹簧驱动的 圆→胶囊 连续形变）
//
// 独立通道设计（用户指定"给他自己开独立通道"）：
//   - 独立自定义元素 <liquid-glass-search>，不进 <liquid-glass> 的 mode 列表
//   - 独立 WebGL2 渲染（shader 为 300 es，与主组件 WebGL1 互不干扰）
//   - 独立手势系统（顶部黑边下拉拖拽）+ 独立 shadow DOM（canvas + 搜索框）
//
// 用法：
//   <script src="liquid-glass.js"></script>   ← 同一个 bundle，同时注册两个元素
//   <liquid-glass-search style="width:100%;height:300px"></liquid-glass-search>
//
// 属性：
//   wallpaper   — 背景图 URL（玻璃折射它）；不传则 shader 程序化背景
//   placeholder — 搜索框提示文字（默认 "Search or Ask"）
//   hint        — 顶部提示文字（默认 "从顶部黑边往下拖拽"），"" 隐藏
//   dpr         — 渲染倍率上限（默认设备 DPR，cap 2）
//
// 事件：
//   lg-search        — 输入变化 detail { text }
//   lg-search-submit — 回车 detail { text }
//   lg-search-close  — 搜索框收回 detail {}

/* eslint-disable */

// ---------- fragment shader（原样保留，仅删内嵌 base64 壁纸） ----------
const FRAG = `#version 300 es
precision highp float;
uniform vec2  uRes;
uniform vec4  uBlob;   // cx, cy, halfX, halfY (px, y 向下)
uniform float uEdge;   // 顶部黑边高度
uniform float uK;      // 融合半径
uniform float uHeight, uRefract, uHlAmt, uAb, uDpr, uCont;
uniform float uDark;   // 液滴材质 1=贴边黑玻璃 0=落地浅磨砂
uniform float uValid;
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec2  uTexSize;
out vec4 outColor;

// ---------- 背景:壁纸纹理 (cover-fit),加载失败降级程序化地图 ----------
// blurR>0 时按苹果的 blur→mip 映射取 LOD: lod = log2(r<2 ? r/2+1 : r)
vec3 bgcol(vec2 p, float blurR){
  if (uHasTex > 0.5) {
    float s  = max(uRes.x / uTexSize.x, uRes.y / uTexSize.y);
    vec2  uv = (p - 0.5 * (uRes - uTexSize * s)) / (uTexSize * s);
    float lod = max(0.0, log2(blurR < 2.0 ? blurR * 0.5 + 1.0 : blurR));
    return textureLod(uTex, clamp(uv, vec2(0.002), vec2(0.998)), lod).rgb;
  }
  vec2 st = p / uRes.y;
  vec2 g  = fract(st * 6.0) - 0.5;
  float street = smoothstep(0.43, 0.455, max(abs(g.x), abs(g.y)));
  vec3 c = mix(vec3(0.90, 0.885, 0.85), vec3(0.985, 0.975, 0.96), street);
  c = mix(c, vec3(0.78, 0.88, 0.71), 1.0 - smoothstep(0.10, 0.30, length(st - vec2(0.33, 0.62))));
  c = mix(c, vec3(0.69, 0.83, 0.93), 1.0 - smoothstep(0.15, 0.42, length(st - vec2(1.55, 0.40))));
  for (int i = 0; i < 6; i++) {
    vec2 q = vec2(0.21 + 0.27 * float(i), fract(0.37 + 0.61 * float(i)) * 0.8 + 0.12);
    float d = length(st - q) * uRes.y;
    c = mix(c, vec3(0.95, 0.45, 0.25), 1.0 - smoothstep(7.0, 9.0, d));
    c = mix(c, vec3(1.0), 1.0 - smoothstep(2.5, 4.0, d));
  }
  c *= 1.0 - 0.10 * st.y / (uRes.x / uRes.y);   // 轻微纵向渐变
  return c;
}

// ---------- rounded-box SDF + 解析梯度 ----------
// supercircle_sdf 的圆角分支(cornerFlags=圆角);圆/胶囊/圆角矩形同一原语
vec4 sdRoundBox(vec2 p, vec2 c, vec2 b, float r){
  vec2 lp = p - c;
  vec2 q  = abs(lp) - b + r;
  vec2 mq = max(q, vec2(0.0));
  float dOut = length(mq);
  float d = dOut + min(max(q.x, q.y), 0.0) - r;
  vec2 grad = (dOut > 1e-4) ? (mq / dOut) * sign(lp)
            : ((q.x > q.y) ? vec2(sign(lp.x), 0.0) : vec2(0.0, sign(lp.y)));
  return vec4(d, grad, 1.0);
}

// ---------- 苹果 sdf_union:梯度感知 smooth min ----------
// QuartzCore ShaderUtils_::sdf_union 逐行翻译
vec4 sdfUnion(vec4 a, vec4 b, float k){
  if (b.w == 0.0) b = vec4(10000.0, 0.0, 0.0, 0.0);     // half 0x70E2
  float kEff = k * clamp(0.5 - 0.5 * dot(a.yz, b.yz), 0.0, 1.0) + 1e-4;
  float h = clamp(0.5 + 0.5 * (b.x - a.x) / kEff, 0.0, 1.0);
  float d = mix(b.x, a.x, h) - kEff * h * (1.0 - h);    // IQ 多项式 smin
  vec2  g = mix(b.yz, a.yz, h);                         // 梯度同步混合
  return vec4(d, normalize(g + vec2(1e-5)), 1.0);
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);  // y 向下,对齐 UI 坐标

  vec4 bar  = vec4(p.y - uEdge, 0.0, 1.0, 1.0);            // 顶部黑边 = 半平面
  vec4 blob = sdRoundBox(p, uBlob.xy, uBlob.zw, min(uBlob.z, uBlob.w));
  blob.w = uValid;
  vec4 s = sdfUnion(bar, blob, uK);
  float d = s.x;  vec2 g = s.yz;

  // 背景 + 外侧软阴影 (sdf_shadow)
  float sh = (d > 0.0) ? exp(-d / 30.0) * 0.22 : 0.0;
  vec3 col = bgcol(p, 0.0) * (1.0 - sh);

  // ---------- 玻璃 = 折射 + 高光,无 face color ----------
  // 公式同 QuartzCore sdf_glass_displacement/highlight,参数取 z1han siri27 标定
  float wb = uValid * clamp(0.5 + 0.5 * (bar.x - blob.x) / 24.0, 0.0, 1.0);
  float darkAmt = mix(1.0, uDark, wb);

  // 梯度向"中心径向"微混 8%,透镜更圆润(只对液滴,bar 区域 wb≈0)
  vec2 lp = p - uBlob.xy;
  vec2 radial = normalize(vec2(lp.x, uBlob.z * lp.y / max(uBlob.w, 0.001)) + 1e-5);
  vec2 gr = normalize(mix(g, radial, 0.08 * wb));

  // 圆弧剖面 (curvature=1),折射量为负 → 边缘把外侧内容"拉进来"(放大镜感)
  float t   = clamp(-d / uHeight, 0.0, 1.0);
  float mag = 1.0 - sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
  vec2  dsp = -uRefract * mag * gr;
  // 边缘环:近清晰采样 + 色差
  vec3 sharp;
  sharp.r = bgcol(p + dsp * (1.0 - uAb), 3.0).r;
  sharp.g = bgcol(p + dsp, 3.0).g;
  sharp.b = bgcol(p + dsp * (1.0 + uAb), 3.0).b;
  // 内部:8 抽样圆盘 + 中等 mip 联合模糊——纯 mip 三线性有块感,圆盘把它抹匀
  float br = mix(14.0, 60.0, clamp(-d / (50.0 * uDpr), 0.0, 1.0)) * uDpr;
  vec3 soft = bgcol(p + dsp, br * 0.4) * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = 0.7854 * float(i);
    soft += bgcol(p + dsp + vec2(cos(a), sin(a)) * br * 0.7, br * 0.4) * 0.1;
  }
  float deep = clamp(-d / (40.0 * uDpr), 0.0, 1.0);   // 越深入越用模糊
  vec3 refr = mix(sharp, soft, deep);

  // face 压暗 = 乘法系数的垂直渐变(真机截图逐像素实测标定):
  // 顶 ×0.03(近纯黑) 中 ×0.19 底 ×0.34,线性 m ≈ 0.20 + 0.40·ny;
  // 用乘法不残留底图对比(不发花),用渐变还原"上黑下透"
  float ny = (p.y - uBlob.y) / max(uBlob.w, 1.0);   // -1=顶 +1=底
  float m  = clamp(0.20 + 0.40 * ny, 0.0, 1.0);
  float crush = mix(1.0, m, uCont * wb);
  refr = refr * crush + vec3(0.008, 0.010, 0.014) * uCont * wb;

  // edge_bleed(IR 解码):亮背景从边缘渗入玻璃内侧——圆剖面位移 + mip 模糊
  // + 贴边距离带 + 亮度四次方门控(背景越亮渗越多,暗处几乎不渗)
  float xb  = clamp(-d / (10.0 * uDpr), 0.0, 1.0);
  float dbl = 24.0 * uDpr * (1.0 - sqrt(xb * (2.0 - xb)));
  vec3 bleed = bgcol(p + gr * dbl, 22.0);
  float wbd  = clamp((d + 26.0 * uDpr) / (20.0 * uDpr), 0.0, 1.0);
  float blum = dot(bleed, vec3(0.2125, 0.7154, 0.0721));
  float bm   = pow(clamp(blum * 1.2, 0.0, 1.0), 2.0) * wbd;
  refr = mix(refr, bleed, bm * bm * 0.85);

  vec3 glass = mix(refr, refr * 0.10 + vec3(0.016), darkAmt); // 落地=纯玻璃,贴边=黑玻璃

  // 高光:细带 2.2px,key 45° + fill 225° 对角双光,锐掩码 cut 0.52,压缩 norm 8
  float qd  = -d;
  float hw  = 2.2 * uDpr;
  float aaq = max(fwidth(qd), 1e-3);
  float band = (1.0 - clamp(qd / hw, 0.0, 1.0))
             * clamp(qd / aaq + 0.5, 0.0, 1.0)
             * clamp((hw - qd) / aaq + 0.5, 0.0, 1.0);
  vec2 kdir = vec2(0.7071, 0.7071);
  float key  = band * clamp((dot(kdir, gr) - 0.52) / 0.48, 0.0, 1.0);
  float fill = band * clamp((dot(-kdir, gr) - 0.52) / 0.48, 0.0, 1.0);
  key  = key  / (1.0 + (1.0 - key)  * 8.0);
  fill = fill / (1.0 + (1.0 - fill) * 8.0);
  glass += (key + fill) * uHlAmt * mix(1.0, 0.4, darkAmt);

  float aaw = max(fwidth(d), 1e-3);
  col = mix(col, glass, smoothstep(aaw, -aaw, d));
  outColor = vec4(col, 1.0);
}`

const VERT = `#version 300 es
void main(){ vec2 v = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  gl_Position = vec4(v*2.0-1.0, 0.0, 1.0); }`

// ---------- CPU 弹簧（原 demo 原样） ----------
class Spring {
  x: number
  v: number
  t: number
  om = 11
  ze = 0.72
  constructor(v: number) {
    this.x = v
    this.v = 0
    this.t = v
  }
  set(om: number, ze: number) {
    this.om = om
    this.ze = ze
    return this
  }
  step(dt: number) {
    this.v += (this.om * this.om * (this.t - this.x) - 2 * this.ze * this.om * this.v) * dt
    this.x += this.v * dt
    return this.x
  }
}

// ---------- 渲染 + 手势 runner（独立 WebGL2 通道） ----------
const EDGE = 26 // 顶部黑边 (css px)
const R = 34 // 拖拽液滴半径

type MBState = 'IDLE' | 'DRAG' | 'CAPSULE' | 'RETRACT'

/** 可调渲染参数（对应原 demo 调参面板的 8 个值）。 */
export interface MBParams {
  k: number // 融合半径（液颈粗细）
  height: number // 透镜高度（折射过渡带）
  refract: number // 折射强度
  hl: number // 高光强度
  ab: number // 色差
  cont: number // 黑玻璃强度（胶囊容器淡入）
  om: number // 弹簧频率 ω
  ze: number // 弹簧阻尼比 ζ
}

const DEFAULT_PARAMS: MBParams = { k: 64, height: 18, refract: 14, hl: 1.5, ab: 0.12, cont: 0.5, om: 11, ze: 0.72 }

class MetaballSearchRunner {
  private _canvas: HTMLCanvasElement
  private _gl: WebGL2RenderingContext | null = null
  private _prog: WebGLProgram | null = null
  private _U: Record<string, WebGLUniformLocation | null> = {}
  private _tex: WebGLTexture | null = null
  private _hasTex = 0
  private _texSize: [number, number] = [1, 1]
  private _dpr = 1
  private _w = 0
  private _h = 0
  private _raf = 0
  private _last = 0
  private _killed = false
  private _wallpaperUrl = ''

  state: MBState = 'IDLE'
  pointer = { x: 0, y: 0 }
  private _sp = {
    cx: new Spring(0),
    cy: new Spring(0),
    bx: new Spring(0),
    by: new Spring(0),
    k: new Spring(64),
    dark: new Spring(1),
    cont: new Spring(0),
  }
  private _P: MBParams = { ...DEFAULT_PARAMS }

  onCapsuleChange: ((active: boolean, rect: { x: number; y: number; w: number; h: number }) => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas
    try {
      this._gl = canvas.getContext('webgl2', { antialias: false }) as WebGL2RenderingContext | null
    } catch {
      this._gl = null
    }
    if (!this._gl) {
      console.warn('[liquid-glass-search] WebGL2 not available')
      return
    }
    this._compile()
    this._initTexture()
  }

  get dpr(): number {
    return this._dpr
  }
  set dpr(v: number) {
    this._dpr = v > 0 ? v : 1
    this._applySize()
  }

  get wallpaper(): string {
    return this._wallpaperUrl
  }
  set wallpaper(url: string) {
    if (url === this._wallpaperUrl) return
    this._wallpaperUrl = url
    if (url) this._loadWallpaper(url)
  }

  resize(w: number, h: number) {
    this._w = w
    this._h = h
    this._applySize()
  }

  private _applySize() {
    const gl = this._gl
    if (!gl || !this._w || !this._h) return
    const bw = Math.max(1, Math.round(this._w * this._dpr))
    const bh = Math.max(1, Math.round(this._h * this._dpr))
    if (this._canvas.width !== bw) this._canvas.width = bw
    if (this._canvas.height !== bh) this._canvas.height = bh
    gl.viewport(0, 0, bw, bh)
  }

  private _compile() {
    const gl = this._gl
    if (!gl) return
    const vs = this._shader(gl.VERTEX_SHADER, VERT)
    const fs = this._shader(gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[liquid-glass-search] link failed:', gl.getProgramInfoLog(prog))
      gl.deleteProgram(prog)
      return
    }
    this._prog = prog
    gl.useProgram(prog)
    const names = ['uRes', 'uBlob', 'uEdge', 'uK', 'uHeight', 'uRefract', 'uHlAmt', 'uAb', 'uDpr', 'uDark', 'uCont', 'uValid', 'uTex', 'uHasTex', 'uTexSize']
    this._U = {}
    for (const n of names) this._U[n] = gl.getUniformLocation(prog, n)
    gl.uniform1i(this._U.uTex, 0)
  }

  private _shader(type: number, src: string): WebGLShader | null {
    const gl = this._gl!
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[liquid-glass-search] compile error:', gl.getShaderInfoLog(s))
      gl.deleteShader(s)
      return null
    }
    return s
  }

  private _initTexture() {
    const gl = this._gl
    if (!gl) return
    this._tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this._tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private _loadWallpaper(url: string) {
    const gl = this._gl
    if (!gl || !this._tex) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        gl.bindTexture(gl.TEXTURE_2D, this._tex!)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.generateMipmap(gl.TEXTURE_2D)
        this._hasTex = 1
        this._texSize = [img.width, img.height]
      } catch {
        this._hasTex = 0 // 跨域等失败 → 程序化背景
      }
    }
    img.onerror = () => {
      this._hasTex = 0
    }
    img.src = url
  }

  // ---- 手势（独立通道，不走主组件元素手势系统） ----
  onDown(x: number, y: number) {
    if (this.state === 'CAPSULE') {
      // 点胶囊区域（搜索框）内不收回，点外面才收回
      const c = this.capsuleRect()
      const inCapsule = Math.abs(x - c.x) <= c.w / 2 + 8 && Math.abs(y - c.y) <= c.h / 2 + 8
      if (!inCapsule) this.retract()
      return
    }
    this.state = 'DRAG'
    this.pointer = { x, y }
    const sp = this._sp
    sp.cx.x = x
    sp.cx.v = 0
    sp.cy.x = EDGE * 0.5
    sp.cy.v = 0 // 从黑边里渗出来
    sp.bx.x = sp.by.x = 2
    sp.cx.set(18, 0.95)
    sp.cy.set(18, 0.95) // 跟手要紧
    sp.bx.set(this._P.om, this._P.ze)
    sp.by.set(this._P.om, this._P.ze)
    sp.dark.t = 1
    sp.k.t = this._P.k
    sp.cont.t = 0
  }
  onMove(x: number, y: number) {
    if (this.state !== 'DRAG') return
    this.pointer = { x, y }
  }
  onUp() {
    if (this.state !== 'DRAG') return
    if (this.pointer.y > this._h * 0.32) {
      // 拉够了 → 凝聚胶囊
      this.state = 'CAPSULE'
      const c = this.capsuleRect()
      const sp = this._sp
      for (const s of [sp.cx, sp.cy, sp.bx, sp.by]) s.set(this._P.om, this._P.ze)
      sp.cx.t = c.x
      sp.cy.t = c.y
      sp.bx.t = c.w / 2
      sp.by.t = c.h / 2
      sp.dark.t = 0 // 材质变浅 + 与边缘脱开
      sp.k.t = 10
      sp.cont.t = 1 // 黑顶容器淡入
    } else {
      this.retract()
    }
  }

  capsuleRect() {
    const sw = this._w
    const w = sw < 600 ? sw - 44 : Math.min(560, sw * 0.62)
    const h = sw < 600 ? 50 : 56
    return { x: sw / 2, y: EDGE + (sw < 600 ? 70 : 96), w, h }
  }

  retract() {
    if (this.state === 'RETRACT') return
    this.state = 'RETRACT'
    const sp = this._sp
    for (const s of [sp.cx, sp.cy, sp.bx, sp.by]) s.set(this._P.om, this._P.ze)
    sp.cy.t = EDGE * 0.3
    sp.bx.t = sp.by.t = 1
    sp.dark.t = 1
    sp.k.t = this._P.k
    sp.cont.t = 0
    this.onCapsuleChange?.(false, { x: 0, y: 0, w: 0, h: 0 })
  }

  get capsuleActive(): boolean {
    return this.state === 'CAPSULE'
  }

  /** 调整渲染/弹簧参数（对应原 demo 调参面板）。 */
  setParams(patch: Partial<MBParams>) {
    for (const key of Object.keys(patch) as (keyof MBParams)[]) {
      const v = patch[key]
      if (typeof v === 'number' && isFinite(v)) this._P[key] = v
    }
    // 融合半径在非胶囊态同步到弹簧目标（原 demo bind('K') 逻辑）
    if (patch.k != null && this.state !== 'CAPSULE') this._sp.k.t = patch.k
  }

  start() {
    if (this._raf || !this._gl) return
    this._last = performance.now()
    const frame = (now: number) => {
      if (this._killed) return
      this._tick(now)
      this._raf = requestAnimationFrame(frame)
    }
    this._raf = requestAnimationFrame(frame)
  }

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
      if (this._tex) {
        gl.deleteTexture(this._tex)
        this._tex = null
      }
    }
  }

  private _tick(now: number) {
    const gl = this._gl
    const prog = this._prog
    const cv = this._canvas
    if (!gl || !prog) return
    const dt = Math.min((now - this._last) / 1000, 1 / 30)
    this._last = now
    const sp = this._sp
    const P = this._P

    if (this.state === 'DRAG') {
      sp.cx.t = this.pointer.x
      sp.cy.t = Math.max(this.pointer.y, EDGE * 0.5)
      // 速度拉伸:液滴朝运动方向微微变长
      sp.bx.t = R + Math.min(26, Math.abs(sp.cx.v) * 0.045)
      sp.by.t = R + Math.min(26, Math.abs(sp.cy.v) * 0.045)
    }
    for (const key in sp) sp[key as keyof typeof sp].step(dt)
    if (this.state === 'RETRACT' && sp.by.x < 2.5) this.state = 'IDLE'

    const dpr = this._dpr
    gl.useProgram(prog)
    gl.uniform2f(this._U.uRes, cv.width, cv.height)
    gl.uniform4f(this._U.uBlob, sp.cx.x * dpr, sp.cy.x * dpr, Math.max(sp.bx.x, 0.5) * dpr, Math.max(sp.by.x, 0.5) * dpr)
    gl.uniform1f(this._U.uEdge, EDGE * dpr)
    gl.uniform1f(this._U.uK, sp.k.x * dpr)
    gl.uniform1f(this._U.uHeight, P.height * dpr)
    gl.uniform1f(this._U.uRefract, P.refract * dpr)
    gl.uniform1f(this._U.uHlAmt, P.hl)
    gl.uniform1f(this._U.uAb, P.ab)
    gl.uniform1f(this._U.uDpr, dpr)
    gl.uniform1f(this._U.uDark, Math.max(0, Math.min(1, sp.dark.x)))
    gl.uniform1f(this._U.uCont, Math.max(0, Math.min(1, sp.cont.x)) * P.cont)
    gl.uniform1f(this._U.uValid, this.state === 'IDLE' ? 0 : 1)
    gl.uniform1f(this._U.uHasTex, this._hasTex)
    gl.uniform2f(this._U.uTexSize, this._texSize[0], this._texSize[1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 搜索框 DOM 跟弹簧矩形走（文字在弹簧落定时淡入）
    if (this.state === 'CAPSULE') {
      const r = { x: sp.cx.x - sp.bx.x, y: sp.cy.x - sp.by.x, w: sp.bx.x * 2, h: sp.by.x * 2 }
      this.onCapsuleChange?.(true, r)
    }
  }
}

// ---------- 组件 ----------
const SEARCH_ICON =
  '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.8 12.8 17 17"/></svg>'
const MIC_ICON =
  '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="7.2" y="2.2" width="5.6" height="9.6" rx="2.8"/><path d="M4.6 9.6a5.4 5.4 0 0 0 10.8 0"/><path d="M10 15v2.6"/></svg>'

class LiquidGlassSearch extends HTMLElement {
  private _canvas!: HTMLCanvasElement
  private _hint!: HTMLElement
  private _searchEl!: HTMLElement
  private _input!: HTMLInputElement
  private _caret!: HTMLElement
  private _runner: MetaballSearchRunner | null = null
  private _ro: ResizeObserver | null = null
  private _w = 0
  private _h = 0
  private _disposed = false
  private _mctx: CanvasRenderingContext2D | null = null
  private _caretReset = 0
  private _capsuleWas = false
  private _inputFocused = false

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent =
      ':host{position:relative;display:block;overflow:hidden;background:#000;}' +
      'canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;}' +
      '#hint{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);' +
      'color:rgba(255,255,255,.5);font-size:14px;font-weight:600;pointer-events:none;' +
      'transition:opacity .4s;font-family:-apple-system,system-ui,sans-serif;text-shadow:0 1px 6px rgba(0,0,0,.4);}' +
      '#search{position:absolute;display:flex;align-items:center;opacity:0;pointer-events:none;' +
      'transition:opacity .25s;box-sizing:border-box;}' +
      '#search input{flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;' +
      'font:400 17px/1 -apple-system,system-ui,"SF Pro Text",sans-serif;letter-spacing:.1px;' +
      'color:#fff;caret-color:transparent;padding:0 10px;text-shadow:0 1px 5px rgba(0,0,0,.35);box-sizing:border-box;}' +
      '#search input::placeholder{color:rgba(235,235,245,.45)}' +
      '#search svg{flex:none;color:#fff;opacity:.72;filter:drop-shadow(0 1px 3px rgba(0,0,0,.3));}' +
      '#search .ic{margin-left:20px}' +
      '#search .mic{margin-right:20px}' +
      '#caret{position:absolute;width:2px;height:21px;top:50%;transform:translateY(-50%);' +
      'border-radius:1px;background:#fff;display:none;pointer-events:none;' +
      'box-shadow:0 0 5px rgba(255,255,255,.95),0 0 14px rgba(255,255,255,.5);' +
      'animation:lgc-blink 1.12s step-end infinite;}' +
      '@keyframes lgc-blink{0%,60%{opacity:1}61%,100%{opacity:0}}' +
      '@media (max-width:600px){#search input{font-size:16px;padding:0 8px}#search .ic{margin-left:14px}#search .mic{margin-right:14px}#caret{height:19px}}'
    this._canvas = document.createElement('canvas')
    this._hint = document.createElement('div')
    this._hint.id = 'hint'
    this._searchEl = document.createElement('div')
    this._searchEl.id = 'search'
    this._input = document.createElement('input')
    this._caret = document.createElement('span')
    this._caret.id = 'caret'
    this._searchEl.innerHTML = SEARCH_ICON.replace('<svg', '<svg class="ic"')
    this._input.setAttribute('spellcheck', 'false')
    this._input.setAttribute('autocomplete', 'off')
    this._searchEl.appendChild(this._input)
    this._searchEl.appendChild(this._caret)
    this._searchEl.insertAdjacentHTML('beforeend', MIC_ICON.replace('<svg', '<svg class="ic mic"'))
    shadow.appendChild(style)
    shadow.appendChild(this._canvas)
    shadow.appendChild(this._hint)
    shadow.appendChild(this._searchEl)
  }

  static get observedAttributes() {
    return ['wallpaper', 'dpr', 'placeholder', 'hint']
  }

  connectedCallback() {
    if (this._runner) return
    const runner = new MetaballSearchRunner(this._canvas)
    this._runner = runner
    const deviceDpr = window.devicePixelRatio || 1
    const dprAttr = this.getAttribute('dpr')
    runner.dpr = dprAttr
      ? Math.max(0.5, Math.min(deviceDpr, parseFloat(dprAttr) || deviceDpr, 2))
      : Math.min(deviceDpr, 2)

    const wp = this.getAttribute('wallpaper')
    if (wp) runner.wallpaper = wp
    const ph = this.getAttribute('placeholder')
    if (ph != null) this._input.placeholder = ph
    else this._input.placeholder = 'Search or Ask'
    const hint = this.getAttribute('hint')
    this._hint.textContent = hint != null ? hint : '从顶部黑边往下拖拽'

    runner.onCapsuleChange = (active, rect) => {
      if (active) {
        this._searchEl.style.left = rect.x + 'px'
        this._searchEl.style.top = rect.y + 'px'
        this._searchEl.style.width = rect.w + 'px'
        this._searchEl.style.height = rect.h + 'px'
        this._searchEl.style.opacity = '1'
        this._searchEl.style.pointerEvents = 'auto'
        // 只在凝聚瞬间 focus 一次；不每帧抢焦点（shadow DOM 里 activeElement
        // 可能不返回内部 input，每帧 focus 会打断用户输入）
        if (!this._capsuleWas) {
          this._capsuleWas = true
          try {
            this._input.focus()
          } catch {
            /* ignore */
          }
        }
        this._updateCaret(true)
      } else {
        this._capsuleWas = false
        this._searchEl.style.opacity = '0'
        this._searchEl.style.pointerEvents = 'none'
        this._caret.style.display = 'none'
      }
    }

    this._canvas.addEventListener('pointerdown', this._onDown)
    this._canvas.addEventListener('pointermove', this._onMove)
    this._canvas.addEventListener('pointerup', this._onUp)
    this._canvas.addEventListener('pointercancel', this._onUp)
    this._input.addEventListener('input', this._onInput)
    this._input.addEventListener('keydown', this._onKey)
    // 焦点状态用事件跟踪：shadow DOM 里 document.activeElement 不可靠
    this._input.addEventListener('focus', this._onInputFocus)
    this._input.addEventListener('blur', this._onInputBlur)
    window.addEventListener('keydown', this._onWinKey)

    const ro = new ResizeObserver(() => this._resize())
    ro.observe(this)
    this._ro = ro
    this._resize()
  }

  disconnectedCallback() {
    this._disposed = true
    if (this._ro) this._ro.disconnect()
    this._canvas.removeEventListener('pointerdown', this._onDown)
    this._canvas.removeEventListener('pointermove', this._onMove)
    this._canvas.removeEventListener('pointerup', this._onUp)
    this._canvas.removeEventListener('pointercancel', this._onUp)
    this._input.removeEventListener('input', this._onInput)
    this._input.removeEventListener('keydown', this._onKey)
    this._input.removeEventListener('focus', this._onInputFocus)
    this._input.removeEventListener('blur', this._onInputBlur)
    window.removeEventListener('keydown', this._onWinKey)
    if (this._runner) {
      this._runner.kill()
      this._runner = null
    }
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    if (!this._runner) return
    if (name === 'wallpaper') {
      if (val) this._runner.wallpaper = val
    } else if (name === 'dpr') {
      const dv = parseFloat(val || '0')
      const deviceDpr = window.devicePixelRatio || 1
      this._runner.dpr = dv > 0 ? Math.max(0.5, Math.min(deviceDpr, dv, 2)) : Math.min(deviceDpr, 2)
      this._resize()
    } else if (name === 'placeholder') {
      this._input.placeholder = val != null ? val : 'Search or Ask'
    } else if (name === 'hint') {
      this._hint.textContent = val != null ? val : '从顶部黑边往下拖拽'
      this._hint.style.opacity = val === '' ? '0' : ''
    }
  }

  private _resize() {
    const r = this.getBoundingClientRect()
    if (!r.width || !r.height) return
    this._w = r.width
    this._h = r.height
    this._canvas.style.width = r.width + 'px'
    this._canvas.style.height = r.height + 'px'
    this._runner?.resize(r.width, r.height)
    this._runner?.start()
  }

  private _localPos(e: PointerEvent) {
    const rect = this._canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private _onDown = (e: PointerEvent) => {
    // 点在搜索框（input/图标）上时，事件应落在 input 上；若穿透到 canvas
    // 也直接忽略，避免误触发收回
    const t = e.target as HTMLElement | null
    if (t && t.closest && t.closest('#search')) return
    if (this._runner?.capsuleActive) {
      // 胶囊已展开：点胶囊区域内聚焦 input（不收回），点外面才收回
      this._runner.onDown(this._localPos(e).x, this._localPos(e).y)
      const p = this._localPos(e)
      const c = this._runner.capsuleRect()
      if (Math.abs(p.x - c.x) <= c.w / 2 && Math.abs(p.y - c.y) <= c.h / 2) {
        try {
          this._input.focus()
        } catch {
          /* ignore */
        }
      }
      return
    }
    this._runner?.onDown(this._localPos(e).x, this._localPos(e).y)
    this._hint.style.opacity = '0'
    try {
      this._canvas.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  private _onMove = (e: PointerEvent) => {
    const p = this._localPos(e)
    this._runner?.onMove(p.x, p.y)
  }
  private _onUp = (e: PointerEvent) => {
    this._runner?.onUp()
    if (this._canvas.hasPointerCapture(e.pointerId)) {
      try {
        this._canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }
  private _onWinKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._runner?.capsuleActive) this._runner.retract()
  }
  private _onInput = () => {
    // 打字时光标常亮（苹果行为）：重启闪烁
    this._caret.style.animation = 'none'
    clearTimeout(this._caretReset)
    this._caretReset = window.setTimeout(() => {
      this._caret.style.animation = ''
    }, 80)
    this._updateCaret(true)
    this.dispatchEvent(
      new CustomEvent('lg-search', { detail: { text: this._input.value }, bubbles: true })
    )
  }
  private _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      this.dispatchEvent(
        new CustomEvent('lg-search-submit', { detail: { text: this._input.value }, bubbles: true })
      )
    }
  }
  private _onInputFocus = () => {
    this._inputFocused = true
    this._updateCaret(true)
  }
  private _onInputBlur = () => {
    this._inputFocused = false
    this._caret.style.display = 'none'
  }

  /** 调整渲染/弹簧参数：`el.setParams({ k: 80, om: 14 })`，只传想改的项。 */
  setParams(patch: Partial<MBParams>) {
    this._runner?.setParams(patch)
  }

  /** 读取当前搜索框文字。 */
  getValue(): string {
    return this._input.value
  }

  /** 写入搜索框文字（并触发 lg-search 事件）。 */
  setValue(text: string) {
    this._input.value = text
    this._updateCaret(true)
    this.dispatchEvent(
      new CustomEvent('lg-search', { detail: { text }, bubbles: true })
    )
  }

  // 发光光标：原生 caret 做不出辉光，量文本宽度自己画
  private _updateCaret(visible: boolean) {
    if (!visible || !this._inputFocused) {
      this._caret.style.display = 'none'
      return
    }
    if (!this._mctx) {
      const c = document.createElement('canvas')
      this._mctx = c.getContext('2d')
    }
    if (!this._mctx) return
    const cs = getComputedStyle(this._input)
    this._mctx.font = cs.font
    const padL = parseFloat(cs.paddingLeft) || 0
    const upto = this._input.value.slice(0, this._input.selectionStart ?? this._input.value.length)
    const x = this._input.offsetLeft + padL + this._mctx.measureText(upto).width
    this._caret.style.left = Math.min(x, this._input.offsetLeft + this._input.offsetWidth - 12) + 'px'
    this._caret.style.display = 'block'
  }
}

customElements.define('liquid-glass-search', LiquidGlassSearch)
