import { z } from "zod";

/**
 * A DOM input always hands back a string, so `z.coerce.number()` would give the
 * schema an `unknown` input type and lose all typing on the form values. This
 * accepts `string | number` explicitly, converts, and treats an empty field as
 * missing rather than as zero — which matters for an FX rate, where a silent 0
 * would corrupt every downstream forex figure.
 */
function numeric() {
  return z
    .union([z.string(), z.number()])
    .transform((value) =>
      typeof value === "string" ? (value.trim() === "" ? Number.NaN : Number(value)) : value
    );
}

/**
 * Every field below reports a blank or unparseable value as one ordinary issue,
 * never as a type error, and that is deliberate: zod abandons an object as soon
 * as a field fails its *type*, which would silence every cross-field rule on the
 * form — the due-date comparison, the hourly-line date requirement — until the
 * last empty number had been filled in. The user would fix one blank field and
 * be shown an error they had no way of seeing before.
 */
export function numberField(message: string) {
  return numeric().refine((value) => Number.isFinite(value), { message });
}

export function positiveNumberField(message: string) {
  return numeric().refine((value) => Number.isFinite(value) && value > 0, { message });
}

export function integerField(message: string, min: number, max: number) {
  return numeric().refine(
    (value) => Number.isInteger(value) && value >= min && value <= max,
    { message }
  );
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
    .refine((value) => Number.isInteger(value) && value >= min && value <= max, { message });
}

/** Non-negative — for amounts like bank charges where zero is a legitimate value. */
export function nonNegativeNumberField(message: string) {
  return numeric().refine((value) => Number.isFinite(value) && value >= 0, { message });
}

/**
 * A number that may be left blank. Blank means "not stated" and comes back as
 * `undefined` — never as zero, which for a rate or a GST percentage would be a
 * claim the user never made.
 */
export function optionalNumberField(message: string, min = 0) {
  return z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) =>
      value === undefined || (typeof value === "string" && value.trim() === "")
        ? undefined
        : Number(value)
    )
    .refine((value) => value === undefined || (Number.isFinite(value) && value >= min), { message });
}
