# CLAUDE-SE PROMPT: Fix alignSelf Compliance in Code Generator System Prompt

> **Produced by**: Claude-PM
> **Date**: 2026-02-23
> **Spec**: CB-002-F5 (alignSelf hotfix)
> **Depends on**: Current F5 implementation (all CHANGE 1-6 from CLAUDE-SE-PROMPT-F5-OVERHAUL.md already implemented)

---

## Problem

The frontend correctly computes `alignSelf: "end"` on the Submit button node (confirmed via DevTools Network payload). However, the LLM (gpt-4o-mini via OpenRouter) **ignores the alignSelf field** and does not add `self-end` to the button's Tailwind className.

### Root Cause

The system prompt's button section gives **prescriptive, complete className strings** that the LLM copies verbatim:
```
sizeHint.width: "medium" → className="w-fit px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
```

The alignSelf rule lives in a **separate section** above (lines 473-478 of the spec). Small models like gpt-4o-mini are especially bad at combining rules from disconnected prompt sections — they see a complete className template and use it as-is without cross-referencing the alignSelf section.

### Fix Strategy

1. **Co-locate**: Add an explicit alignSelf reminder **inside** the button and input className rules — right where the LLM is looking when it generates those elements
2. **Concrete example**: Add a before/after example in the alignSelf section showing the class being appended to a real element
3. **Strengthen language**: Use "MANDATORY" and "MUST append" phrasing to make it harder for the model to skip

---

## CHANGE 1: Update system prompt in `ai-service/src/codeGenerator.ts`

### 1a. Strengthen the alignSelf section (lines 64-69 area of the current prompt)

Find this exact block in the SYSTEM_PROMPT string:

```
### Child alignment — obey alignSelf strictly
If a child node has an alignSelf field, apply the corresponding Tailwind class:
- alignSelf: "start" → self-start (default, rarely sent)
- alignSelf: "center" → self-center
- alignSelf: "end" → self-end
If alignSelf is absent, do not add any self-* class (the container's items-start default applies).
```

Replace with:

```
### Child alignment — MANDATORY, obey alignSelf strictly
If a child node has an alignSelf field, you MUST append the corresponding Tailwind class to that element's className:
- alignSelf: "start" → append self-start
- alignSelf: "center" → append self-center
- alignSelf: "end" → append self-end
If alignSelf is absent, do not add any self-* class.

EXAMPLE: A button with sizeHint.width "medium" and alignSelf "end" gets:
className="w-fit px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium self-end"
                                                                                                    ^^^^^^^^
The self-end class is APPENDED to the element's existing className. This applies to ALL element types (buttons, inputs, text, containers).
```

### 1b. Add alignSelf reminder inside the button rules

Find this exact block:

```
**When elementHint is "button"** (or elementHint is absent) → render as <button>:
- Use the label as button text
- **Button size is determined by sizeHint — obey strictly:**
  - sizeHint.width: "narrow" → small button: className="w-fit px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
  - sizeHint.width: "medium" → medium button: className="w-fit px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
  - sizeHint.width: "wide" → large full-width button: className="w-full px-6 py-3 text-lg bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
- IMPORTANT: narrow and medium buttons use w-fit so they do NOT stretch in flex-col containers. Only wide buttons use w-full.
```

Replace with:

```
**When elementHint is "button"** (or elementHint is absent) → render as <button>:
- Use the label as button text
- **Button size is determined by sizeHint — obey strictly:**
  - sizeHint.width: "narrow" → small button: className="w-fit px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
  - sizeHint.width: "medium" → medium button: className="w-fit px-4 py-2 text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
  - sizeHint.width: "wide" → large full-width button: className="w-full px-6 py-3 text-lg bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
- IMPORTANT: narrow and medium buttons use w-fit so they do NOT stretch in flex-col containers. Only wide buttons use w-full.
- **ALIGNMENT**: If the node has alignSelf, APPEND the self-* class (self-start, self-center, or self-end) to the className above. Example: a medium button with alignSelf "end" → className="w-fit px-4 py-2 ... font-medium self-end"
```

### 1c. Add alignSelf reminder inside the input rules

Find this exact block:

```
**When elementHint is "input"** → render as <input>:
- Use the inputType field as the HTML type attribute (e.g. inputType: "email" → type="email")
- Default styling: className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
- Use the label as placeholder text
```

Replace with:

```
**When elementHint is "input"** → render as <input>:
- Use the inputType field as the HTML type attribute (e.g. inputType: "email" → type="email")
- Default styling: className="border border-gray-300 rounded-lg px-4 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
- Use the label as placeholder text
- **ALIGNMENT**: If the node has alignSelf, APPEND the self-* class to the className above.
```

---

## Implementation Instructions

This is a single-file change — only `ai-service/src/codeGenerator.ts` needs to be modified. The three replacements above target specific sections within the `SYSTEM_PROMPT` template string constant.

**Steps:**
1. Open `ai-service/src/codeGenerator.ts`
2. Find the SYSTEM_PROMPT constant (starts at line 11)
3. Apply replacement 1a (strengthen alignSelf section)
4. Apply replacement 1b (add alignment reminder to button rules)
5. Apply replacement 1c (add alignment reminder to input rules)
6. Verify the file compiles: `cd ai-service && npx tsc --noEmit`

**No other files need changes** — the frontend already correctly computes and sends `alignSelf: "end"`. This fix is purely on the LLM prompt side.

---

## Verification

After deploying:
1. Draw a login form wireframe with Submit button positioned on the right side
2. Generate Code
3. In DevTools Network tab, confirm `alignSelf: "end"` is on the Submit node (should already work)
4. In the generated JSX output, confirm the Submit button has `self-end` in its className
5. The button should render right-aligned within the form
