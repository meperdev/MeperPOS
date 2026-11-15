import type { ImportSheetId } from "@/types";

export const SHEET_LABELS: Record<ImportSheetId, string> = {
  productos: "Productos",
  clientes: "Clientes",
  proveedores: "Proveedores",
  usuarios: "Usuarios",
};

export const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  sku: "SKU",
  barcode: "Código de barras",
  category: "Categoría",
  salePrice: "Precio venta",
  costPrice: "Precio costo",
  stock: "Stock",
  minStock: "Stock mínimo",
  taxRate: "Impuesto (%)",
  description: "Descripción",
  documentType: "Tipo de documento",
  documentNumber: "N° documento",
  email: "Email",
  password: "Contraseña",
  role: "Rol",
  accountType: "Tipo de cuenta",
  phone: "Teléfono",
  address: "Dirección",
  contactName: "Nombre de contacto",
};

export const CODE_LABELS: Record<string, string> = {
  EMPTY_NAME: "Nombre vacío",
  EMPTY_EMAIL: "Correo vacío",
  EMPTY_PASSWORD: "Contraseña vacía",
  EMPTY_DOCUMENT: "Documento vacío",
  EMPTY_DOCUMENT_TYPE: "Tipo de documento vacío",
  EMPTY_ROW: "Fila vacía",
  INVALID_PRICE: "Precio inválido",
  INVALID_STOCK: "Stock inválido",
  INVALID_COST_PRICE: "Precio de costo inválido",
  INVALID_MIN_STOCK: "Stock mínimo inválido",
  INVALID_TAX_RATE: "Impuesto inválido",
  INVALID_EMAIL: "Correo inválido",
  INVALID_PASSWORD: "Contraseña inválida",
  INVALID_ROLE: "Rol inválido",
  INVALID_ACCOUNT_TYPE: "Tipo de cuenta inválido",
  INVALID_SEGMENT: "Segmento inválido",
  DUPLICATE_SKU: "SKU duplicado",
  DUPLICATE_SKU_FILE: "SKU repetido en el archivo",
  DUPLICATE_SKU_DB: "SKU ya registrado",
  DUPLICATE_BARCODE: "Código de barras duplicado",
  DUPLICATE_BARCODE_FILE: "Código de barras repetido en el archivo",
  DUPLICATE_BARCODE_DB: "Código de barras ya registrado",
  DUPLICATE_EMAIL: "Correo ya registrado",
  DUPLICATE_DOCUMENT: "Documento ya registrado",
  IMPORT_ROW_FAILED: "No se pudo importar la fila",
  IMPORT_PARSE_FAILED: "No se pudo leer el archivo",
  IMPORT_JOB_FAILED: "La importación falló",
  UNKNOWN_ERROR: "Error desconocido",
};

const GENERIC_CODE_LABEL = "Error de validación";

export function getImportErrorCodeLabel(code: string | null | undefined): string {
  if (!code || !Object.prototype.hasOwnProperty.call(CODE_LABELS, code)) {
    return GENERIC_CODE_LABEL;
  }
  return CODE_LABELS[code];
}

export function sheetLabel(sheetId: ImportSheetId): string {
  return SHEET_LABELS[sheetId] ?? sheetId;
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
