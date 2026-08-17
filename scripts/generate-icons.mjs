import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const iconsDirectory = path.resolve(scriptsDirectory, '..', 'public', 'icons')
const iconSizes = [16, 32, 48, 96, 128]
const supersampling = 4

const colors = {
  background: [23, 53, 47, 255],
  foreground: [247, 248, 241, 255],
  bookmark: [242, 106, 79, 255],
  transparent: [0, 0, 0, 0],
}

const jShape = [
  [34, 26],
  [94, 26],
  [94, 78],
  [92, 89],
  [88, 99],
  [81, 107],
  [72, 112],
  [62, 115],
  [51, 113],
  [41, 109],
  [33, 103],
  [27, 95],
  [24, 87],
  [44, 76],
  [48, 84],
  [53, 89],
  [60, 92],
  [66, 92],
  [71, 89],
  [74, 84],
  [75, 78],
  [75, 47],
  [34, 47],
]

const bookmarkShape = [
  [72, 26],
  [94, 26],
  [94, 58],
  [83, 51],
  [72, 58],
]

function isInsideRoundedRectangle(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius))
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius))
  const deltaX = x - closestX
  const deltaY = y - closestY
  return deltaX * deltaX + deltaY * deltaY <= radius * radius
}

function isInsidePolygon(x, y, points) {
  let inside = false
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current, current += 1
  ) {
    const [currentX, currentY] = points[current]
    const [previousX, previousY] = points[previous]
    const crosses = currentY > y !== previousY > y
    if (!crosses) continue
    const edgeX = ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
    if (x < edgeX) inside = !inside
  }
  return inside
}

function sampleIcon(x, y) {
  if (!isInsideRoundedRectangle(x, y, 4, 4, 124, 124, 28)) return colors.transparent
  if (isInsidePolygon(x, y, bookmarkShape)) return colors.bookmark
  if (isInsidePolygon(x, y, jShape)) return colors.foreground
  return colors.background
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const sampleCount = supersampling * supersampling

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      let alpha = 0
      let red = 0
      let green = 0
      let blue = 0

      for (let sampleY = 0; sampleY < supersampling; sampleY += 1) {
        for (let sampleX = 0; sampleX < supersampling; sampleX += 1) {
          const x = ((pixelX + (sampleX + 0.5) / supersampling) / size) * 128
          const y = ((pixelY + (sampleY + 0.5) / supersampling) / size) * 128
          const [sampleRed, sampleGreen, sampleBlue, sampleAlpha] = sampleIcon(x, y)
          alpha += sampleAlpha
          red += sampleRed * sampleAlpha
          green += sampleGreen * sampleAlpha
          blue += sampleBlue * sampleAlpha
        }
      }

      const offset = (pixelY * size + pixelX) * 4
      if (alpha > 0) {
        pixels[offset] = Math.round(red / alpha)
        pixels[offset + 1] = Math.round(green / alpha)
        pixels[offset + 2] = Math.round(blue / alpha)
      }
      pixels[offset + 3] = Math.round(alpha / sampleCount)
    }
  }

  return pixels
}

function createCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    return value >>> 0
  })
}

const crcTable = createCrcTable()

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6

  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let row = 0; row < size; row += 1) {
    const rowOffset = row * (size * 4 + 1)
    rows[rowOffset] = 0
    pixels.copy(rows, rowOffset + 1, row * size * 4, (row + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const svgPoints = (points) => points.map(([x, y]) => `${x},${y}`).join(' ')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-labelledby="title">
  <title id="title">JTab</title>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#17352f"/>
  <polygon points="${svgPoints(jShape)}" fill="#f7f8f1"/>
  <polygon points="${svgPoints(bookmarkShape)}" fill="#f26a4f"/>
</svg>
`

await mkdir(iconsDirectory, { recursive: true })
await writeFile(path.join(iconsDirectory, 'icon.svg'), svg)
for (const size of iconSizes) {
  await writeFile(path.join(iconsDirectory, `icon-${size}.png`), encodePng(size, renderIcon(size)))
}

stdout.write(`Generated JTab icons at ${iconSizes.join(', ')} px.\n`)
