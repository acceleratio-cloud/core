// Computes WCAG 2.x contrast for the token pairs the console depends on and
// fails when one drops below its threshold. Reads src/app/tokens.css only.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, "../src/app/tokens.css"), "utf8")

const rootBlock = css.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? ""
const tokens = new Map()
for (const [, name, value] of rootBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
  tokens.set(name, value.trim())
}

const resolve = (name, trail = []) => {
  if (trail.includes(name)) throw new Error(`Circular token: ${[...trail, name].join(" > ")}`)
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`Unknown token: --${name}`)
  const ref = value.match(/^var\(--([\w-]+)\)$/)
  return ref ? resolve(ref[1], [...trail, name]) : value
}

const toLinearRgb = (value, name) => {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!m) throw new Error(`--${name} is not a plain oklch() color: ${value}`)
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180]
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((x) => Math.max(0, Math.min(1, x)))
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const color = (name) => toLinearRgb(resolve(name), name)

const ratio = (fg, bg) => {
  const [hi, lo] = [luminance(color(fg)), luminance(color(bg))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = 4.5
const NON_TEXT = 3

const surfaces = [
  "surface-panel",
  "surface-board",
  "surface-canvas",
  "surface-sunken",
  "surface-raised",
  "surface-muted",
]
const pairs = [
  ...["fg-primary", "fg-secondary", "fg-tertiary"].flatMap((fg) =>
    surfaces.map((bg) => ({ fg, bg, min: TEXT, kind: "text" })),
  ),
  ...["brand", "status-success", "status-warning", "status-danger"].flatMap((fg) =>
    ["surface-panel", "surface-board", "surface-raised"].map((bg) => ({
      fg,
      bg,
      min: TEXT,
      kind: "text",
    })),
  ),
  { fg: "fg-on-brand", bg: "brand", min: TEXT, kind: "text" },
  { fg: "fg-on-brand", bg: "brand-hover", min: TEXT, kind: "text" },
  ...["surface-panel", "surface-board", "surface-sunken", "surface-raised"].flatMap((bg) => [
    { fg: "edge-control", bg, min: NON_TEXT, kind: "control border" },
    { fg: "brand", bg, min: NON_TEXT, kind: "focus ring" },
  ]),
]

const info = [
  ["surface-raised", "surface-board"],
  ["surface-raised", "surface-panel"],
  ["surface-panel", "surface-board"],
  ["surface-panel", "surface-canvas"],
  ["surface-muted", "surface-raised"],
  ["edge-default", "surface-raised"],
  ["edge-default", "surface-panel"],
  ["edge-default", "surface-canvas"],
]

let failures = 0
for (const { fg, bg, min, kind } of pairs) {
  const value = ratio(fg, bg)
  const ok = value >= min
  if (!ok) failures += 1
  console.log(
    `${ok ? "pass" : "FAIL"}  ${value.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg}  [${kind}]`,
  )
}

console.log("\nSteps (informational, no threshold):")
for (const [a, b] of info) {
  console.log(`      ${ratio(a, b).toFixed(3)}:1  ${a} vs ${b}`)
}

if (failures > 0) {
  console.error(`\n${failures} contrast pair(s) below threshold.`)
  process.exit(1)
}
console.log(`\nAll ${pairs.length} pairs pass.`)
