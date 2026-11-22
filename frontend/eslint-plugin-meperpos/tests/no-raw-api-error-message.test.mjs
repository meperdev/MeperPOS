import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import nextTs from "eslint-config-next/typescript";
import rule from "../rules/no-raw-api-error-message.mjs";

// Route RuleTester's suites through node:test so `node --test` reports them.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// Parse fixtures with the same TypeScript parser the real config uses, taken
// from eslint-config-next so no transitive package is imported directly.
const parser = nextTs.find((config) => config.languageOptions?.parser)
  ?.languageOptions.parser;

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-raw-api-error-message", rule, {
  valid: [
    {
      name: "the canonical funnel",
      code: `
        try {
          await api.createProduct(payload);
        } catch (error: unknown) {
          toast.error(getApiErrorMessage(error, "No se pudo crear el producto"));
        }
      `,
    },
    {
      name: "reading a non-message field of the body stays allowed",
      code: `const body = error.response.data as { status?: unknown } | undefined;`,
    },
    {
      name: "an unrelated message property",
      code: `const text = event.data.message;`,
    },
  ],
  invalid: [
    {
      name: "plain member access",
      code: `toast.error(error.response.data.message);`,
      errors: [{ messageId: "useGetApiErrorMessage" }],
    },
    {
      name: "optional chaining with a fallback",
      code: `
        const message =
          (error as AxiosError<{ message: string }>).response?.data?.message ??
          "Error";
      `,
      errors: [{ messageId: "useGetApiErrorMessage" }],
    },
    {
      name: "computed string key",
      code: `setError(err.response?.data?.["message"]);`,
      errors: [{ messageId: "useGetApiErrorMessage" }],
    },
    {
      name: "destructuring the message out of the body",
      code: `const { message } = error.response?.data;`,
      errors: [{ messageId: "useGetApiErrorMessage" }],
    },
  ],
});
