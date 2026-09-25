/**
 * What a caught value says, as a string.
 *
 * `catch` hands back `unknown`, and a template literal cannot take that: the plugin
 * reported "Modelica: the figure could not be saved — [object Object]" more than once,
 * and the plugin directory's linter rejects the short form
 * (`err instanceof Error ? err.message : err`) everywhere it appears because the
 * fallback is `unknown` rather than text.
 *
 * The order matters. An `Error` carries the message a reader needs. A thrown string is
 * already what someone meant to say — OpenModelica fails that way, with its compiler
 * output as the whole value. Anything else is stringified, and if it cannot be (a
 * cyclic object, a Proxy that throws on inspection), its type is still worth printing.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch {
    /* fall through: not everything can be serialised, and that is not an error here */
  }
  return Object.prototype.toString.call(err);
}
