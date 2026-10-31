import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

describe('AppModule payroll wiring', () => {
  it('imports and registers PayrollModule in Nest imports', () => {
    // Inspect source without evaluating ConfigModule.forRoot, which loads dotenv.
    const source = ts.createSourceFile(
      'app.module.ts',
      readFileSync(join(__dirname, 'app.module.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = source.statements.filter(ts.isImportDeclaration);
    expect(
      imports.some(
        (entry) =>
          entry.moduleSpecifier.getText(source) ===
            "'./payroll/payroll.module'" &&
          entry.importClause?.namedBindings
            ?.getText(source)
            .includes('PayrollModule'),
      ),
    ).toBe(true);
    const moduleClass = source.statements.find(
      (entry) =>
        ts.isClassDeclaration(entry) && entry.name?.text === 'AppModule',
    );
    expect(moduleClass && ts.isClassDeclaration(moduleClass)).toBe(true);
    const decorator = ts
      .getDecorators(moduleClass as ts.ClassDeclaration)
      ?.find(
        (entry) =>
          ts.isCallExpression(entry.expression) &&
          entry.expression.expression.getText(source) === 'Module',
      );
    const call = decorator?.expression as ts.CallExpression;
    const metadata = call.arguments[0] as ts.ObjectLiteralExpression;
    const property = metadata.properties.find(
      (entry) =>
        ts.isPropertyAssignment(entry) &&
        entry.name.getText(source) === 'imports',
    ) as ts.PropertyAssignment;
    expect(
      ts.isArrayLiteralExpression(property.initializer) &&
        property.initializer.elements.some(
          (entry) => entry.getText(source) === 'PayrollModule',
        ),
    ).toBe(true);
  });
});
