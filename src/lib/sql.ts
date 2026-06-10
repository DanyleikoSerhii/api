// Escape LIKE/ILIKE wildcards (`%`, `_`) and the escape character itself so
// user-supplied substrings match literally. Use together with an escape clause
// where supported, otherwise it relies on the default PostgreSQL `\` escape.
export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/[%_]/g, (m) => '\\' + m);
}
