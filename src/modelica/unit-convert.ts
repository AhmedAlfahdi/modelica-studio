/**
 * The other units a value can be shown and typed in.
 *
 * A Modelica parameter's value is always in its DECLARED unit: `p_ambient = 101325` is
 * 101325 Pa, and no UI can change that without changing what the model means. What a reader
 * wants is the other direction — to read and type it as `1.01325 bar` — so this converts a
 * value for the field and back again, and the number stored in the model never moves.
 *
 * The table is curated rather than derived, deliberately. `Modelica.Units` is a hierarchy of
 * a few hundred types and its `NonSI` package holds the conversions, but pulling them in at
 * run time would mean parsing the library to answer a question about one field, and the units
 * a reader actually switches between are a short list: bar beside pascals, °C beside kelvin,
 * km/h beside m/s. Every factor here is exact except the degrees, where the conversion is a
 * ratio of π and no decimal is.
 *
 * Affine units are why an entry carries an OFFSET and not only a factor: 0 °C is 273.15 K, so
 * scaling alone would report 0 K. That also means the plot cannot simply relabel an axis in
 * °C — a curve would be shifted, not rescaled — which is why this is offered for a field
 * where one value is read at a time.
 */

/** How to read and write a value in one unit, against the model's own. */
export interface UnitChoice {
  /** The symbol as it is shown and typed: `bar`, `°C`, `km/h`. */
  symbol: string;
  /** `value_in_base = value * factor + offset`, with the offset absent when it is 0. */
  factor: number;
  offset?: number;
  /** Not the model's own unit, so the field can mark that it is showing another one. */
  alternative?: boolean;
}

/**
 * The alternatives, keyed by the unit string the COMPILER writes.
 *
 * `m/s2`, `N.s/m`, `J/(kg.K)` — not the pretty spellings the interface shows. The key is
 * what arrives in the model description, and the symbol is what the reader sees.
 */
const TABLE: Record<string, UnitChoice[]> = {
  Pa: [
    { symbol: "bar", factor: 1e5, alternative: true },
    { symbol: "mbar", factor: 100, alternative: true },
    { symbol: "hPa", factor: 100, alternative: true },
    { symbol: "kPa", factor: 1e3, alternative: true },
    { symbol: "MPa", factor: 1e6, alternative: true },
  ],
  K: [
    { symbol: "°C", factor: 1, offset: 273.15, alternative: true },
    { symbol: "°F", factor: 5 / 9, offset: 459.67 * (5 / 9), alternative: true },
  ],
  m: [
    { symbol: "mm", factor: 1e-3, alternative: true },
    { symbol: "cm", factor: 1e-2, alternative: true },
    { symbol: "km", factor: 1e3, alternative: true },
  ],
  kg: [
    { symbol: "g", factor: 1e-3, alternative: true },
    { symbol: "t", factor: 1e3, alternative: true },
  ],
  "m/s": [{ symbol: "km/h", factor: 1 / 3.6, alternative: true }],
  "m/s2": [{ symbol: "g", factor: 9.80665, alternative: true }],
  s: [
    { symbol: "ms", factor: 1e-3, alternative: true },
    { symbol: "min", factor: 60, alternative: true },
    { symbol: "h", factor: 3600, alternative: true },
  ],
  rad: [{ symbol: "deg", factor: Math.PI / 180, alternative: true }],
  A: [
    { symbol: "mA", factor: 1e-3, alternative: true },
    { symbol: "kA", factor: 1e3, alternative: true },
  ],
  V: [
    { symbol: "mV", factor: 1e-3, alternative: true },
    { symbol: "kV", factor: 1e3, alternative: true },
  ],
  Ohm: [
    { symbol: "mΩ", factor: 1e-3, alternative: true },
    { symbol: "kΩ", factor: 1e3, alternative: true },
    { symbol: "MΩ", factor: 1e6, alternative: true },
  ],
  N: [{ symbol: "kN", factor: 1e3, alternative: true }],
  "N/m": [{ symbol: "kN/m", factor: 1e3, alternative: true }],
  J: [
    { symbol: "kJ", factor: 1e3, alternative: true },
    { symbol: "MJ", factor: 1e6, alternative: true },
    { symbol: "kWh", factor: 3.6e6, alternative: true },
  ],
  W: [
    { symbol: "mW", factor: 1e-3, alternative: true },
    { symbol: "kW", factor: 1e3, alternative: true },
    { symbol: "MW", factor: 1e6, alternative: true },
  ],
  Hz: [
    { symbol: "kHz", factor: 1e3, alternative: true },
    { symbol: "MHz", factor: 1e6, alternative: true },
  ],
  F: [
    { symbol: "µF", factor: 1e-6, alternative: true },
    { symbol: "nF", factor: 1e-9, alternative: true },
    { symbol: "pF", factor: 1e-12, alternative: true },
  ],
  H: [
    { symbol: "mH", factor: 1e-3, alternative: true },
    { symbol: "µH", factor: 1e-6, alternative: true },
  ],
  S: [
    { symbol: "mS", factor: 1e-3, alternative: true },
    { symbol: "µS", factor: 1e-6, alternative: true },
  ],
  m3: [{ symbol: "L", factor: 1e-3, alternative: true }],
  m2: [{ symbol: "cm2", factor: 1e-4, alternative: true }],
  "m3/s": [
    { symbol: "L/s", factor: 1e-3, alternative: true },
    { symbol: "L/min", factor: 1e-3 / 60, alternative: true },
  ],
  "kg/s": [{ symbol: "g/s", factor: 1e-3, alternative: true }],
  "J/(kg.K)": [{ symbol: "kJ/(kg.K)", factor: 1e3, alternative: true }],
  "W/(m2.K)": [{ symbol: "kW/(m2.K)", factor: 1e3, alternative: true }],
  "kg/m3": [{ symbol: "g/cm3", factor: 1e3, alternative: true }],
  "J/kg": [{ symbol: "kJ/kg", factor: 1e3, alternative: true }],
};

/**
 * The units a value in `base` can be shown in, the model's own first.
 *
 * Empty when the unit is not in the table: a field with no alternatives shows no picker
 * rather than a picker with one entry.
 */
export function choicesFor(base: string, symbol: string): UnitChoice[] {
  const own = TABLE[base.trim()];
  if (!own || own.length === 0) return [];
  return [{ symbol: symbol || base.trim(), factor: 1 }, ...own];
}

/** The value in its own unit, from a value in the chosen one. */
export function toBase(value: number, choice: UnitChoice): number {
  return value * choice.factor + (choice.offset ?? 0);
}

/** The value in the chosen unit, from the value the model holds. */
export function fromBase(value: number, choice: UnitChoice): number {
  return (value - (choice.offset ?? 0)) / choice.factor;
}

/**
 * A value as an editable field shows it.
 *
 * Ten significant digits and no trailing zeros: enough to round-trip a double through the
 * field without inventing digits the model never had, and short enough to read. `1e-6` is
 * left in exponent form, which Modelica's own syntax accepts.
 */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  return String(Number(value.toPrecision(10)));
}

/** A number written in a field, and the unit it was written in, when it names one. */
export interface ParsedValue {
  value: number;
  /** The choice the number was written in — the model's own unit when none was named. */
  choice: UnitChoice;
}

/**
 * Read what a reader typed: a number, and optionally a unit after it.
 *
 * `101325`, `101325 Pa`, `1.01325 bar` and `-40 °C` all parse; anything else is `null`, and
 * the caller commits the text exactly as typed. That fallback is the important half: these
 * fields accept expressions (`system.allowFlowReversal`), and a parser that rejected what it
 * did not recognise would take that away.
 */
export function parseValue(text: string, choices: UnitChoice[]): ParsedValue | null {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\s\d].*)?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const written = (match[2] ?? "").trim();
  if (written === "") return { value, choice: choices[0] };
  // A named unit has to be one of the field's own, so `2 bananas` stays an expression.
  const choice = choices.find((c) => c.symbol === written);
  return choice ? { value, choice } : null;
}
