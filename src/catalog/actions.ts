import { z } from 'zod'

// What a click in the window can do. Every action other than the built-in state ones becomes a message to the agent
// (or a host operation) and is delivered through the daemon.
export const actions = {
  send: {
    params: z.object({ text: z.string().describe('The message the user sends to the agent when they click'), to: z.string().optional().describe('Tag of the agent that receives it, from its event lines') }),
    description:
      'Send a message to a coding agent as if the user had typed it, e.g. {"action":"send","params":{"text":"继续","to":"a1b2c3"}}. The agent receives it at its next tool call or prompt. Use for choices, approvals, "continue", follow-up requests.'
  },
  open_url: {
    params: z.object({ url: z.string().describe('http(s) URL') }),
    description: 'Open a web link in the default browser.'
  },
  copy: {
    params: z.object({ text: z.string() }),
    description: 'Copy text to the clipboard.'
  }
}
