import { z } from 'zod'
import { defineComponents } from './common'

const lang = z.enum(['js', 'ts', 'py', 'go', 'rust', 'java', 'c', 'sh', 'json', 'yaml', 'toml', 'sql', 'css', 'html', 'diff', 'text'])

export const components = defineComponents({
  Snippet: {
    props: z.object({
      code: z.string().describe('The source text, up to about 40 lines (hard limit 4000 characters)'),
      lang: lang.optional().describe('Syntax to highlight; omit or "text" for plain'),
      title: z.string().optional().describe('File path or a short caption, shown in the header'),
      startLine: z.number().int().min(1).optional().describe('Line number of the first line (default 1), so the gutter matches the real file'),
      highlight: z.array(z.number().int()).max(40).optional().describe('Line numbers to emphasise, counted from startLine'),
      wrap: z.boolean().optional().describe('Wrap long lines instead of scrolling sideways')
    }),
    slots: [],
    description:
      'Source code or a config file excerpt with a line-number gutter and syntax highlighting: the code the agent is reading, writing or about to change. Point at the important lines with highlight. Do NOT use it for a command and its output (use Terminal), for what changed between two versions (use Diff), for a tiny snippet or a log line (use Code), or for structured data you want to browse (use JsonTree).',
    example: { title: 'src/server.ts', lang: 'ts', startLine: 12, code: 'export const port = Number(process.env.PORT ?? 8080)\nserver.listen(port)', highlight: [13] }
  },
  Diff: {
    props: z.object({
      patch: z.string().optional().describe('A unified diff (git diff output), possibly of several files; takes precedence over before/after'),
      path: z.string().optional().describe('File name shown in the header when diffing before/after (or when the patch has no headers)'),
      before: z.string().optional().describe('Old text of one file; with after, the diff is computed for you (empty = new file)'),
      after: z.string().optional().describe('New text of the same file (empty = deleted file)')
    }),
    slots: [],
    description:
      'What changed in one or more files: per-file header with +added −removed counts, line numbers, hunks, unchanged stretches folded, and side-by-side when the panel is wide. Pass a unified `patch` (best for several files) or `before` + `after` for one file. Use it for edits the agent made or proposes, not for showing a file as it is (use Snippet) or the list of touched files (use FileTree). Keep the patch short (under 4000 characters); show only the hunks that matter.',
    example: { path: 'src/a.ts', before: 'const a = 1\nconst b = 2\n', after: 'const a = 1\nconst b = 3\n' }
  },
  FileTree: {
    props: z.object({
      items: z
        .array(
          z.object({
            path: z.string().describe('Slash separated path; folders are built from it'),
            status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untouched']).optional(),
            note: z.string().optional().describe('Short grey remark after the name, e.g. "from old/name.ts"'),
            additions: z.number().int().min(0).optional(),
            deletions: z.number().int().min(0).optional()
          })
        )
        .max(300),
      collapse: z.boolean().optional().describe('Start with folders closed')
    }),
    slots: [],
    description:
      'The files a task touched (or a project layout) as a collapsible folder tree: change status letter A/M/D/R, +/− counts, and a summary line. Give flat paths, the tree is built for you. Use it for "which files did the agent change" and for a short project map; use Table for non-file data and Diff for the content of the changes.',
    example: { items: [{ path: 'src/a.ts', status: 'modified', additions: 4, deletions: 1 }, { path: 'src/lib/b.ts', status: 'added', additions: 20 }, { path: 'README.md' }] }
  },
  Terminal: {
    props: z.object({
      command: z.string().describe('The command line as typed'),
      output: z.string().optional().describe('Combined stdout/stderr so far (up to 4000 characters, keep the end of it); basic ANSI colours are rendered'),
      exitCode: z.number().int().optional().describe('Exit status once the command has finished; omit while it runs'),
      running: z.boolean().optional().describe('The command is still running: shows a live caret and keeps the view at the newest line'),
      cwd: z.string().optional().describe('Working directory, shown muted above the command'),
      durationMs: z.number().min(0).optional().describe('Elapsed or total time in ms'),
      maxLines: z.number().int().min(1).max(200).optional().describe('Output lines to keep from the end (default 30)')
    }),
    slots: [],
    description:
      'One shell command as a card: prompt line, its output, a green/red exit badge and the duration, or a running state. The output is cut to its last lines. Use it for tests, builds, git and kubectl runs, one card per command. Do NOT use it for source code (use Snippet), for structured results (use Table or JsonTree), or for a stream of agent events (use Log).',
    example: { command: 'yarn test', cwd: '~/src/lumen', output: '12 passed', exitCode: 0, durationMs: 4380 }
  },
  JsonTree: {
    props: z.object({
      value: z.any().describe('Any JSON value; nesting deeper than 8 levels is dropped'),
      expand: z.number().int().min(0).max(8).optional().describe('How many levels start open (default 1: the top level only)'),
      maxItems: z.number().int().min(1).max(200).optional().describe('Entries shown per object or array (default 30)')
    }),
    slots: [],
    description:
      'A collapsible JSON viewer with type-coloured values, array lengths and a one-line preview of closed nodes. Use it for a config, an API response or an object the agent inspected, where the reader needs to open and close parts. Prefer KeyValue for a handful of flat facts, Table for a list of similar rows, and Snippet (lang json) when the exact text matters.',
    example: { expand: 1, value: { name: 'lumen', ports: [8080, 8443], debug: false, limits: { cpu: '500m' } } }
  }
})
