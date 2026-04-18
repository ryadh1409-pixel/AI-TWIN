'use strict';

const {
  decisionAssistantJsonPrompts,
  startupAdvisorMarkdownPrompts,
} = require('./decisionEnginePrompts');

/**
 * @param {import('openai').default} openai
 * @param {string} model
 * @param {string} userInput
 * @returns {Promise<{ json: object, raw: string }>}
 */
async function runDecisionJson(openai, model, userInput) {
  const { system, user } = decisionAssistantJsonPrompts(userInput);
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.25,
    max_tokens: 2200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { parse_error: true, raw: raw.slice(0, 2000) };
  }
  return { json, raw };
}

/**
 * @param {import('openai').default} openai
 * @param {string} model
 * @param {string} userInput
 * @returns {Promise<{ markdown: string }>}
 */
async function runStartupAdvisorMarkdown(openai, model, userInput) {
  const { system, user } = startupAdvisorMarkdownPrompts(userInput);
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 3500,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const markdown = completion.choices?.[0]?.message?.content?.trim() || '';
  return { markdown };
}

module.exports = { runDecisionJson, runStartupAdvisorMarkdown };
