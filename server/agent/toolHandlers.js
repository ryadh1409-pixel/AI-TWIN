const { mergeProfile, getProfile, addReminder } = require("./memoryStore");
const { searchWeb } = require("./searchWeb");

let math = null;
function getMath() {
  if (!math) {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    math = require("mathjs");
  }
  return math;
}

/**
 * @param {string} userId
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
async function dispatchTool(userId, name, args) {
  switch (name) {
    case "search_web": {
      const query = String(args?.query || "").trim();
      const text = await searchWeb(query);
      return text;
    }
    case "save_memory": {
      const key = String(args?.key || "notes").trim() || "notes";
      const value = String(args?.value ?? "").trim();
      if (!value) return "Nothing to save.";
      const allowed = ["name", "job", "preferences", "notes"];
      const k = allowed.includes(key) ? key : "notes";
      const patch = { [k]: value };
      await mergeProfile(userId, patch);
      return `Saved to profile (${k}).`;
    }
    case "get_memory": {
      const p = await getProfile(userId);
      const { id, updatedAt, ...rest } = p;
      void id;
      void updatedAt;
      return JSON.stringify(rest, null, 2) || "{}";
    }
    case "send_reminder": {
      const text = String(args?.text || "").trim();
      const remindAtIso = String(args?.remind_at_iso || args?.remind_at || "").trim();
      if (!text || !remindAtIso) {
        return "Missing text or remind_at_iso.";
      }
      const out = await addReminder(userId, { text, remindAtIso });
      if (!out.ok) return `Could not save reminder: ${out.error || "unknown"}`;
      return `Reminder saved (id: ${out.id}).`;
    }
    case "calculate": {
      const expression = String(args?.expression || "").trim();
      if (!expression) return "Empty expression.";
      try {
        const m = getMath();
        const result = m.evaluate(expression);
        return String(result);
      } catch (e) {
        return `Calculation error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "Search the public web for current events, news, sports scores, weather, recent facts, or anything needing up-to-date information. Use for Arabic or English queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query in any language" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Persist an important fact about the user (name, job, preferences, or free-form notes).",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: ["name", "job", "preferences", "notes"],
            description: "Which profile field to update",
          },
          value: { type: "string", description: "Value to store" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_memory",
      description: "Read stored profile facts for this user.",
      parameters: {
        type: "object",
        properties: {
          unused: {
            type: "string",
            description: "Optional; leave empty to read the full profile.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_reminder",
      description: "Schedule a reminder at a specific date/time (ISO 8601).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Reminder text" },
          remind_at_iso: {
            type: "string",
            description: "When to remind, ISO 8601 e.g. 2026-04-18T15:00:00+03:00",
          },
        },
        required: ["text", "remind_at_iso"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Evaluate a mathematical expression safely (e.g. 2+2, sqrt(16), sin(pi/2)).",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression" },
        },
        required: ["expression"],
      },
    },
  },
];

module.exports = { dispatchTool, TOOL_DEFINITIONS };
