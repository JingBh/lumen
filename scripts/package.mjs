// Package Lumen.app into out/: yarn package
import { packager } from '@electron/packager'

const [dir] = await packager({
  dir: '.',
  name: 'Lumen',
  out: 'out',
  overwrite: true,
  asar: true,
  appBundleId: 'dev.lumen.app',
  appCategoryType: 'public.app-category.developer-tools',
  // An agent app: no Dock icon, the menu bar is its way back.
  extendInfo: { LSUIElement: true },
  // The build bundles everything the app runs into dist/ and web/.
  ignore: [/^\/(src|scripts|plugin|out|node_modules|\.yarn)(\/|$)/, /^\/(tsconfig\.json|yarn\.lock|\.yarnrc\.yml|\.editorconfig|\.gitignore)$/]
})
console.log(`packaged ${dir}`)
