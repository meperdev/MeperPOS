/**
 * meperpos/no-raw-api-error-message
 *
 * What it forbids
 *   Reading an Axios error body's message by hand:
 *     error.response.data.message, error.response?.data?.message,
 *     error.response?.data?.["message"], and
 *     const { message } = error.response.data
 *
 * Why
 *   The backend's global ValidationPipe answers a class-validator failure with
 *   `message: string[]`, other errors put the text under `error`, and a network
 *   failure has no `response` at all. Reading the field raw shows the user an
 *   array, an empty toast or `undefined`. `getApiErrorMessage(error, fallback)`
 *   in src/lib/api.ts is the single funnel that joins arrays, trims, ignores
 *   non-string payloads and falls back to a Spanish message (AGENTS.md, "Key
 *   Conventions").
 *
 * How to fix
 *   import { getApiErrorMessage } from "@/lib/api";
 *   toast.error(getApiErrorMessage(error, "No se pudo guardar el producto"));
 *
 *   Use getApiErrorDetails(error, fallback) when you also need `code` or
 *   `requestId`. Inside src/lib/api.ts the funnel reads the body once into a
 *   local (`data?.message`), which this rule does not flag.
 */

/** Static property name of a member access, or null when computed. */
function propertyName(node) {
  if (node.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (node.computed && node.property.type === "Literal") {
    return String(node.property.value);
  }
  return null;
}

/** True for `<anything>.response.data` (optional chaining included). */
function isResponseData(node) {
  return (
    propertyName(node) === "data" &&
    propertyName(node.object) === "response"
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Read API error text through getApiErrorMessage instead of error.response.data.message.",
    },
    schema: [],
    messages: {
      useGetApiErrorMessage:
        "Do not read `response.data.message` by hand: it can be a string[] (ValidationPipe), live under `error`, or be missing. Use getApiErrorMessage(error, fallback) from @/lib/api.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (propertyName(node) === "message" && isResponseData(node.object)) {
          context.report({ node, messageId: "useGetApiErrorMessage" });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init) return;
        const init =
          node.init.type === "ChainExpression" ? node.init.expression : node.init;
        if (!isResponseData(init)) return;
        const takesMessage = node.id.properties.some(
          (property) =>
            property.type === "Property" &&
            !property.computed &&
            property.key.type === "Identifier" &&
            property.key.name === "message",
        );
        if (takesMessage) {
          context.report({ node: node.id, messageId: "useGetApiErrorMessage" });
        }
      },
    };
  },
};

export default rule;
