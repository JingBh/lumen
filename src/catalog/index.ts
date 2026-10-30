import { defineCatalog } from '@json-render/core'
import { actions } from './actions'
import { components as agent } from './agent'
import { components as charts } from './charts'
import { components as code } from './code'
import { components as controls } from './controls'
import { components as core } from './core'
import { components as graph } from './graph'
import { components as layout } from './layout'
import { schema } from './schema'
import { components as status } from './status'
import { components as text } from './text'

export const components = { ...core, ...agent, ...charts, ...code, ...controls, ...graph, ...layout, ...status, ...text }

export const catalog = defineCatalog(schema, { components, actions })
