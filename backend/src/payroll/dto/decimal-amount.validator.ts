import { registerDecorator, ValidationOptions } from 'class-validator';

/** Validate the decimal representation, without floating-point multiplication. */
export function IsDecimalAmount(validationOptions?: ValidationOptions) {
  const decorator: PropertyDecorator = (object, propertyName) => {
    registerDecorator({
      name: 'isDecimalAmount',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'number' &&
            Number.isFinite(value) &&
            /^-?\d+(?:\.\d{1,2})?$/.test(String(value))
          );
        },
        defaultMessage() {
          return '$property must have at most 2 decimal places';
        },
      },
    });
  };
  return decorator;
}
