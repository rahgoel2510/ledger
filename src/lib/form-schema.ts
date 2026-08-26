import { z } from "zod";

/**
 * Number fields for react-hook-form. A DOM input always hands back a string, so
 * `z.coerce.number()` would give the schema an `unknown` input type and lose all
 * typing on the form values. This accepts `string | number` explicitly, converts,
 * and treats an empty field as missing rather than as zero — which matters for an
 * FX rate, where a silent 0 would corrupt every downstream forex figure.
 */
export function numberField(message: string) {
  return z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "string" ? (value.trim() === "" ? Number.NaN : Number(value)) : value
    )
    .pipe(z.number({ message }));
}

export function positiveNumberField(message: string) {
  return numberField(message).pipe(z.number().positive(message));
}

export function integerField(message: string, min: number, max: number) {
  return numberField(message).pipe(z.number().int(message).min(min, message).max(max, message));
}

/**
 * An integer field that may be left blank, falling back to a default.
 *
 * Distinct from `integerField` in what an empty input means: there it is a
 * missing required value, here it means "use the standard". A typo is still an
 * error — the field is optional, not unvalidated.
 */
export function optionalIntegerField(
  message: string,
  min: number,
  max: number,
  fallback: number
) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => {
      if (typeof value === "number") return value;
      return value.trim() === "" ? fallback : Number(value);
    })
    .pipe(z.number({ message }).int(message).min(min, message).max(max, message));
}

/** Non-negative — for amounts like bank charges where zero is a legitimate value. */
export function nonNegativeNumberField(message: string) {
  return numberField(message).pipe(z.number().min(0, message));
}
