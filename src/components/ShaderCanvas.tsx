import { useEffect, useRef, useState, useCallback } from 'react'
import { Pane } from 'tweakpane'
import { halftoneCircleFragmentShader, defaultHalftoneCircleUniforms } from '../shaders/halftoneCircle'

const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 position;
out vec2 texCoord;
void main() {
  texCoord = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

const FRAG_SRC = `#version 300 es\n${halftoneCircleFragmentShader}`

interface Params {
  numSquares: number
  depth: number
  sizeByLuma: boolean
  fixedRadius: number
}

interface ShaderCanvasProps {
  /** List of asset URLs (images or videos) to cycle between. */
  assets?: string[]
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function isVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)$/i.test(url)
}

function createGradientTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createRadialGradient(size * 0.3, size * 0.3, 0, size / 2, size / 2, size * 0.75)
  grad.addColorStop(0, '#ff6b6b')
  grad.addColorStop(0.3, '#ffd93d')
  grad.addColorStop(0.6, '#6bcb77')
  grad.addColorStop(1, '#4d96ff')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return tex
}

function uploadSource(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
) {
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
}

/**
 * Full-screen WebGL2 canvas rendering the active shader with a Tweakpane overlay.
 * Drop any image or video onto the canvas, or use the Upload button in the panel.
 */
export function ShaderCanvas({ assets = [] }: ShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Blob URLs created from user uploads — revoked on unmount
  const blobUrlsRef = useRef<string[]>([])
  // Queued by file upload; consumed in the render loop (avoids re-running the GL effect)
  const pendingUploadRef = useRef<{ url: string; videoHint: boolean } | null>(null)

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = Array.from(files).find(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (!file) return
    const url = URL.createObjectURL(file)
    blobUrlsRef.current.push(url)
    pendingUploadRef.current = { url, videoHint: file.type.startsWith('video/') }
  }, [])

  // Drag-and-drop on the whole window
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true) }
    const onDragLeave = () => setIsDragging(false)
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      handleFiles(e.dataTransfer?.files ?? null)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleFiles])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2')
    if (!gl) {
      console.error('WebGL2 not supported')
      return
    }

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    if (!vert || !frag) return

    const program = gl.createProgram()!
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(program))
      return
    }

    // Fullscreen quad as triangle strip
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // --- Texture state ---
    let currentTexture: WebGLTexture = createGradientTexture(gl)
    let currentVideo: HTMLVideoElement | null = null
    const pendingRef = { url: assets.length > 0 ? assets[0] : null as string | null }

    function loadAsset(url: string, videoHint?: boolean) {
      const treatAsVideo = videoHint !== undefined ? videoHint : isVideo(url)
      if (treatAsVideo) {
        const vid = document.createElement('video')
        vid.src = url
        vid.loop = true
        vid.muted = true
        vid.playsInline = true
        vid.crossOrigin = 'anonymous'
        vid.addEventListener('canplay', () => {
          void vid.play()
          if (currentVideo) currentVideo.pause()
          currentVideo = vid
          uploadSource(gl!, currentTexture, vid)
        }, { once: true })
      } else {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = url
        img.onload = () => {
          currentVideo?.pause()
          currentVideo = null
          uploadSource(gl!, currentTexture, img)
        }
      }
    }

    if (pendingRef.url) {
      loadAsset(pendingRef.url)
      pendingRef.url = null
    }

    // Cache uniform locations
    gl.useProgram(program)
    const uTex = gl.getUniformLocation(program, 'tex')
    const uNumSquares = gl.getUniformLocation(program, 'numSquares')
    const uDepth = gl.getUniformLocation(program, 'Depth')
    const uAspectRatio = gl.getUniformLocation(program, 'aspectRatio')
    const uSizeByLuma = gl.getUniformLocation(program, 'sizeByLuma')
    const uFixedRadius = gl.getUniformLocation(program, 'fixedRadius')

    const params: Params = {
      numSquares: defaultHalftoneCircleUniforms.numSquares,
      depth: defaultHalftoneCircleUniforms.depth,
      sizeByLuma: defaultHalftoneCircleUniforms.sizeByLuma,
      fixedRadius: defaultHalftoneCircleUniforms.fixedRadius,
    }

    const pane = new Pane({ title: 'Halftone Circle' })
    pane.addBinding(params, 'numSquares', { label: 'Grid Density', min: 5, max: 1000, step: 1 })
    pane.addBinding(params, 'depth', { label: 'Depth', min: 1, max: 30, step: 1 })
    pane.addBinding(params, 'sizeByLuma', { label: 'Size by Luma' })
    pane.addBinding(params, 'fixedRadius', { label: 'Fixed Radius', min: 0.01, max: 0.5, step: 0.005 })

    if (assets.length > 0) {
      const assetOptions = [
        { text: 'Gradient (default)', value: '' },
        ...assets.map((url) => ({
          text: url.split('/').pop() ?? url,
          value: url,
        })),
      ]
      const assetParams = { asset: assets[0] }
      pane.addBinding(assetParams, 'asset', {
        label: 'Source',
        options: assetOptions.reduce<Record<string, string>>((acc, o) => {
          acc[o.text] = o.value
          return acc
        }, {}),
      }).on('change', ({ value }) => {
        if (value === '') {
          currentVideo?.pause()
          currentVideo = null
          gl.deleteTexture(currentTexture)
          currentTexture = createGradientTexture(gl)
        } else {
          pendingRef.url = value
        }
      })
    }

    pane.addButton({ title: 'Upload File' }).on('click', () => {
      fileInputRef.current?.click()
    })

    const resize = () => {
      canvas.width = window.innerWidth * devicePixelRatio
      canvas.height = window.innerHeight * devicePixelRatio
    }
    resize()
    window.addEventListener('resize', resize)

    let rafId: number
    const render = () => {
      // Consume pending asset switch from Tweakpane dropdown
      if (pendingRef.url) {
        loadAsset(pendingRef.url)
        pendingRef.url = null
      }

      // Consume pending upload from file input / drag-drop
      if (pendingUploadRef.current) {
        const { url, videoHint } = pendingUploadRef.current
        pendingUploadRef.current = null
        loadAsset(url, videoHint)
      }

      if (currentVideo && !currentVideo.paused && currentVideo.readyState >= 2) {
        uploadSource(gl, currentTexture, currentVideo)
      }

      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.useProgram(program)
      gl.bindVertexArray(vao)

      gl.uniform1i(uTex, 0)
      gl.uniform1f(uNumSquares, params.numSquares)
      gl.uniform1i(uDepth, params.depth)
      gl.uniform1f(uAspectRatio, canvas.height / canvas.width)
      gl.uniform1i(uSizeByLuma, params.sizeByLuma ? 1 : 0)
      gl.uniform1f(uFixedRadius, params.fixedRadius)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, currentTexture)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindVertexArray(null)

      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      pane.dispose()
      currentVideo?.pause()
      gl.deleteTexture(currentTexture)
      gl.deleteBuffer(buf)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
      gl.deleteShader(vert)
      gl.deleteShader(frag)
    }
  }, [assets])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block' }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={e => {
          handleFiles(e.target.files)
          // Reset so the same file can be re-selected
          e.target.value = ''
        }}
      />
      {isDragging && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            border: '3px dashed rgba(255,255,255,0.6)',
            pointerEvents: 'none',
            zIndex: 100,
          }}
        >
          <p style={{ color: '#fff', fontSize: '1.5rem', fontFamily: 'sans-serif', margin: 0 }}>
            Drop image or video
          </p>
        </div>
      )}
    </>
  )
}
