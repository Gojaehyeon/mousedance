'use strict'

// ─────────────────────────────────────────────────────────────
// 설정값 (취향껏 조절)
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  // 가능한 영상 파일 이름 후보 (순서대로 시도)
  sources: ['mouse.webm', 'mouse.mov', 'mouse.mp4', 'mouse.m4v'],

  // 크로마키 (그린스크린 제거)
  keySimilarity: 0.10, // 이 값보다 "초록"이면 완전 투명 시작
  keySmooth: 0.16,     // 가장자리 부드럽게 번지는 폭
  despill: 0.9,        // 가장자리 초록 번짐 제거 강도 (0~1)

  // 춤 속도
  idleRate: 1.0,       // 가만히 있을 때 재생 속도
  maxRate: 3.2,        // 타자 폭발할 때 최고 속도
  keysForMax: 8,       // 최근 1.5초간 이만큼 치면 최고 속도
  decayPerSec: 4.0,    // 타자 멈추면 초당 이만큼 "타격 점수" 감소
  rateLerp: 0.12       // 속도 변화 부드럽게 (0~1, 클수록 즉각적)
}

// ─────────────────────────────────────────────────────────────
// 영상 로드 (후보를 순서대로 시도)
// ─────────────────────────────────────────────────────────────
const video = document.getElementById('src')
let srcIndex = 0

function tryNextSource () {
  if (srcIndex >= CONFIG.sources.length) {
    console.error('[mousedance] 영상 파일을 찾지 못했습니다. 프로젝트 폴더에 ' +
      CONFIG.sources.join(' 또는 ') + ' 중 하나를 넣어주세요.')
    return
  }
  video.src = CONFIG.sources[srcIndex++]
}
video.addEventListener('error', tryNextSource)
video.addEventListener('loadeddata', () => {
  video.play().catch(() => {})
})
tryNextSource()

// ─────────────────────────────────────────────────────────────
// WebGL 크로마키 셰이더
// ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('stage')
const gl = canvas.getContext('webgl', {
  premultipliedAlpha: false,
  alpha: true,
  preserveDrawingBuffer: true // mousemove 시 readPixels 히트테스트가 동작하려면 필수
})

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2((aPos.x + 1.0) * 0.5, 1.0 - (aPos.y + 1.0) * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uSimilarity;
uniform float uSmooth;
uniform float uDespill;
void main() {
  vec4 c = texture2D(uTex, vUv);
  // "초록 정도": 초록이 빨강/파랑보다 얼마나 강한가
  float g = c.g - max(c.r, c.b);
  // g가 클수록(=초록) 투명. smoothstep으로 가장자리 부드럽게.
  float keyed = smoothstep(uSimilarity, uSimilarity + uSmooth, g);
  float alpha = 1.0 - keyed;
  // 디스필: 반투명 가장자리의 초록 번짐 제거
  float spill = max(0.0, c.g - mix(c.r, c.b, 0.5));
  c.g -= spill * keyed * uDespill;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(c.rgb, alpha);
}`

function compile (type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('shader 컴파일 실패:', gl.getShaderInfoLog(s))
  }
  return s
}

const prog = gl.createProgram()
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(prog)
gl.useProgram(prog)

const quad = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, quad)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1, 1, -1, -1, 1,
  -1, 1, 1, -1, 1, 1
]), gl.STATIC_DRAW)
const aPos = gl.getAttribLocation(prog, 'aPos')
gl.enableVertexAttribArray(aPos)
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

const tex = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, tex)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

gl.uniform1f(gl.getUniformLocation(prog, 'uSimilarity'), CONFIG.keySimilarity)
gl.uniform1f(gl.getUniformLocation(prog, 'uSmooth'), CONFIG.keySmooth)
gl.uniform1f(gl.getUniformLocation(prog, 'uDespill'), CONFIG.despill)

gl.enable(gl.BLEND)
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
gl.clearColor(0, 0, 0, 0)

function resize () {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(window.innerWidth * dpr)
  const h = Math.round(window.innerHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
    gl.viewport(0, 0, w, h)
  }
}
window.addEventListener('resize', resize)

// ─────────────────────────────────────────────────────────────
// 타자 → 춤 속도
// ─────────────────────────────────────────────────────────────
let energy = 0            // 누적 "타격 점수"
let currentRate = CONFIG.idleRate
let lastTs = performance.now()

window.api.onKeystroke(() => {
  energy = Math.min(energy + 1, CONFIG.keysForMax * 1.5)
})

function updateRate (dt) {
  energy = Math.max(0, energy - CONFIG.decayPerSec * dt)
  const t = Math.min(1, energy / CONFIG.keysForMax)
  const target = CONFIG.idleRate + (CONFIG.maxRate - CONFIG.idleRate) * t
  currentRate += (target - currentRate) * CONFIG.rateLerp
  if (video.readyState >= 2 && Math.abs(video.playbackRate - currentRate) > 0.01) {
    try { video.playbackRate = currentRate } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────
// 렌더 루프
// ─────────────────────────────────────────────────────────────
function frame (now) {
  const dt = Math.min(0.1, (now - lastTs) / 1000)
  lastTs = now
  resize()
  updateRate(dt)

  gl.clear(gl.COLOR_BUFFER_BIT)
  if (video.readyState >= 2 && video.videoWidth > 0) {
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    } catch (_) {}
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// ─────────────────────────────────────────────────────────────
// 클릭 통과 + 드래그
//  - 투명 픽셀 위에서는 클릭이 뒤 앱으로 통과
//  - 쥐(불투명) 위에서는 잡아서 끌 수 있음
// ─────────────────────────────────────────────────────────────
let interactive = false   // 현재 마우스 이벤트를 받는 상태인가
let dragging = false

function alphaAt (clientX, clientY) {
  // 캔버스 픽셀 좌표 (WebGL은 좌하단 원점)
  const dpr = window.devicePixelRatio || 1
  const x = Math.floor(clientX * dpr)
  const y = Math.floor((window.innerHeight - clientY) * dpr)
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 0
  const px = new Uint8Array(4)
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  return px[3]
}

window.__hitTest = alphaAt // 디버그/검증용 (무해)

function onMove (e) {
  if (dragging) return
  const over = alphaAt(e.clientX, e.clientY) > 24
  if (over && !interactive) {
    interactive = true
    window.api.setIgnore(false)   // 창을 상호작용 가능 상태로
  } else if (!over && interactive) {
    interactive = false
    window.api.setIgnore(true)    // 다시 클릭 통과
  }
}
window.addEventListener('mousemove', onMove)

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (alphaAt(e.clientX, e.clientY) > 24) {
    dragging = true
    document.body.style.cursor = 'grabbing'
    window.api.dragStart()
  }
})
window.addEventListener('mouseup', () => {
  if (!dragging) return
  dragging = false
  document.body.style.cursor = 'default'
  window.api.dragEnd()
})
