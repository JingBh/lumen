import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'

const common = { bundle: true, sourcemap: true, logLevel: 'warning' }
const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }

// Self-hosted fonts: the variable families Lumen was designed with, latin subsets only, and MiSans for Chinese.
const fonts = async () => {
  await mkdir('web/fonts', { recursive: true })
  const css = []
  for (const [pkg, from, to] of [['instrument-sans', 'Instrument Sans Variable', 'Instrument Sans'], ['martian-mono', 'Martian Mono Variable', 'Martian Mono']]) {
    const dir = `node_modules/@fontsource-variable/${pkg}`
    const faces = (await readFile(`${dir}/standard.css`, 'utf8')).split('/* ').slice(1).filter((f) => /^(instrument-sans|martian-mono)-latin(-ext)?-standard-normal/.test(f))
    for (const face of faces) {
      const file = face.match(/url\(\.\/files\/([^)]+)\)/)[1]
      await cp(`${dir}/files/${file}`, `web/fonts/${file}`)
      css.push(`/* ${face}`.replaceAll(from, to).replace('./files/', './'))
    }
  }
  // MiSans comes as one variable font split into ranges, each loaded only when a page uses its characters. Its CSS gives
  // no weight range, which would leave every weight but the default faked.
  const cjk = 'node_modules/misans-vf/lib'
  await mkdir('web/fonts/misans', { recursive: true })
  for (const file of (await readdir(cjk)).filter((f) => f.endsWith('.woff2'))) await cp(`${cjk}/${file}`, `web/fonts/misans/${file}`)
  css.push((await readFile(`${cjk}/MiSans.min.css`, 'utf8')).replaceAll('url("', 'url("./misans/').replaceAll('font-display:swap;', 'font-display:swap;font-weight:150 700;'))
  await writeFile('web/fonts/fonts.css', css.join('\n'))
}

// Component groups live in web/kit/<group>.js|css; the pages load the concatenation.
const kit = async () => {
  const files = (await readdir('web/kit')).sort()
  const cat = async (ext) => (await Promise.all(files.filter((f) => f.endsWith(ext)).map(async (f) => `/* ${f} */\n${await readFile(`web/kit/${f}`, 'utf8')}`))).join('\n')
  await writeFile('web/kit.js', await cat('.js'))
  await writeFile('web/kit.css', await cat('.css'))
}

// Dev runs (the app, screenshots) start Electron's own bundle: mark it an agent app so no launch puts an icon in the dock.
const agentApp = () => {
  if (process.platform !== 'darwin') return
  const plist = 'node_modules/electron/dist/Electron.app/Contents/Info.plist'
  try {
    execFileSync('plutil', ['-extract', 'LSUIElement', 'raw', plist], { stdio: 'ignore' })
  } catch {
    execFileSync('plutil', ['-replace', 'LSUIElement', '-bool', 'YES', plist])
  }
}

agentApp()
await Promise.all([
  fonts(),
  kit(),
  build({ ...common, entryPoints: ['src/renderer/core.ts'], outfile: 'web/vendor/json-render-core.js', format: 'iife', globalName: 'JsonRenderCore', platform: 'browser', minify: true }),
  build({ ...node, entryPoints: { index: 'src/main/index.ts', preload: 'src/main/preload.ts' }, outdir: 'dist/main' }).catch((e) => {
    if (!/Could not resolve/.test(String(e))) throw e
    console.warn('main process not built yet')
  })
])
