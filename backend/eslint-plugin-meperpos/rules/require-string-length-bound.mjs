/**
 * meperpos/require-string-length-bound
 *
 * What it forbids
 *   In a `*.dto.ts` file, a class property decorated with `@IsString()` that
 *   has neither `@MaxLength(...)` nor `@Length(...)`, unless another decorator
 *   on the same property already bounds the value's shape (see EXEMPT below).
 *   `@IsOptional()` does not exempt: an optional field is still unbounded when
 *   it is sent.
 *
 * Why
 *   Explorer finding F39: `UpdateOrganizationNameDto` accepted a 1000-character
 *   business name because it had `@IsString()` and no `@MaxLength`. An
 *   unbounded string reaches the database, receipts, PDFs and WhatsApp texts.
 *   See docs/bug-rule-log.md.
 *
 * Arrays
 *   `@IsString({ each: true })` is treated like `@IsString()`: every element
 *   needs a bound, so add `@MaxLength(n, { each: true })`. The rule does not
 *   check the `each` option of the bound; `@ArrayMaxSize` bounds the count,
 *   not the element length, and does not satisfy it.
 *
 * Exemptions (the other decorator already caps the length)
 *   `@IsEnum`, `@IsIn`, `@IsUUID`: closed value sets / fixed length.
 *   `@IsEmail`: validator.js caps an address at 254 characters.
 *   `@IsUrl`: validator.js caps a URL at 2084 characters.
 *   `@IsISO8601`, `@IsDateString`: a date format, parsed into a Date.
 *   `@IsValidPassword`: enforces PASSWORD_MAX_LENGTH (128).
 *   `@Matches(/^...$/)`: only when the pattern is a regex literal anchored at
 *   both ends with no unbounded quantifier (`*`, `+`, `{n,}`). `@Matches(/\S/)`
 *   (a non-blank check) or `@Matches(/^\d+$/)` still need a bound.
 *   `@IsNumberString` is NOT exempt: validator.js `isNumeric` has no length cap.
 *
 * How to fix
 *   @IsString()
 *   @MaxLength(100)
 *   name: string;
 */

const EXEMPT = new Set([
  'IsEnum',
  'IsIn',
  'IsUUID',
  'IsEmail',
  'IsUrl',
  'IsISO8601',
  'IsDateString',
  'IsValidPassword',
]);
const BOUNDS = new Set(['MaxLength', 'Length']);
const DTO_FILE = /\.dto\.ts$/;

/** Name of a `@Name(...)` or `@Name` decorator, or null. */
function decoratorName(decorator) {
  const expr = decorator.expression;
  if (expr?.type === 'CallExpression' && expr.callee.type === 'Identifier') {
    return expr.callee.name;
  }
  if (expr?.type === 'Identifier') return expr.name;
  return null;
}

/**
 * True when a regex source matches only strings of bounded length: anchored
 * with `^` and `$` and free of unbounded quantifiers outside character classes.
 */
export function isBoundedPattern(source) {
  if (!source.startsWith('^') || !source.endsWith('$') || source.endsWith('\\$')) {
    return false;
  }
  const stripped = source
    .replace(/\\./g, 'x') // escapes, e.g. \d \. \+
    .replace(/\[[^\]]*\]/g, 'x'); // character classes
  return !/[*+]|\{\d*,\}/.test(stripped);
}

/** True when `@Matches(...)` is given a bounded regex literal. */
function isBoundedMatches(decorator) {
  const pattern = decorator.expression?.arguments?.[0];
  return Boolean(
    pattern?.type === 'Literal' &&
      pattern.regex &&
      isBoundedPattern(pattern.regex.pattern),
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require @MaxLength or @Length on every @IsString() DTO property (F39).',
    },
    schema: [],
    messages: {
      missingLengthBound:
        '`{{name}}` is `@IsString()` without `@MaxLength` or `@Length`, so the API accepts a string of any length (F39). Add `@MaxLength(n)` (with `{ each: true }` for arrays) sized to the column or its consumer.',
    },
  },
  create(context) {
    if (!DTO_FILE.test(context.filename)) return {};
    return {
      PropertyDefinition(node) {
        const decorators = node.decorators ?? [];
        const isString = decorators.find(
          (d) => decoratorName(d) === 'IsString',
        );
        if (!isString) return;
        const bounded = decorators.some((d) => {
          const name = decoratorName(d);
          if (BOUNDS.has(name) || EXEMPT.has(name)) return true;
          return name === 'Matches' && isBoundedMatches(d);
        });
        if (bounded) return;
        const name =
          node.key.type === 'Identifier' ? node.key.name : 'property';
        context.report({
          node: isString,
          messageId: 'missingLengthBound',
          data: { name },
        });
      },
    };
  },
};

export default rule;
