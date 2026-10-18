/** What a robot's face-screen can show. "offline" and "capped" replace the face (no signal; a spending gauge at its cap). */
export type Expression =
  | "neutral" | "happy" | "delighted" | "focused" | "thinking" | "surprised" | "sheepish"
  | "proud" | "worried" | "wistful" | "asleep" | "offline" | "capped" | "starry";

export const EXPRESSIONS: Expression[] = ["neutral", "happy", "delighted", "focused", "thinking", "surprised", "sheepish", "proud", "worried", "wistful", "asleep", "offline", "capped", "starry"];

/** Default face for a line, from its v4 delivery tag. Shots can override it. */
const BY_TAG: Record<string, Expression> = {
  cheerfully: "happy", brightly: "happy", relieved: "happy", warmly: "happy",
  delighted: "delighted", proudly: "proud", sheepishly: "sheepish", candidly: "thinking", alert: "surprised",
  "a little wistful": "wistful", wistfully: "wistful", wryly: "thinking",
  formally: "neutral", deadpan: "neutral", calmly: "neutral", patiently: "neutral", gently: "neutral",
};

export function expressionForText(text: string): Expression {
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const expression = BY_TAG[match[1]!.toLowerCase()];
    if (expression) return expression;
  }
  return "neutral";
}

/** Faces whose open mouth is a smile rather than an oval. */
export const SMILING = new Set<Expression>(["happy", "delighted", "proud", "starry"]);
