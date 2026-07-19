import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { parseActionBlock, normalizeAction } from './parseAction.js';
import { assembleMessages } from '../prompts/assemble.js';

const NUDGE = 'Your previous response did not include a valid ```action fenced block. Please fix your action block and re-emit your answer ending with an action block. Output ONLY the action block, e.g.:\n```action\n{"kind":"pass"}\n```';

// ActionLLM wraps a LangChain-style chatModel (ChatMiniMax or MockChatLLM) and
// implements the same `generate({ session, prompt })` interface as the
// PassThroughLLM that the BotSession consumes. The orchestrator:
//   1. Assembles messages from the prompt builder (Phase 5 swaps in real blocks).
//   2. Calls the chat model.
//   3. Parses the response; on failure retries once with a single "fix your
//      action block" nudge.
//   4. On second failure, the bot passes the turn (per spec: "if parsing fails
//      the manager retries once with a 'fix your action block' nudge; if it
//      still fails, the bot passes the turn").
export class ActionLLM {
  constructor({ chatModel, promptBuilder = assembleMessages, maxRetries = 1 } = {}) {
    if (!chatModel) throw new Error('ActionLLM requires chatModel');
    this._chat = chatModel;
    this._promptBuilder = promptBuilder;
    this._maxRetries = Math.max(0, Number(maxRetries) | 0);
    this._label = 'actionLLM';
  }

  async generate({ session, prompt } = {}) {
    let { system, history, user } = this._promptBuilder({ session, prompt });
    if (typeof system !== 'string') system = system?.content || '';
    const messages = [new SystemMessage(system)];
    for (const h of (history || [])) {
      if (h && typeof h.role === 'string' && (h.role === 'user' || h.role === 'assistant')) {
        messages.push(h.role === 'assistant' ? new AIMessage(h.content) : new HumanMessage(h.content));
      } else if (h && typeof h.content === 'string') {
        messages.push(new HumanMessage(h.content));
      } else if (h && h.content !== undefined) {
        messages.push(new HumanMessage(String(h.content)));
      }
    }
    messages.push(new HumanMessage(user));

    const attempts = this._maxRetries + 1; // initial + retries
    let lastText = '';
    for (let i = 0; i < attempts; i++) {
      let response;
      try {
        response = await this._chat.invoke(messages);
      } catch (e) {
        console.warn(`[actionLLM] chat.invoke failed (attempt ${i + 1}/${attempts}):`, e.message);
        break;
      }
      const text = response?.content ?? response?.text ?? '';
      lastText = String(text);
      const parsed = parseActionBlock(lastText);
      const action = parsed ? normalizeAction(parsed) : null;
      if (action) {
        if (action.kind !== 'pass' && session?.tokensUsed !== undefined) {
          session.tokensUsed += Math.ceil(lastText.length / 4);
        }
        return action;
      }
      // Cancel any prior nudge; only the first retry sails through.
      if (i < attempts - 1) {
        messages.push(new AIMessage(lastText));
        messages.push(new HumanMessage(NUDGE));
      }
    }
    return { kind: 'pass' };
  }
}